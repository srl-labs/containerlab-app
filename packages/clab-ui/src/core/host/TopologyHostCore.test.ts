import assert from "node:assert/strict";
import { posix as path } from "node:path";
import test from "node:test";

import { TopologyHostCore } from "./TopologyHostCore";
import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../types/messages";
import type { FileSystemAdapter } from "../io/types";
import { extractNodeYamlSources } from "../io/NodeYamlClone";
import { createRuntimeContainerDataProvider } from "../../topology/runtime";

type AckWithSnapshot = Extract<TopologyHostResponseMessage, { type: "topology-host:ack" }> & {
  snapshot: TopologySnapshot;
};

class MemoryFileSystemAdapter implements FileSystemAdapter {
  private readonly files = new Map<string, string>();

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(this.key(filePath));
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as Error & {
        code: string;
      };
      error.code = "ENOENT";
      throw error;
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(this.key(filePath), content);
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(this.key(filePath));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldKey = this.key(oldPath);
    const content = this.files.get(oldKey);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, rename '${oldPath}'`) as Error & {
        code: string;
      };
      error.code = "ENOENT";
      throw error;
    }
    this.files.set(this.key(newPath), content);
    this.files.delete(oldKey);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(this.key(filePath));
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  basename(filePath: string): string {
    return path.basename(filePath);
  }

  join(...segments: string[]): string {
    return path.join(...segments);
  }

  private key(filePath: string): string {
    return path.normalize(filePath);
  }
}

const BASE_YAML = `name: demo
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
  links: []
`;

const CHANGED_YAML = `name: demo
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
    srl2:
      kind: nokia_srlinux
  links: []
`;

test("concurrent commands cannot both accept the same revision", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/concurrent.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath,
    mode: "edit",
    deploymentState: "undeployed"
  });
  const { revision } = await host.getSnapshot();
  const responses = await Promise.all(
    [CHANGED_YAML, BASE_YAML].map((content) =>
      host.applyCommand({ command: "setYamlContent", payload: { content } }, revision)
    )
  );
  assert.deepEqual(
    responses.map((response) => response.type),
    ["topology-host:ack", "topology-host:reject"]
  );
  assert.equal(await fs.readFile(yamlFilePath), CHANGED_YAML);
});

test("a second session rejects a stale save and can retry from the current snapshot", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/shared.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  const options = {
    fs,
    yamlFilePath,
    mode: "edit" as const,
    deploymentState: "undeployed" as const
  };
  const first = new TopologyHostCore(options);
  const second = new TopologyHostCore(options);
  const [a, b] = await Promise.all([first.getSnapshot(), second.getSnapshot()]);
  const responses = await Promise.all([
    first.applyCommand(
      { command: "setYamlContent", payload: { content: CHANGED_YAML } },
      a.revision
    ),
    second.applyCommand({ command: "setYamlContent", payload: { content: BASE_YAML } }, b.revision)
  ]);
  assert.equal(responses[0].type, "topology-host:ack");
  const stale = responses[1];
  assert.equal(stale.type, "topology-host:reject");
  assert.equal(await fs.readFile(yamlFilePath), CHANGED_YAML);
  if (stale.type !== "topology-host:reject") throw new Error("Expected rejection");
  const retry = await second.applyCommand(
    { command: "setYamlContent", payload: { content: BASE_YAML } },
    stale.revision
  );
  assert.equal(retry.type, "topology-host:ack");
  assert.equal(await fs.readFile(yamlFilePath), BASE_YAML);
});

function assertAck(
  response: TopologyHostResponseMessage
): asserts response is Extract<TopologyHostResponseMessage, { type: "topology-host:ack" }> {
  assert.equal(response.type, "topology-host:ack");
}

async function apply(
  host: TopologyHostCore,
  revision: number,
  command: TopologyHostCommand
): Promise<AckWithSnapshot> {
  const response = await host.applyCommand(command, revision);
  assertAck(response);
  assert.ok(response.snapshot);
  return response as AckWithSnapshot;
}

test("annotation-only commands do not dirty deployed apply state", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlPath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlPath, BASE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: yamlPath,
    mode: "edit",
    deploymentState: "deployed",
    dirty: false
  });

  const initial = await host.getSnapshot();
  assert.equal(initial.dirty, false);

  const annotationResponse = await apply(host, initial.revision, {
    command: "setAnnotations",
    payload: {
      freeTextAnnotations: [
        {
          id: "note-1",
          text: "hello",
          position: { x: 10, y: 20 }
        }
      ]
    }
  });
  assert.equal(annotationResponse.snapshot.dirty, false);

  const positionResponse = await apply(host, annotationResponse.revision, {
    command: "savePositions",
    payload: [{ id: "srl1", position: { x: 100, y: 200 } }]
  });
  assert.equal(positionResponse.snapshot.dirty, false);

  const yamlResponse = await apply(host, positionResponse.revision, {
    command: "setYamlContent",
    payload: { content: CHANGED_YAML }
  });
  assert.equal(yamlResponse.snapshot.dirty, true);
});

for (const refreshFirst of [false, true]) {
  test(`context refresh preserves external-edit detection (refresh first: ${refreshFirst})`, async () => {
    const fs = new MemoryFileSystemAdapter();
    const yamlFilePath = `/labs/context-${refreshFirst}.clab.yml`;
    await fs.writeFile(yamlFilePath, BASE_YAML);
    const host = new TopologyHostCore({
      fs,
      yamlFilePath,
      mode: "edit",
      deploymentState: "deployed",
      dirty: false
    });
    const initial = await host.getSnapshot();
    await fs.writeFile(yamlFilePath, CHANGED_YAML);
    host.updateContext({ mode: "view" });
    if (refreshFirst) await host.getSnapshot();
    const response = await host.applyCommand(
      { command: "setYamlContent", payload: { content: BASE_YAML } },
      initial.revision
    );
    assert.ok(response.type === "topology-host:reject");
    assert.equal(response.reason, "stale");
    assert.equal(response.snapshot.dirty, true);
    assert.equal(await fs.readFile(yamlFilePath), CHANGED_YAML);
  });
}

test("setViewerSettings merges showDummyLinks without clobbering sibling settings", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlPath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlPath, BASE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: yamlPath,
    mode: "edit",
    deploymentState: "undeployed",
    dirty: false
  });

  const initial = await host.getSnapshot();
  // Absent from the sidecar, dummy links stay visible.
  assert.equal(initial.annotations.viewerSettings?.showDummyLinks, undefined);

  const seeded = await apply(host, initial.revision, {
    command: "setViewerSettings",
    payload: { linkLabelMode: "on-select", showRateLabels: true }
  });

  const hidden = await apply(host, seeded.revision, {
    command: "setViewerSettings",
    payload: { showDummyLinks: false }
  });

  const viewerSettings = hidden.snapshot.annotations.viewerSettings;
  assert.equal(viewerSettings?.showDummyLinks, false);
  // The per-field merge must leave the other view options alone.
  assert.equal(viewerSettings.linkLabelMode, "on-select");
  assert.equal(viewerSettings.showRateLabels, true);

  // And it must survive a round-trip through the annotations file on disk.
  const annotationsOnDisk: unknown = JSON.parse(await fs.readFile(`${yamlPath}.annotations.json`));
  const persisted = (annotationsOnDisk as { viewerSettings?: Record<string, unknown> })
    .viewerSettings;
  assert.equal(persisted?.showDummyLinks, false);
  assert.equal(persisted.linkLabelMode, "on-select");

  const shown = await apply(host, hidden.revision, {
    command: "setViewerSettings",
    payload: { showDummyLinks: true }
  });
  assert.equal(shown.snapshot.annotations.viewerSettings?.showDummyLinks, true);
});

test("dummy endpoints preserve their group while real dummy-prefixed nodes keep their interfaces", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/dummies.clab.yml";
  await fs.writeFile(
    yamlFilePath,
    `name: dummies
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
    dummy-router:
      kind: linux
  links:
    - endpoints: ["srl1:e1-1", "dummy1"]
    - type: dummy
      endpoint:
        node: srl1
        interface: e1-2
    - endpoints: ["srl1:e1-3", "dummy-router:eth1"]
`
  );
  await fs.writeFile(
    `${yamlFilePath}.annotations.json`,
    JSON.stringify({
      nodeAnnotations: [
        { id: "srl1", position: { x: 10, y: 20 } },
        { id: "dummy0", groupId: "group-1" }
      ],
      networkNodeAnnotations: [{ id: "dummy0", type: "dummy", position: { x: 21.5, y: -21.5 } }],
      groupStyleAnnotations: [
        {
          id: "group-1",
          name: "Dummies",
          level: "1",
          position: { x: 0, y: 0 },
          width: 300,
          height: 300
        }
      ],
      viewerSettings: { showDummyLinks: false }
    })
  );
  const host = new TopologyHostCore({
    fs,
    yamlFilePath,
    mode: "edit",
    deploymentState: "undeployed"
  });
  const snapshot = await host.getSnapshot();

  assert.equal(snapshot.nodes.length, 4);
  assert.equal(snapshot.nodes.find((node) => node.id === "dummy-router")?.type, "topology-node");
  assert.equal(
    snapshot.edges.find((edge) => edge.target === "dummy-router")?.data?.targetEndpoint,
    "eth1"
  );
  assert.deepEqual(
    snapshot.annotations.nodeAnnotations?.find((node) => node.id === "dummy0"),
    { id: "dummy0", groupId: "group-1" }
  );

  const saved = await apply(host, snapshot.revision, {
    command: "savePositions",
    payload: [
      { id: "dummy0", position: { x: 21.5, y: -21.5 } },
      { id: "dummy-router", position: { x: 300, y: 400 } }
    ]
  });
  assert.deepEqual(
    saved.snapshot.annotations.nodeAnnotations?.find((node) => node.id === "dummy0"),
    { id: "dummy0", groupId: "group-1" }
  );
  assert.deepEqual(
    saved.snapshot.annotations.nodeAnnotations.find((node) => node.id === "dummy-router")
      ?.position,
    { x: 300, y: 400 }
  );
});

const RICH_NODE_YAML = `name: demo
topology:
  defaults:
    image: ghcr.io/example/default:1.0
  nodes:
    srl1:
      kind: nokia_srlinux
    # border router
    frr1:
      kind: frr
      hostname: frr1
      mgmt-ipv4: 172.20.20.21 # pinned
      credentials:
        username: admin
      volumes:
        - frr-data:/data
      daemons: [bgpd, ospfd]
      ports:
        - 2601:2601
  links:
    - endpoints: ["srl1:e1-1", "frr1:eth1"]
`;

test("undo after deleting a node restores the exact YAML", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/undo-delete.clab.yml";
  await fs.writeFile(yamlFilePath, RICH_NODE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath,
    mode: "edit",
    deploymentState: "undeployed"
  });

  const { revision } = await host.getSnapshot();
  const deleted = await apply(host, revision, {
    command: "deleteNode",
    payload: { id: "frr1" }
  });
  assert.equal((await fs.readFile(yamlFilePath)).includes("frr1"), false);

  const undone = await host.applyCommand({ command: "undo" }, deleted.snapshot.revision);
  assertAck(undone);
  assert.equal(await fs.readFile(yamlFilePath), RICH_NODE_YAML);
});

test("pasting a copied node keeps its own keys and undo removes it again", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/paste.clab.yml";
  await fs.writeFile(yamlFilePath, RICH_NODE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath,
    mode: "edit",
    deploymentState: "undeployed"
  });

  const snapshot = await host.getSnapshot();
  const yamlSource = extractNodeYamlSources(snapshot.yamlContent, ["frr1"]).get("frr1");
  assert.ok(yamlSource);

  const pasted = await apply(host, snapshot.revision, {
    command: "batch",
    payload: {
      commands: [
        {
          command: "addNode",
          payload: {
            id: "frr2",
            name: "frr2",
            position: { x: 10, y: 10 },
            extraData: { kind: "frr", image: "ghcr.io/example/default:1.0" },
            yamlSource
          }
        }
      ]
    }
  });
  const yaml = await fs.readFile(yamlFilePath);
  assert.ok(
    yaml.includes(`    # border router
    frr2:
      kind: frr
      hostname: frr2
      credentials:
        username: admin
      volumes:
        - frr-data:/data
      daemons: [ bgpd, ospfd ]
      ports:
        - 2602:2601
`),
    yaml
  );

  const undone = await host.applyCommand({ command: "undo" }, pasted.snapshot.revision);
  assertAck(undone);
  assert.equal(await fs.readFile(yamlFilePath), RICH_NODE_YAML);
});

test("the host's lab name and variables reach the snapshot and match running containers", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yaml = `name: dc-__gitBranch__
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      image: \${SRL_IMAGE:=ghcr.io/nokia/srlinux}
`;
  await fs.writeFile("/labs/dc.clab.yml", yaml);
  const requests: Array<{ labName: string; envNames: string[] }> = [];
  const looked: string[] = [];
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: "/labs/dc.clab.yml",
    mode: "edit",
    deploymentState: "deployed",
    containerDataProvider: {
      findContainer: (containerName) => {
        looked.push(containerName);
        return undefined;
      },
      findInterface: () => undefined
    },
    resolveVariables: async (request) => {
      requests.push(request);
      return { labName: "dc-main", topologyDir: "/labs", env: { SRL_IMAGE: "srl:25" } };
    }
  });

  const snapshot = await host.getSnapshot();
  assert.equal(snapshot.labName, "dc-main");
  assert.deepEqual(snapshot.variables, { labName: "dc-main", topologyDir: "/labs", env: { SRL_IMAGE: "srl:25" } });
  assert.deepEqual(requests, [{ labName: "dc-__gitBranch__", envNames: ["CLAB_LABDIR_BASE", "SRL_IMAGE"] }]);
  assert.ok(looked.includes("clab-dc-main-srl1"), `looked up ${looked.join(", ")}`);

  // The lookup is cached until the name or the referenced variables change.
  // An edit by someone else looks them up again.
  await fs.writeFile("/labs/dc.clab.yml", `${yaml}# edited\n`);
  await host.onExternalChange();
  assert.equal(requests.length, 2);
  await host.getSnapshot();
  assert.equal(requests.length, 2);
});

test("a failing variable lookup keeps the declared lab name", async () => {
  const fs = new MemoryFileSystemAdapter();
  await fs.writeFile("/labs/demo.clab.yml", BASE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: "/labs/demo.clab.yml",
    mode: "edit",
    deploymentState: "undeployed",
    resolveVariables: () => Promise.reject(new Error("offline"))
  });
  const snapshot = await host.getSnapshot();
  assert.equal(snapshot.labName, "demo");
  assert.equal(snapshot.variables, undefined);
});

test("running containers give their nodes a state and the docker status line", async () => {
  const fs = new MemoryFileSystemAdapter();
  await fs.writeFile(
    "/labs/demo.clab.yml",
    `name: demo
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
    srl2:
      kind: nokia_srlinux
  links: []
`
  );
  const container = (nodeName: string, status: string) => ({
    name: `clab-demo-${nodeName}`,
    nodeName,
    labName: "demo",
    state: "running",
    status,
    kind: "nokia_srlinux",
    image: "",
    ipv4Address: "",
    ipv6Address: ""
  });
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: "/labs/demo.clab.yml",
    mode: "edit",
    deploymentState: "deployed",
    containerDataProvider: createRuntimeContainerDataProvider([
      container("srl1", "Up 3 seconds (health: starting)"),
      container("srl2", "Up 2 minutes")
    ])
  });

  const snapshot = await host.getSnapshot();
  const extraData = (id: string) =>
    snapshot.nodes.find((node) => node.id === id)?.data.extraData as Record<string, unknown>;
  assert.equal(extraData("srl1").state, "running");
  assert.equal(extraData("srl1").status, "Up 3 seconds (health: starting)");
  assert.equal(extraData("srl2").status, "Up 2 minutes");
});

test("invalidateSnapshot picks up runtime data that arrived after the first snapshot", async () => {
  const fs = new MemoryFileSystemAdapter();
  await fs.writeFile("/labs/demo.clab.yml", BASE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: "/labs/demo.clab.yml",
    mode: "edit",
    deploymentState: "deployed",
    containerDataProvider: createRuntimeContainerDataProvider([])
  });
  const state = (snapshot: TopologySnapshot) => {
    const extraData = snapshot.nodes.find((node) => node.id === "srl1")?.data.extraData as
      | Record<string, unknown>
      | undefined;
    return extraData?.state;
  };
  const first = await host.getSnapshot();
  assert.notEqual(state(first), "running");

  host.updateContext({
    containerDataProvider: createRuntimeContainerDataProvider([
      {
        name: "clab-demo-srl1",
        nodeName: "srl1",
        labName: "demo",
        state: "running",
        status: "Up 2 minutes",
        kind: "nokia_srlinux",
        image: "",
        ipv4Address: "",
        ipv6Address: ""
      }
    ])
  });
  // Runtime ticks keep the cached snapshot; only an explicit invalidate rebuilds it.
  assert.notEqual(state(await host.getSnapshot()), "running");
  host.invalidateSnapshot();
  const snapshot = await host.getSnapshot();
  assert.equal(state(snapshot), "running");
  // The files did not change: same revision, history kept.
  assert.equal(snapshot.revision, first.revision);
});

test("a late report of the host's own save keeps the revision, history and next edit", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/echo.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath,
    mode: "edit",
    deploymentState: "undeployed"
  });
  const { revision } = await host.getSnapshot();
  const saved = await apply(host, revision, {
    command: "setYamlContent",
    payload: { content: CHANGED_YAML }
  });

  // The file watcher reports the save after it finished: nothing changed.
  const echoed = await host.onExternalChange();
  assert.equal(echoed.revision, saved.snapshot.revision);
  assert.equal(echoed.canUndo, true);
  // The next edit, made against the revision the webview has, still applies.
  const next = await apply(host, saved.snapshot.revision, {
    command: "setYamlContent",
    payload: { content: BASE_YAML }
  });

  // A real change by someone else still reloads.
  await fs.writeFile(yamlFilePath, CHANGED_YAML);
  const external = await host.onExternalChange();
  assert.ok(external.revision > next.snapshot.revision);
  assert.equal(external.yamlContent, CHANGED_YAML);
});

test("annotations of nodes that are gone are removed; a renamed node keeps its own", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/orphans.clab.yml";
  await fs.writeFile(
    yamlFilePath,
    `name: orphans
topology:
  nodes:
    srl4:
      kind: nokia_srlinux
    srl5:
      kind: nokia_srlinux
`
  );
  await fs.writeFile(
    `${yamlFilePath}.annotations.json`,
    JSON.stringify({
      nodeAnnotations: [
        { id: "client2", position: { x: 580, y: 300 } },
        { id: "srl4", position: { x: 220, y: 480 }, icon: "router" },
        // srl5 was renamed from srl9 in the YAML.
        { id: "srl9", position: { x: 40, y: 40 } },
        { id: "host:eth1", position: { x: 1, y: 1 } }
      ]
    })
  );
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "edit", deploymentState: "undeployed" });

  await host.getSnapshot();
  const saved = JSON.parse(await fs.readFile(`${yamlFilePath}.annotations.json`)) as {
    nodeAnnotations: Array<{ id: string; position: { x: number; y: number } }>;
    networkNodeAnnotations?: Array<{ id: string }>;
  };
  assert.deepEqual(saved.nodeAnnotations.map((n) => n.id).sort(), ["srl4", "srl5"]);
  // Special endpoints are no YAML nodes and stay.
  assert.equal(saved.networkNodeAnnotations?.some((n) => n.id === "host:eth1"), true);
  assert.deepEqual(saved.nodeAnnotations.find((n) => n.id === "srl5")?.position, { x: 40, y: 40 });
});

test("a move that arrives after its node was deleted adds no annotation", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/late-move.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "edit", deploymentState: "undeployed" });
  const { revision } = await host.getSnapshot();

  await apply(host, revision, {
    command: "savePositions",
    payload: [
      { id: "srl1", position: { x: 10, y: 20 } },
      { id: "client2", position: { x: 580, y: 300 } }
    ]
  });
  const saved = JSON.parse(await fs.readFile(`${yamlFilePath}.annotations.json`)) as {
    nodeAnnotations: Array<{ id: string }>;
  };
  assert.deepEqual(saved.nodeAnnotations.map((n) => n.id), ["srl1"]);
});

function historyOf(snapshot: TopologySnapshot): NonNullable<TopologySnapshot["history"]> {
  assert.ok(snapshot.history);
  return snapshot.history;
}

test("history steps keep their numbers between undo and redo", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/history-steps.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath,
    mode: "edit",
    deploymentState: "undeployed"
  });

  const initial = await host.getSnapshot();
  assert.deepEqual(historyOf(initial).undo, []);
  const first = await apply(host, initial.revision, {
    command: "setYamlContent",
    payload: { content: CHANGED_YAML }
  });
  const second = await apply(host, first.snapshot.revision, {
    command: "setYamlContent",
    payload: { content: BASE_YAML }
  });
  const steps = historyOf(second.snapshot).undo;
  assert.equal(steps.length, 2);
  const [firstStep, secondStep] = steps;
  assert.ok(secondStep > firstStep);

  const undone = await apply(host, second.snapshot.revision, { command: "undo" });
  assert.deepEqual(historyOf(undone.snapshot).undo, [firstStep]);
  assert.deepEqual(historyOf(undone.snapshot).redo, [secondStep]);
  const redone = await apply(host, undone.snapshot.revision, { command: "redo" });
  assert.deepEqual(historyOf(redone.snapshot).undo, [firstStep, secondStep]);
  assert.equal(historyOf(redone.snapshot).scope, historyOf(initial).scope);

  // A new edit after an undo gets a new number and drops the redo step.
  const again = await apply(host, redone.snapshot.revision, { command: "undo" });
  const third = await apply(host, again.snapshot.revision, {
    command: "setYamlContent",
    payload: { content: `${CHANGED_YAML}# note\n` }
  });
  assert.deepEqual(historyOf(third.snapshot).redo, []);
  assert.ok((historyOf(third.snapshot).undo.at(-1) ?? 0) > secondStep);

  await fs.writeFile(yamlFilePath, BASE_YAML);
  const external = await host.onExternalChange();
  assert.deepEqual(historyOf(external), { scope: historyOf(initial).scope, undo: [], redo: [] });
});

test("the snapshot carries the lab guide beside the topology", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  await fs.writeFile("/labs/demo.clab.md", "# Demo guide\n");
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "edit", deploymentState: "undeployed" });

  const snapshot = await host.getSnapshot();
  assert.deepEqual(snapshot.guide, { fileName: "demo.clab.md", content: "# Demo guide\n" });
});

test("a topology without a guide has none in its snapshot", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/plain.clab.yaml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "edit", deploymentState: "undeployed" });

  const snapshot = await host.getSnapshot();
  assert.equal(snapshot.guide, undefined);
});

test("an edited guide reloads without a new revision or a lost history", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  await fs.writeFile("/labs/demo.clab.md", "## Step one\n");
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "edit", deploymentState: "undeployed" });
  const initial = await host.getSnapshot();
  const edited = await apply(host, initial.revision, {
    command: "setYamlContent",
    payload: { content: CHANGED_YAML }
  });

  await fs.writeFile("/labs/demo.clab.md", "## Step one\n\n## Step two\n");
  const reloaded = await host.onExternalChange();
  assert.equal(reloaded.guide?.content, "## Step one\n\n## Step two\n");
  assert.equal(reloaded.revision, edited.snapshot.revision);
  assert.equal(reloaded.canUndo, true);

  await fs.unlink("/labs/demo.clab.md");
  const removed = await host.onExternalChange();
  assert.equal(removed.guide, undefined);
});

test("createGuide writes the guide beside the topology, outside the undo history", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "view", deploymentState: "deployed" });
  const initial = await host.getSnapshot();

  const created = await apply(host, initial.revision, {
    command: "createGuide",
    payload: { content: "## First step\n" }
  });
  assert.equal(await fs.readFile("/labs/demo.clab.md"), "## First step\n");
  assert.deepEqual(created.snapshot.guide, { fileName: "demo.clab.md", content: "## First step\n" });
  assert.equal(created.snapshot.canUndo, false);
  assert.equal(await fs.readFile(yamlFilePath), BASE_YAML);
});

test("createGuide leaves an undone edit to redo", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "edit", deploymentState: "undeployed" });
  const initial = await host.getSnapshot();
  const edited = await apply(host, initial.revision, {
    command: "setYamlContent",
    payload: { content: CHANGED_YAML }
  });
  const undone = await apply(host, edited.snapshot.revision, { command: "undo" });
  assert.equal(undone.snapshot.canRedo, true);

  const created = await apply(host, undone.snapshot.revision, {
    command: "createGuide",
    payload: { content: "## First step\n" }
  });
  assert.equal(created.snapshot.canRedo, true);
  const redone = await apply(host, created.snapshot.revision, { command: "redo" });
  assert.equal(await fs.readFile(yamlFilePath), CHANGED_YAML);
  assert.equal(redone.snapshot.guide?.content, "## First step\n");
});

test("a reload survives the snapshot being dropped while the guide is read", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  await fs.writeFile("/labs/demo.clab.md", "## Step one\n");
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "edit", deploymentState: "undeployed" });
  const initial = await host.getSnapshot();

  // The guide read waits, as on a slow lab host, until the test lets it go.
  const readFile = fs.readFile.bind(fs);
  let releaseGuide: () => void = () => undefined;
  let guideRequested: () => void = () => undefined;
  const requested = new Promise<void>((resolve) => (guideRequested = resolve));
  const released = new Promise<void>((resolve) => (releaseGuide = resolve));
  fs.readFile = async (filePath: string) => {
    if (filePath === "/labs/demo.clab.md") {
      guideRequested();
      await released;
    }
    return readFile(filePath);
  };
  await fs.writeFile("/labs/demo.clab.md", "## Step one\n\n## Step two\n");

  const reload = host.onExternalChange();
  await requested;
  // The lab was deployed meanwhile: the host drops its snapshot outside the queue.
  host.updateContext({ deploymentState: "deployed" });
  releaseGuide();

  const reloaded = await reload;
  assert.equal(reloaded.guide?.content, "## Step one\n\n## Step two\n");
  assert.equal(reloaded.deploymentState, "deployed");
  assert.equal(reloaded.revision, initial.revision);
});

test("createGuide never replaces a guide", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  await fs.writeFile("/labs/demo.clab.md", "mine\n");
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "edit", deploymentState: "undeployed" });
  const initial = await host.getSnapshot();

  const response = await host.applyCommand(
    { command: "createGuide", payload: { content: "template\n" } },
    initial.revision
  );
  if (response.type !== "topology-host:error") throw new Error("Expected an error");
  assert.match(response.error, /demo\.clab\.md already exists/);
  assert.equal(await fs.readFile("/labs/demo.clab.md"), "mine\n");
});

test("commands keep the guide they read instead of reading it again", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlFilePath, BASE_YAML);
  await fs.writeFile("/labs/demo.clab.md", "## Step one\n");
  const readFile = fs.readFile.bind(fs);
  let guideReads = 0;
  fs.readFile = async (filePath: string) => {
    if (filePath === "/labs/demo.clab.md") guideReads += 1;
    return readFile(filePath);
  };
  const host = new TopologyHostCore({ fs, yamlFilePath, mode: "edit", deploymentState: "undeployed" });
  const initial = await host.getSnapshot();
  assert.equal(guideReads, 1);

  const edited = await apply(host, initial.revision, {
    command: "setYamlContent",
    payload: { content: CHANGED_YAML }
  });
  await apply(host, edited.snapshot.revision, { command: "undo" });
  assert.equal(guideReads, 1);
  assert.equal(edited.snapshot.guide?.content, "## Step one\n");

  await host.onExternalChange();
  assert.equal(guideReads, 2);
});

const TEMPLATE = `name: fabric
topology:
  nodes:
{{- range $i := seq 1 .leaves }}
    leaf{{ $i }}:
      kind: linux
{{- end }}
  links: []
`;

const TEMPLATE_PATH = "/labs/fabric.clab.gotmpl";
const TEMPLATE_ANNOTATIONS_PATH = `${TEMPLATE_PATH}.annotations.json`;

/** What containerlab renders from TEMPLATE with that many leaves. */
function renderedFabric(leaves: number): string {
  const nodes = Array.from({ length: leaves }, (_, i) => `    leaf${i + 1}:\n      kind: linux\n`);
  return `name: fabric\ntopology:\n  nodes:\n${nodes.join("")}  links: []\n`;
}

async function templateHost(
  render: () => Promise<{ content: string; varsFiles?: string[]; error?: string }>,
  template = TEMPLATE
): Promise<{ fs: MemoryFileSystemAdapter; host: TopologyHostCore }> {
  const fs = new MemoryFileSystemAdapter();
  await fs.writeFile(TEMPLATE_PATH, template);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: TEMPLATE_PATH,
    // A template is read-only whatever the host asks for.
    mode: "edit",
    deploymentState: "undeployed",
    renderTopology: render
  });
  return { fs, host };
}

function nodeIds(snapshot: TopologySnapshot): string[] {
  return snapshot.nodes.map((node) => node.id).sort();
}

test("a template shows the topology containerlab renders from it, read-only", async () => {
  const { host } = await templateHost(async () => ({
    content: renderedFabric(3),
    varsFiles: ["fabric.clab_vars.yml"]
  }));
  const snapshot = await host.getSnapshot();
  assert.deepEqual(nodeIds(snapshot), ["leaf1", "leaf2", "leaf3"]);
  assert.equal(snapshot.mode, "view");
  assert.equal(snapshot.yamlFileName, "fabric.clab.gotmpl");
  assert.equal(snapshot.yamlContent, renderedFabric(3));
  assert.deepEqual(snapshot.template, { source: "rendered", varsFiles: ["fabric.clab_vars.yml"] });

  // The host cannot make it editable.
  host.updateContext({ mode: "edit" });
  assert.equal((await host.getSnapshot()).mode, "view");
});

test("a topology file that is no template has no template state", async () => {
  const fs = new MemoryFileSystemAdapter();
  await fs.writeFile("/labs/plain.clab.yml", BASE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: "/labs/plain.clab.yml",
    mode: "edit",
    deploymentState: "undeployed"
  });
  const snapshot = await host.getSnapshot();
  assert.equal(snapshot.template, undefined);
  assert.equal(snapshot.mode, "edit");
});

test("a template is never written: topology edits are refused, annotations are saved", async () => {
  const { fs, host } = await templateHost(async () => ({ content: renderedFabric(2) }));
  const { revision } = await host.getSnapshot();

  const refused: TopologyHostCommand[] = [
    { command: "setYamlContent", payload: { content: BASE_YAML } },
    { command: "deleteNode", payload: { id: "leaf1" } },
    { command: "addNode", payload: { id: "leaf9", name: "leaf9" } },
    { command: "setLabSettings", payload: { name: "other" } },
    {
      command: "batch",
      payload: {
        commands: [
          { command: "savePositions", payload: [{ id: "leaf1", position: { x: 1, y: 1 } }] },
          { command: "deleteNode", payload: { id: "leaf2" } }
        ]
      }
    }
  ];
  for (const command of refused) {
    const response = await host.applyCommand(command, revision);
    assert.equal(response.type, "topology-host:error", command.command);
    if (response.type !== "topology-host:error") throw new Error("Expected an error");
    assert.match(response.error, /fabric\.clab\.gotmpl is a topology template/);
  }
  assert.equal(await fs.exists(TEMPLATE_ANNOTATIONS_PATH), false);

  // Positions of rendered nodes, also of those a loop made, go to the annotations.
  const moved = await apply(host, revision, {
    command: "savePositions",
    payload: [
      { id: "leaf1", position: { x: 10, y: 20 } },
      { id: "leaf2", position: { x: 30, y: 40 } }
    ]
  });
  assert.deepEqual(
    moved.snapshot.annotations.nodeAnnotations?.map((node) => [node.id, node.position]),
    [
      ["leaf1", { x: 10, y: 20 }],
      ["leaf2", { x: 30, y: 40 }]
    ]
  );
  assert.equal(moved.snapshot.dirty, undefined);
  assert.equal(await fs.readFile(TEMPLATE_PATH), TEMPLATE);
});

test("undo and redo of a template's annotations leave the template alone", async () => {
  const { fs, host } = await templateHost(async () => ({ content: renderedFabric(1) }));
  const { revision } = await host.getSnapshot();
  const moved = await apply(host, revision, {
    command: "savePositions",
    payload: [{ id: "leaf1", position: { x: 10, y: 20 } }]
  });
  assert.equal(moved.snapshot.canUndo, true);

  const undone = await apply(host, moved.snapshot.revision, { command: "undo" });
  assert.deepEqual(undone.snapshot.annotations.nodeAnnotations ?? [], []);
  assert.equal(await fs.readFile(TEMPLATE_PATH), TEMPLATE);

  const redone = await apply(host, undone.snapshot.revision, { command: "redo" });
  assert.deepEqual(redone.snapshot.annotations.nodeAnnotations?.[0]?.position, { x: 10, y: 20 });
  assert.equal(await fs.readFile(TEMPLATE_PATH), TEMPLATE);
});

test("a template renders again when its text changes, not when only its annotations do", async () => {
  let leaves = 2;
  let renders = 0;
  const { fs, host } = await templateHost(async () => {
    renders += 1;
    return { content: renderedFabric(leaves) };
  });
  const first = await host.getSnapshot();
  assert.equal(renders, 1);

  // The host's own annotation save, reported late by a file watcher.
  const moved = await apply(host, first.revision, {
    command: "savePositions",
    payload: [{ id: "leaf1", position: { x: 10, y: 20 } }]
  });
  const echoed = await host.onExternalChange();
  assert.equal(echoed.revision, moved.snapshot.revision);
  assert.equal(renders, 1);

  // The template is edited as text.
  leaves = 3;
  await fs.writeFile(TEMPLATE_PATH, `${TEMPLATE}# more leaves\n`);
  const edited = await host.onExternalChange();
  assert.equal(renders, 2);
  assert.ok(edited.revision > moved.snapshot.revision);
  assert.deepEqual(nodeIds(edited), ["leaf1", "leaf2", "leaf3"]);
  // The node that was there before keeps its place.
  assert.deepEqual(
    edited.annotations.nodeAnnotations?.find((node) => node.id === "leaf1")?.position,
    { x: 10, y: 20 }
  );
});

test("a template renders again after a deploy and when the host drops the snapshot", async () => {
  let leaves = 1;
  let renders = 0;
  const { host } = await templateHost(async () => {
    renders += 1;
    return { content: renderedFabric(leaves) };
  });
  await host.getSnapshot();
  await host.getSnapshot();
  assert.equal(renders, 1);

  // Runtime data alone keeps the rendering.
  host.updateContext({ containerDataProvider: createRuntimeContainerDataProvider([]) });
  await host.getSnapshot();
  assert.equal(renders, 1);

  // The variables files may have changed by the time the lab is deployed.
  leaves = 2;
  host.updateContext({ deploymentState: "deployed" });
  assert.deepEqual(nodeIds(await host.getSnapshot()), ["leaf1", "leaf2"]);
  assert.equal(renders, 2);

  leaves = 3;
  host.invalidateSnapshot();
  assert.deepEqual(nodeIds(await host.getSnapshot()), ["leaf1", "leaf2", "leaf3"]);
  assert.equal(renders, 3);
});

test("a template containerlab cannot render shows its text when that is plain YAML", async () => {
  const written = `name: plain
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:{{ .version }}
  links: []
`;
  const { fs, host } = await templateHost(async () => {
    throw new Error("Rendering a topology needs containerlab 0.78 or newer.");
  }, written);
  // The position of a node only the rendering has.
  const annotations = JSON.stringify({ nodeAnnotations: [{ id: "leaf7", position: { x: 5, y: 6 } }] });
  await fs.writeFile(TEMPLATE_ANNOTATIONS_PATH, annotations);

  const snapshot = await host.getSnapshot();
  assert.deepEqual(nodeIds(snapshot), ["srl1"]);
  assert.equal(snapshot.mode, "view");
  assert.deepEqual(snapshot.template, {
    source: "text",
    error: "Rendering a topology needs containerlab 0.78 or newer."
  });
  // What is drawn is not what is deployed: no annotation is dropped for it.
  assert.deepEqual(
    snapshot.annotations.nodeAnnotations?.find((node) => node.id === "leaf7")?.position,
    { x: 5, y: 6 }
  );
});

test("a template that neither renders nor is plain YAML opens empty, with the reason", async () => {
  const { host } = await templateHost(async () => {
    throw new Error("template: fabric:4: unexpected EOF");
  });
  const snapshot = await host.getSnapshot();
  assert.deepEqual(snapshot.nodes, []);
  assert.equal(snapshot.yamlContent, "");
  assert.equal(snapshot.labName, "fabric");
  assert.deepEqual(snapshot.template, {
    source: "text",
    error: "template: fabric:4: unexpected EOF"
  });
});

test("a template that stops rendering keeps the topology it last rendered", async () => {
  let broken = false;
  const { fs, host } = await templateHost(async () => {
    if (broken) throw new Error("template: fabric:9: unexpected {{end}}");
    return { content: renderedFabric(2) };
  });
  const first = await host.getSnapshot();
  const moved = await apply(host, first.revision, {
    command: "savePositions",
    payload: [{ id: "leaf2", position: { x: 30, y: 40 } }]
  });

  broken = true;
  await fs.writeFile(TEMPLATE_PATH, `${TEMPLATE}{{ end }}\n`);
  const kept = await host.onExternalChange();
  assert.deepEqual(nodeIds(kept), ["leaf1", "leaf2"]);
  assert.deepEqual(kept.template, {
    source: "last-rendered",
    error: "template: fabric:9: unexpected {{end}}"
  });
  assert.deepEqual(kept.annotations.nodeAnnotations, moved.snapshot.annotations.nodeAnnotations);

  // Fixed again: the reason is gone.
  broken = false;
  await fs.writeFile(TEMPLATE_PATH, TEMPLATE);
  const fixed = await host.onExternalChange();
  assert.deepEqual(fixed.template, { source: "rendered" });
});

test("a rendered topology containerlab rejects is shown with the reason", async () => {
  const { host } = await templateHost(async () => ({
    content: renderedFabric(1),
    error: 'node "leaf1" has no image'
  }));
  const snapshot = await host.getSnapshot();
  assert.deepEqual(nodeIds(snapshot), ["leaf1"]);
  assert.deepEqual(snapshot.template, { source: "rendered", error: 'node "leaf1" has no image' });
});
