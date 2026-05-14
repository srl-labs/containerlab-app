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

class InMemoryClabApiClient {
  private readonly files = new Map<string, string>();

  constructor(initialFiles: Record<string, string>) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.files.set(path, content);
    }
  }

  getBaseUrl(): string {
    return "http://remote.test";
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
