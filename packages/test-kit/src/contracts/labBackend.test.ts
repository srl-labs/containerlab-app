import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ApiLabBackend } from "@srl-labs/containerlab-lab-backend/api";
import { LocalLabBackend } from "@srl-labs/containerlab-lab-backend/local";

import { startFakeClabApiServer } from "./fakeClabApiServer";
import { describeLabBackendContract } from "./labBackend";

async function temporaryWorkspace(): Promise<{ root: string; remove(): Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lab-backend-contract-"));
  return { root, remove: () => fs.rm(root, { recursive: true, force: true }) };
}

describeLabBackendContract("Local (temporary workspace)", {
  async createFixture() {
    const workspace = await temporaryWorkspace();
    const backend = new LocalLabBackend({ workspaceRoot: workspace.root });
    return {
      backend,
      runsLabs: false,
      runtime: "docker",
      async dispose() {
        await backend.dispose();
        await workspace.remove();
      }
    };
  }
});

describeLabBackendContract("API (fake clab-api-server)", {
  async createFixture() {
    const workspace = await temporaryWorkspace();
    const server = await startFakeClabApiServer(workspace.root);
    return {
      backend: new ApiLabBackend({ baseUrl: server.url, token: server.token }),
      runsLabs: false,
      runtime: "docker",
      async dispose() {
        await server.close();
        await workspace.remove();
      }
    };
  }
});

// Real lab hosts, opt-in: CLAB_CONTRACT_LOCAL=1 runs containerlab on this machine
// in a temporary workspace; CLAB_CONTRACT_API_URL with CLAB_CONTRACT_API_USER and
// CLAB_CONTRACT_API_PASS runs against a clab-api-server.
if (process.env.CLAB_CONTRACT_LOCAL === "1") {
  describeLabBackendContract("Local containerlab", {
    async createFixture() {
      const workspace = await temporaryWorkspace();
      const backend = new LocalLabBackend({ workspaceRoot: workspace.root });
      return {
        backend,
        runsLabs: true,
        nodeImage: process.env.CLAB_CONTRACT_IMAGE,
        async dispose() {
          await backend.dispose();
          await workspace.remove();
        }
      };
    }
  });
}

describeLabBackendContract("API (fake c9s clab-api-server)", {
  async createFixture() {
    const workspace = await temporaryWorkspace();
    const server = await startFakeClabApiServer(workspace.root, { runtime: "c9s", namespaceMode: "per-lab" });
    return {
      backend: new ApiLabBackend({ baseUrl: server.url, token: server.token }),
      runsLabs: false,
      runtime: "c9s",
      async dispose() {
        await server.close();
        await workspace.remove();
      }
    };
  }
});

describeLabBackendContract("Local c9s host (temporary workspace, no cluster)", {
  async createFixture() {
    const workspace = await temporaryWorkspace();
    const backend = new LocalLabBackend({
      workspaceRoot: workspace.root,
      runtime: "c9s",
      // Hermetic: no cluster is reached by the file tests.
      env: { PATH: process.env.PATH, HOME: workspace.root },
      c9s: { kubeContext: "contract-test", kubeconfig: path.join(workspace.root, "no-kubeconfig") }
    });
    return {
      backend,
      runsLabs: false,
      runtime: "c9s",
      async dispose() {
        await backend.dispose();
        await workspace.remove();
      }
    };
  }
});

// A Kubernetes cluster with clabernetes, opt-in: CLAB_CONTRACT_C9S_CONTEXT names the
// kubeconfig context and CLAB_CONTRACT_KUBECONFIG the kubeconfig file; containerlab on
// this machine (CLAB_CONTRACT_CLAB_BINARY, else PATH) runs the labs with -r c9s.
const c9sContext = process.env.CLAB_CONTRACT_C9S_CONTEXT;
if (c9sContext) {
  describeLabBackendContract(`c9s cluster at context ${c9sContext}`, {
    async createFixture() {
      const workspace = await temporaryWorkspace();
      const backend = new LocalLabBackend({
        workspaceRoot: workspace.root,
        runtime: "c9s",
        ...(process.env.CLAB_CONTRACT_CLAB_BINARY ? { binaryPath: process.env.CLAB_CONTRACT_CLAB_BINARY } : {}),
        c9s: {
          kubeContext: c9sContext,
          ...(process.env.CLAB_CONTRACT_KUBECONFIG ? { kubeconfig: process.env.CLAB_CONTRACT_KUBECONFIG } : {})
        }
      });
      return {
        backend,
        runsLabs: true,
        runtime: "c9s",
        nodeImage: process.env.CLAB_CONTRACT_IMAGE,
        async dispose() {
          await backend.dispose();
          await workspace.remove();
        }
      };
    }
  });
}

const apiUrl = process.env.CLAB_CONTRACT_API_URL;
if (apiUrl) {
  describeLabBackendContract(`clab-api-server at ${apiUrl}`, {
    async createFixture() {
      const backend = await ApiLabBackend.login({
        baseUrl: apiUrl,
        username: process.env.CLAB_CONTRACT_API_USER ?? "",
        password: process.env.CLAB_CONTRACT_API_PASS ?? ""
      });
      return { backend, runsLabs: true, nodeImage: process.env.CLAB_CONTRACT_IMAGE };
    }
  });
}
