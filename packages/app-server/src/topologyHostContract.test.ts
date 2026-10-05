import { createApiClabUiHost } from "@containerlab/clab-ui/host";
import { describeTopologyHostContract } from "@srl-labs/containerlab-test-kit/contracts";
import Fastify from "fastify";

import { ClabApiClient, type TopologyEntry } from "./clabApiClient";
import type { EndpointEntry } from "./endpointSessionStore";
import { registerTopologyProxy } from "./topologyProxy";
import { createStandaloneTopologySessionManager } from "./topologySessionManager";

const YAML_PATH = "labs/contract.clab.yml";

/** Serves the clab-api-server topology file endpoints from memory. */
class InMemoryLabFiles extends ClabApiClient {
  readonly files = new Map<string, string>();

  private content(filePath: string): string {
    const content = this.files.get(filePath);
    if (content === undefined) throw Object.assign(new Error(`GET ${filePath} failed (404)`), { status: 404 });
    return content;
  }

  override async listTopologies(): Promise<TopologyEntry[]> {
    return [];
  }

  override async getFile(_token: string, _labName: string, filePath: string): Promise<string> {
    return this.content(filePath);
  }

  override async putFile(_token: string, _labName: string, filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  override async headFile(_token: string, _labName: string, filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  override async getTopologyDocumentRevision(_token: string, _labName: string, filePath: string): Promise<string | undefined> {
    return this.files.has(filePath) ? String(this.content(filePath).length) : undefined;
  }

  override async deleteFile(_token: string, _labName: string, filePath: string): Promise<void> {
    this.files.delete(filePath);
  }

  override async renameFile(_token: string, _labName: string, oldPath: string, newPath: string): Promise<void> {
    this.files.set(newPath, this.content(oldPath));
    this.files.delete(oldPath);
  }
}

describeTopologyHostContract("Web and desktop app server", {
  async createFixture(yaml) {
    const endpoint: EndpointEntry = {
      id: "contract-endpoint",
      url: "http://clab-api.test",
      label: "Contract",
      token: "token",
      username: "admin",
      sessionDuration: "24h"
    };
    const client = new InMemoryLabFiles({ baseUrl: endpoint.url });
    client.files.set(YAML_PATH, yaml);
    const sessions = createStandaloneTopologySessionManager();
    const app = Fastify({ logger: false });
    registerTopologyProxy(app, () => ({ client, endpoint }), sessions);

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const response = await app.inject({
        method: (init?.method ?? "GET") as "GET",
        url: url.pathname + url.search,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        payload: typeof init?.body === "string" ? init.body : undefined
      });
      return new Response(response.body, { status: response.statusCode });
    };
    const created = await fetchImpl("http://app.test/api/topology/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topologyRef: {
          topologyId: `standalone:${endpoint.id}::${YAML_PATH}`,
          labName: "contract",
          yamlPath: YAML_PATH,
          annotationsPath: `${YAML_PATH}.annotations.json`,
          source: "standalone"
        },
        mode: "edit",
        deploymentState: "undeployed"
      })
    });
    const session = (await created.json()) as { sessionId: string; topologyRef: never };
    const context = { ...session, mode: "edit" as const, deploymentState: "undeployed" as const };
    const host = createApiClabUiHost({
      baseUrl: "http://app.test",
      fetchImpl,
      postMessage: () => {},
      targetWindow: new EventTarget() as unknown as Window
    });

    return {
      host,
      context,
      readTopology: async () => client.files.get(YAML_PATH) ?? "",
      writeTopologyExternally: async (content) => {
        client.files.set(YAML_PATH, content);
      },
      observeExternalChange: () => host.topology.requestSnapshot(context, { externalChange: true }),
      async dispose() {
        sessions.disposeAll();
        await app.close();
      }
    };
  }
});
