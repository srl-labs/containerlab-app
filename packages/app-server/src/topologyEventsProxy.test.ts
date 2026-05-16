import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import type { ClabApiClient } from "./clabApiClient";
import type { EndpointEntry } from "./endpointSessionStore";
import { registerTopologyEventsProxy } from "./topologyEventsProxy";
import type { StandaloneTopologySessionManager } from "./topologySessionManager";

const endpoint: EndpointEntry = {
  id: "endpoint-remote",
  url: "http://remote.test",
  label: "Remote",
  token: "secret-token",
  username: "test",
  sessionDuration: "24h"
};

const topologyRef = {
  topologyId: `standalone:${endpoint.id}::labs/demo.clab.yml`,
  labName: "demo",
  yamlPath: "labs/demo.clab.yml",
  annotationsPath: "labs/demo.clab.yml.annotations.json",
  source: "standalone" as const
};

const sessionId = "session-topology-events";

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${lines.join("\n")}\n`));
      controller.close();
    }
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" }
  });
}

async function injectTopologyEvents(options: {
  internalUpdate: boolean;
  lines: string[];
}): Promise<{ body: string; statusCode: number }> {
  const app = Fastify({ logger: false });
  let openedLabName = "";
  let openedPath = "";
  let openedToken = "";

  const client = {
    async openTopologyEventStream(
      token: string,
      labName: string,
      filePath: string
    ): Promise<Response> {
      openedToken = token;
      openedLabName = labName;
      openedPath = filePath;
      return ndjsonResponse(options.lines);
    }
  } as Pick<ClabApiClient, "openTopologyEventStream"> as ClabApiClient;

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
        endpointId: endpoint.id,
        isInternalUpdate: () => options.internalUpdate,
        sessionId,
        topologyRef
      };
    }
  } as unknown as StandaloneTopologySessionManager;

  registerTopologyEventsProxy(
    app,
    (_request, _reply, preferredEndpointId) =>
      preferredEndpointId === endpoint.id ? { client, endpoint } : null,
    sessions
  );

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/topology/events?sessionId=${sessionId}&endpointId=${endpoint.id}`
    });

    assert.equal(openedToken, endpoint.token);
    assert.equal(openedLabName, topologyRef.labName);
    assert.equal(openedPath, topologyRef.yamlPath);
    return {
      body: response.body,
      statusCode: response.statusCode
    };
  } finally {
    await app.close();
  }
}

test("/api/topology/events forwards topology document events outside internal updates", async () => {
  const topologyEvent = JSON.stringify({
    type: "topology-doc",
    labName: "demo",
    path: "labs/demo.clab.yml",
    documentKind: "annotations",
    action: "change",
    revision: "rev-external"
  });

  const response = await injectTopologyEvents({
    internalUpdate: false,
    lines: [topologyEvent]
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.body, /:ok/);
  assert.match(response.body, /rev-external/);
});

test("/api/topology/events suppresses topology document events during internal updates", async () => {
  const topologyEvent = JSON.stringify({
    type: "topology-doc",
    labName: "demo",
    path: "labs/demo.clab.yml",
    documentKind: "annotations",
    action: "change",
    revision: "rev-internal"
  });

  const response = await injectTopologyEvents({
    internalUpdate: true,
    lines: [topologyEvent, "not-json"]
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.body, /:ok/);
  assert.doesNotMatch(response.body, /rev-internal/);
  assert.match(response.body, /data: not-json/);
});
