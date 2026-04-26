import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

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
