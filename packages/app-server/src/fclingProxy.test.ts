import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import type { FclingApiRequest, LabBackend } from "@srl-labs/containerlab-lab-backend";
import Fastify from "fastify";

import type { ResolvedEndpoint } from "./endpointResolver";
import { registerFclingProxy } from "./fclingProxy";

interface Recorded {
  engine: string[];
  api: Array<{ labName: string; request: FclingApiRequest }>;
  events: Array<{ labName: string; after?: number }>;
}

function fakeBackend(recorded: Recorded, streamFailure?: string): LabBackend {
  return {
    async fclingEngine({ labName }: { labName: string }) {
      recorded.engine.push(`status ${labName}`);
      return { state: "ready" };
    },
    async startFclingEngine({ labName }: { labName: string }) {
      recorded.engine.push(`start ${labName}`);
      return { state: "starting" };
    },
    async stopFclingEngine({ labName }: { labName: string }) {
      recorded.engine.push(`stop ${labName}`);
    },
    async fclingApi({ labName }: { labName: string }, request: FclingApiRequest) {
      recorded.api.push({ labName, request });
      return request.path === "reports/nope"
        ? { status: 404, body: { error: "no such report" } }
        : { status: 200, body: { rows: [] } };
    },
    async streamFclingEvents(
      { labName }: { labName: string },
      options: { after?: number; signal: AbortSignal }
    ) {
      recorded.events.push({ labName, ...(options.after === undefined ? {} : { after: options.after }) });
      if (streamFailure) throw new Error(streamFailure);
      return (async function* () {
        yield { type: "status", nodes: [] };
        yield { type: "change", seq: 3 };
      })();
    }
  } as unknown as LabBackend;
}

async function startProxy(t: TestContext, options: { signedOut?: boolean; streamFailure?: string } = {}) {
  const recorded: Recorded = { engine: [], api: [], events: [] };
  const resolved = {
    backend: fakeBackend(recorded, options.streamFailure),
    endpoint: { id: "endpoint-1" }
  } as unknown as ResolvedEndpoint;
  const app = Fastify();
  registerFclingProxy(app, () => (options.signedOut ? null : resolved));
  await app.listen({ port: 0, host: "127.0.0.1" });
  t.after(() => app.close());
  const post = (url: string, payload: object) =>
    app.inject({ method: "POST", url: `/api/runtime/fcling/${url}`, payload });
  return { app, post, recorded };
}

test("the engine routes act on the named lab", async (t) => {
  const { post, recorded } = await startProxy(t);
  assert.deepEqual((await post("engine/status", { labName: "lab1" })).json(), { state: "ready" });
  assert.deepEqual((await post("engine/start", { labName: "lab1" })).json(), { state: "starting" });
  assert.equal((await post("engine/stop", { labName: "lab1" })).statusCode, 200);
  assert.deepEqual(recorded.engine, ["status lab1", "start lab1", "stop lab1"]);
});

test("a call without a lab is refused", async (t) => {
  const { post, recorded } = await startProxy(t);
  assert.equal((await post("engine/start", {})).statusCode, 400);
  assert.equal((await post("engine/start", { labName: "  " })).statusCode, 400);
  assert.deepEqual(recorded.engine, []);
});

test("a signed-out endpoint is refused", async (t) => {
  const { post } = await startProxy(t, { signedOut: true });
  assert.equal((await post("engine/status", { labName: "lab1" })).statusCode, 401);
  assert.equal(
    (await post("api", { labName: "lab1", request: { method: "GET", path: "status" } })).statusCode,
    401
  );
});

test("an API call answers with the engine's own status and body", async (t) => {
  const { post, recorded } = await startProxy(t);
  const request = { method: "GET", path: "reports/bgp-peers", query: { table: "1" } };
  const answer = await post("api", { labName: "lab1", request });
  assert.equal(answer.statusCode, 200);
  assert.deepEqual(answer.json(), { rows: [] });
  assert.deepEqual(recorded.api, [{ labName: "lab1", request }]);

  const missing = await post("api", { labName: "lab1", request: { method: "GET", path: "reports/nope" } });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "no such report" });
});

test("chat and MCP are out of reach", async (t) => {
  const { post, recorded } = await startProxy(t);
  for (const request of [
    { method: "POST", path: "chat" },
    { method: "POST", path: "../mcp" },
    { method: "GET", path: "openapi.json" },
    { method: "POST", path: "reports/bgp-peers" }
  ]) {
    assert.equal((await post("api", { labName: "lab1", request })).statusCode, 403, request.path);
  }
  assert.equal((await post("api", { labName: "lab1" })).statusCode, 403);
  assert.deepEqual(recorded.api, []);
});

async function readEvents(app: ReturnType<typeof Fastify>, search: string): Promise<string> {
  const { port } = app.server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/api/runtime/fcling/events?${search}`);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  return response.text();
}

test("the event stream passes on the engine's events, from where the view left off", async (t) => {
  const { app, recorded } = await startProxy(t);
  const body = await readEvents(app, "labName=lab1&after=2");
  assert.deepEqual(recorded.events, [{ labName: "lab1", after: 2 }]);
  assert.match(body, /data: \{"type":"status","nodes":\[\]\}/);
  assert.match(body, /data: \{"type":"change","seq":3\}/);
});

test("the event stream says why it failed", async (t) => {
  const { app } = await startProxy(t, { streamFailure: "not running" });
  assert.match(await readEvents(app, "labName=lab1"), /event: error\ndata: \{"error":"not running"\}/);
});

test("the event stream needs a lab", async (t) => {
  const { app } = await startProxy(t);
  const { port } = app.server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/api/runtime/fcling/events`);
  assert.equal(response.status, 400);
});
