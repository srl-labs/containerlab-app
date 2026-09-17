import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeContainerDataProvider } from "@containerlab/clab-ui/session";

import type { ClabApiClient } from "./clabApiClient";
import { createStandaloneTopologySessionManager } from "./topologySessionManager";

function notFound(path: string): Error & { status: number } {
  const error = new Error(`GET ${path} failed (404): not found`) as Error & {
    status: number;
  };
  error.status = 404;
  return error;
}

interface RunningLabDocs {
  yaml?: string;
  annotations?: string;
}

class InMemoryClabApiClient {
  private readonly files = new Map<string, string>();
  private readonly runningDocs = new Map<string, RunningLabDocs>();

  constructor(
    initialFiles: Record<string, string>,
    initialRunningDocs: Record<string, RunningLabDocs> = {}
  ) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.files.set(path, content);
    }
    for (const [labName, docs] of Object.entries(initialRunningDocs)) {
      this.runningDocs.set(labName, { ...docs });
    }
  }

  getBaseUrl(): string {
    return "http://remote.test";
  }

  getRunningAnnotations(labName: string): string | undefined {
    return this.runningDocs.get(labName)?.annotations;
  }

  async getLabTopologyYaml(_token: string, labName: string): Promise<string> {
    const content = this.runningDocs.get(labName)?.yaml;
    if (content === undefined) {
      throw notFound(`/api/v1/labs/${labName}/topology/yaml`);
    }
    return content;
  }

  async putLabTopologyYaml(_token: string, labName: string, content: string): Promise<void> {
    const docs = this.runningDocs.get(labName) ?? {};
    docs.yaml = content;
    this.runningDocs.set(labName, docs);
  }

  async getLabTopologyAnnotations(_token: string, labName: string): Promise<string> {
    const content = this.runningDocs.get(labName)?.annotations;
    if (content === undefined) {
      throw notFound(`/api/v1/labs/${labName}/topology/annotations`);
    }
    return content;
  }

  async putLabTopologyAnnotations(_token: string, labName: string, content: string): Promise<void> {
    const docs = this.runningDocs.get(labName) ?? {};
    docs.annotations = content;
    this.runningDocs.set(labName, docs);
  }

  async getFile(_token: string, _labName: string, filePath: string): Promise<string> {
    const content = this.files.get(filePath);
    if (content === undefined) {
      throw notFound(filePath);
    }
    return content;
  }

  async putFile(
    _token: string,
    _labName: string,
    filePath: string,
    content: string
  ): Promise<void> {
    this.files.set(filePath, content);
  }

  async headFile(_token: string, _labName: string, filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async deleteFile(_token: string, _labName: string, filePath: string): Promise<void> {
    if (!this.files.delete(filePath)) {
      throw notFound(filePath);
    }
  }

  async renameFile(
    _token: string,
    _labName: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    const content = this.files.get(oldPath);
    if (content === undefined) {
      throw notFound(oldPath);
    }
    this.files.set(newPath, content);
    this.files.delete(oldPath);
  }
}

test("topology sessions expose an internal-update grace window after host writes", async () => {
  const yamlPath = "labs/demo.clab.yml";
  const initialYaml = [
    "name: demo",
    "topology:",
    "  nodes:",
    "    n1:",
    "      kind: linux",
    "      image: alpine:latest",
    ""
  ].join("\n");
  const updatedYaml = initialYaml.replace("image: alpine:latest", "image: alpine:3.20");
  const client = new InMemoryClabApiClient({
    [yamlPath]: initialYaml
  }) as unknown as ClabApiClient;
  const manager = createStandaloneTopologySessionManager();

  try {
    const session = manager.createSession({
      client,
      token: "secret-token",
      endpointId: "endpoint-remote",
      topologyRef: {
        topologyId: `standalone:endpoint-remote::${yamlPath}`,
        labName: "demo",
        yamlPath,
        annotationsPath: `${yamlPath}.annotations.json`,
        source: "standalone"
      },
      mode: "edit",
      deploymentState: "undeployed",
      containerDataProvider: createRuntimeContainerDataProvider([])
    });

    assert.equal(session.isInternalUpdate(), false);

    const response = await session.host.applyCommand(
      { command: "setYamlContent", payload: { content: updatedYaml } },
      1
    );

    assert.equal(response.type, "topology-host:ack");
    assert.equal(session.isInternalUpdate(), true);

    manager.disposeSession(session.sessionId);
    assert.equal(session.isInternalUpdate(), false);
  } finally {
    manager.disposeAll();
  }
});

test("active topology session leases prevent idle cleanup until released", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000 });

  const yamlPath = "labs/demo.clab.yml";
  const client = new InMemoryClabApiClient({
    [yamlPath]: "name: demo\ntopology:\n  nodes: {}\n"
  }) as unknown as ClabApiClient;
  const manager = createStandaloneTopologySessionManager();

  try {
    const session = manager.createSession({
      client,
      token: "secret-token",
      endpointId: "endpoint-remote",
      topologyRef: {
        topologyId: `standalone:endpoint-remote::${yamlPath}`,
        labName: "demo",
        yamlPath,
        annotationsPath: `${yamlPath}.annotations.json`,
        source: "standalone"
      },
      mode: "edit",
      deploymentState: "undeployed",
      containerDataProvider: createRuntimeContainerDataProvider([])
    });

    const lease = manager.acquireSession(session.sessionId, "endpoint-remote");
    assert.ok(lease);

    t.mock.timers.tick(6 * 60 * 1000);
    assert.equal(manager.getSession(session.sessionId, "endpoint-remote"), session);

    lease.release();
    t.mock.timers.tick(6 * 60 * 1000);
    assert.equal(manager.getSession(session.sessionId, "endpoint-remote"), null);
  } finally {
    manager.disposeAll();
  }
});

test("running-lab-doc sessions create missing annotations and recover from a failed undo", async (t) => {
  const labName = "demo";
  const yamlPath = "/home/alice/.clab/demo/demo.clab.yml";
  const initialYaml = [
    "name: demo",
    "topology:",
    "  nodes:",
    "    n1:",
    "      kind: linux",
    "      image: alpine:latest",
    ""
  ].join("\n");
  const clientImpl = new InMemoryClabApiClient(
    {},
    {
      [labName]: {
        yaml: initialYaml
      }
    }
  );
  const client = clientImpl as unknown as ClabApiClient;
  const manager = createStandaloneTopologySessionManager();

  try {
    const session = manager.createSession({
      client,
      token: "secret-token",
      endpointId: "endpoint-remote",
      topologyRef: {
        topologyId: `standalone:endpoint-remote::${yamlPath}`,
        labName,
        yamlPath,
        annotationsPath: `${yamlPath}.annotations.json`,
        source: "standalone"
      },
      mode: "view",
      deploymentState: "deployed",
      sourcePreference: "running-lab-doc",
      containerDataProvider: createRuntimeContainerDataProvider([])
    });

    const snapshot = await session.host.getSnapshot();

    assert.equal(snapshot.labName, labName);
    assert.equal(snapshot.annotations.nodeAnnotations?.length, 0);
    assert.equal(clientImpl.getRunningAnnotations(labName), undefined);

    const response = await session.host.applyCommand(
      {
        command: "savePositions",
        payload: [{ id: "n1", position: { x: 100, y: 200 } }]
      },
      snapshot.revision
    );

    assert.equal(response.type, "topology-host:ack");
    const saved = clientImpl.getRunningAnnotations(labName);
    assert.ok(saved);
    const annotations = JSON.parse(saved) as {
      nodeAnnotations?: Array<{
        id: string;
        position?: { x: number; y: number };
      }>;
    };
    assert.deepEqual(annotations.nodeAnnotations, [
      {
        id: "n1",
        position: { x: 100, y: 200 }
      }
    ]);

    assert.ok(response.type === "topology-host:ack");
    const writeAnnotations = clientImpl.putLabTopologyAnnotations.bind(clientImpl);
    let failNextWrite = true;
    t.mock.method(
      clientImpl,
      "putLabTopologyAnnotations",
      async (...args: Parameters<typeof writeAnnotations>) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error("injected undo failure");
        }
        await writeAnnotations(...args);
      }
    );
    const failedUndo = await session.host.applyCommand({ command: "undo" }, response.revision);
    assert.equal(failedUndo.type, "topology-host:error");
    assert.equal(clientImpl.getRunningAnnotations(labName), saved);
    const retry = await session.host.applyCommand({ command: "undo" }, response.revision);
    assert.equal(retry.type, "topology-host:ack");
    assert.equal(clientImpl.getRunningAnnotations(labName), "{}\n");
  } finally {
    manager.disposeAll();
  }
});

test("failed running-document batch restores YAML and annotations and allows retry", async (t) => {
  const labName = "rollback-demo";
  const yamlPath = `/labs/${labName}.clab.yml`;
  const yaml = `name: ${labName}\ntopology:\n  nodes: {}\n`;
  const annotations = "{}\n";
  const client = new InMemoryClabApiClient({}, { [labName]: { yaml, annotations } });
  const manager = createStandaloneTopologySessionManager();
  t.after(() => manager.disposeAll());
  const session = manager.createSession({
    client: client as unknown as ClabApiClient,
    token: "test-token",
    endpointId: "rollback-endpoint",
    topologyRef: {
      topologyId: yamlPath,
      labName,
      yamlPath,
      source: "standalone"
    },
    mode: "edit",
    deploymentState: "deployed",
    sourcePreference: "running-lab-doc",
    containerDataProvider: createRuntimeContainerDataProvider([])
  });
  const snapshot = await session.host.getSnapshot();
  const writeAnnotations = client.putLabTopologyAnnotations.bind(client);
  let failNextWrite = true;
  t.mock.method(
    client,
    "putLabTopologyAnnotations",
    async (...args: Parameters<typeof writeAnnotations>) => {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("injected annotations write failure");
      }
      await writeAnnotations(...args);
    }
  );
  const command = {
    command: "batch" as const,
    payload: {
      commands: [
        {
          command: "setYamlContent" as const,
          payload: {
            content: yaml.replace("nodes: {}", "nodes: {n1: {kind: linux}}")
          }
        },
        {
          command: "setAnnotationsContent" as const,
          payload: { content: '{"viewerSettings":{"gridLineWidth":2}}\n' }
        }
      ]
    }
  };
  const failed = await session.host.applyCommand(command, snapshot.revision);
  assert.equal(failed.type, "topology-host:error");
  assert.equal(await client.getLabTopologyYaml("test-token", labName), yaml);
  assert.equal(client.getRunningAnnotations(labName), annotations);
  const retried = await session.host.applyCommand(command, snapshot.revision);
  assert.equal(retried.type, "topology-host:ack");
  assert.match(await client.getLabTopologyYaml("test-token", labName), /n1/);
});
