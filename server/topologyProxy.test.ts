import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import type { ClabApiClient } from "./clabApiClient";
import type { EndpointEntry } from "./endpointSessionStore";
import { registerTopologyProxy } from "./topologyProxy";
import type { StandaloneTopologySessionManager } from "./topologySessionManager";

test("/api/topology/command resolves endpoint from topologyRef", async (t) => {
  const app = Fastify({ logger: false });
  t.after(async () => {
    await app.close();
  });

  const endpoint: EndpointEntry = {
    id: "endpoint-remote",
    url: "http://remote.test",
    label: "Remote",
    token: "secret-token",
    username: "test",
    sessionDuration: "24h"
  };
  const fallbackEndpoint: EndpointEntry = {
    ...endpoint,
    id: "endpoint-default",
    label: "Default"
  };
  const topologyRef = {
    topologyId: `standalone:${endpoint.id}::labs/demo.clab.yml`,
    labName: "demo",
    yamlPath: "labs/demo.clab.yml",
    annotationsPath: "labs/demo.clab.yml.annotations.json",
    source: "standalone" as const
  };
  const sessionId = "session-remote";
  const preferredEndpointIds: Array<string | undefined> = [];

  const sessions = {
    createSession() {
      throw new Error("not used");
    },
    disposeAll() {},
    disposeSessionsForEndpoint() {},
    disposeSession() {
      return false;
    },
    disposeSessionsForToken() {},
    getSession(id: string, endpointId?: string) {
      if (id !== sessionId || endpointId !== endpoint.id) {
        return null;
      }
      return {
        baseUrl: endpoint.url,
        endpointId: endpoint.id,
        host: {
          updateContext() {},
          applyCommand: async () => ({
            type: "topology-host:ack",
            protocolVersion: 1,
            requestId: "",
            revision: 2
          })
        },
        lastAccess: Date.now(),
        sessionId,
        sourcePreference: "running-lab-doc",
        token: endpoint.token,
        topologyRef
      };
    }
  } as unknown as StandaloneTopologySessionManager;

  registerTopologyProxy(
    app,
    (_request, _reply, preferredEndpointId) => {
      preferredEndpointIds.push(preferredEndpointId);
      return {
        client: {} as never,
        endpoint: preferredEndpointId === endpoint.id ? endpoint : fallbackEndpoint
      };
    },
    sessions
  );

  const response = await app.inject({
    method: "POST",
    url: "/api/topology/command",
    payload: {
      sessionId,
      topologyRef,
      mode: "edit",
      deploymentState: "undeployed",
      runtimeContainers: [],
      baseRevision: 1,
      command: {
        command: "savePositions",
        payload: []
      }
    }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(preferredEndpointIds[0], endpoint.id);
  assert.deepEqual(response.json(), {
    type: "topology-host:ack",
    protocolVersion: 1,
    requestId: "",
    revision: 2
  });
});

test("/api/topology/sessions preserves running-lab-doc topology ref", async (t) => {
  const app = Fastify({ logger: false });
  t.after(async () => {
    await app.close();
  });

  const endpoint: EndpointEntry = {
    id: "endpoint-remote",
    url: "http://remote.test",
    label: "Remote",
    token: "secret-token",
    username: "test",
    sessionDuration: "24h"
  };
  const topologyRef = {
    topologyId: `standalone:${endpoint.id}::/home/alice/.clab/demo/demo.clab.yml`,
    labName: "demo",
    yamlPath: "/home/alice/.clab/demo/demo.clab.yml",
    annotationsPath: "/home/alice/.clab/demo/demo.clab.yml.annotations.json",
    source: "standalone" as const
  };
  let capturedOptions: Parameters<StandaloneTopologySessionManager["createSession"]>[0] | undefined;

  const sessions = {
    createSession(options: Parameters<StandaloneTopologySessionManager["createSession"]>[0]) {
      capturedOptions = options;
      return {
        sessionId: "session-running-doc",
        topologyRef: options.topologyRef
      };
    },
    disposeAll() {},
    disposeSessionsForEndpoint() {},
    disposeSession() {
      return false;
    },
    disposeSessionsForToken() {},
    getSession() {
      return null;
    }
  } as unknown as StandaloneTopologySessionManager;
  const client = {
    listTopologies: async () => {
      throw new Error("listTopologies should not be called for running-lab-doc sessions");
    }
  } as Pick<ClabApiClient, "listTopologies"> as ClabApiClient;

  registerTopologyProxy(
    app,
    () => ({
      client,
      endpoint
    }),
    sessions
  );

  const response = await app.inject({
    method: "POST",
    url: "/api/topology/sessions",
    payload: {
      topologyRef,
      mode: "view",
      deploymentState: "deployed",
      sourcePreference: "running-lab-doc",
      runtimeContainers: []
    }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(capturedOptions?.sourcePreference, "running-lab-doc");
  assert.deepEqual(response.json(), {
    sessionId: "session-running-doc",
    topologyRef
  });
});
