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
