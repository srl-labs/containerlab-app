import { createApiClabUiHost } from "@containerlab/clab-ui/host";
import { describeTopologyHostContract } from "@srl-labs/containerlab-test-kit/contracts";

import { createMemorySandboxBackend } from "./sandboxBackend";
import { createSandboxTransport } from "./sandboxTransport";

const BASE_URL = "http://localhost/sandbox/";
const FILE = "contract.clab.yml";

describeTopologyHostContract("Browser sandbox", {
  async createFixture(yaml) {
    const backend = createMemorySandboxBackend();
    const { fetch } = createSandboxTransport(backend);
    const topologyRef = await backend.createTopologyFile(FILE, yaml);
    const created = await fetch(`${BASE_URL}api/topology/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topologyRef, mode: "edit", deploymentState: "undeployed" })
    });
    const session = (await created.json()) as { sessionId: string; topologyRef: typeof topologyRef };
    const context = { ...session, mode: "edit" as const, deploymentState: "undeployed" as const };
    const host = createApiClabUiHost({
      baseUrl: BASE_URL,
      fetchImpl: fetch,
      postMessage: () => {},
      targetWindow: new EventTarget() as unknown as Window
    });

    return {
      host,
      context,
      readTopology: async () => (await backend.readFile(FILE)).content,
      writeTopologyExternally: (content) => backend.writeFile(FILE, content),
      observeExternalChange: () => host.topology.requestSnapshot(context, { externalChange: true }),
      async dispose() {
        await fetch(`${BASE_URL}api/topology/sessions/${session.sessionId}`, { method: "DELETE" });
      }
    };
  }
});
