import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeContainerDataProvider } from "@srl-labs/clab-ui/session";

import type { ClabApiClient } from "./clabApiClient";
import { createStandaloneTopologySessionManager } from "./topologySessionManager";

function notFound(path: string): Error & { status: number } {
  const error = new Error(`GET ${path} failed (404): not found`) as Error & { status: number };
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

  async putLabTopologyAnnotations(
    _token: string,
    labName: string,
    content: string
  ): Promise<void> {
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

test("running-lab-doc sessions treat missing annotations as empty and create them on save", async () => {
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
      nodeAnnotations?: Array<{ id: string; position?: { x: number; y: number } }>;
    };
    assert.deepEqual(annotations.nodeAnnotations, [
      {
        id: "n1",
        position: { x: 100, y: 200 }
      }
    ]);
  } finally {
    manager.disposeAll();
  }
});
