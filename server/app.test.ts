import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { createStandaloneApp } from "./app";

interface FetchCall {
  body: string | undefined;
  headers: Headers;
  method: string;
  url: URL;
}

type FetchHandler = (call: FetchCall) => Response | Promise<Response>;

class FetchMock {
  readonly calls: FetchCall[] = [];

  private readonly handlers: Array<{
    match: (call: FetchCall) => boolean;
    handler: FetchHandler;
  }> = [];

  on(method: string, url: string | RegExp, handler: FetchHandler): void {
    const normalizedMethod = method.toUpperCase();
    this.handlers.push({
      match: (call) => {
        if (call.method !== normalizedMethod) {
          return false;
        }
        return typeof url === "string" ? call.url.toString() === url : url.test(call.url.toString());
      },
      handler
    });
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = (init?.method ?? (typeof input === "string" || input instanceof URL ? "GET" : input.method))
      .toUpperCase();
    const headers = new Headers(init?.headers ?? (typeof input === "string" || input instanceof URL ? undefined : input.headers));
    const call: FetchCall = {
      body: bodyToString(init?.body),
      headers,
      method,
      url
    };
    this.calls.push(call);

    const route = this.handlers.find((candidate) => candidate.match(call));
    if (!route) {
      throw new Error(`Unexpected fetch: ${call.method} ${call.url.toString()}`);
    }
    return await route.handler(call);
  };
}

interface TestAppContext {
  app: Awaited<ReturnType<typeof createStandaloneApp>>;
  fetchMock: FetchMock;
}

async function createTestContext(t: TestContext): Promise<TestAppContext> {
  const originalFetch = globalThis.fetch;
  const fetchMock = new FetchMock();
  globalThis.fetch = fetchMock.fetch;

  const app = await createStandaloneApp({
    defaultClabApiUrl: "http://default-api.test:8080",
    isDev: true,
    logger: false,
    viteDevUrl: "http://vite.test"
  });

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  return { app, fetchMock };
}

function bodyToString(body: unknown): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  return typeof body === "string" ? body : String(body);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(payload: string, status = 200): Response {
  return new Response(payload, { status });
}

function extractSessionCookie(
  response: { headers: Record<string, number | string | string[] | undefined> }
): string {
  const raw = response.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(header, "expected set-cookie header");

  const headerText = String(header);
  const match = /(?:^|;\s*)clab_session=([^;]+)/.exec(headerText);
  assert.ok(match?.[1], `expected clab_session cookie in ${headerText}`);
  return `clab_session=${match[1]}`;
}

async function loginEndpoint(
  context: TestAppContext,
  body: {
    label?: string;
    password?: string;
    sessionDuration?: string;
    url: string;
    username?: string;
  },
  cookie?: string
): Promise<{ cookie: string; endpointId: string }> {
  const response = await context.app.inject({
    method: "POST",
    url: "/auth/login",
    headers: cookie ? { cookie } : undefined,
    payload: {
      password: "password",
      username: "admin",
      ...body
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  const payload = response.json<{
    endpoint: { id: string };
  }>();
  return {
    cookie: cookie ?? extractSessionCookie(response),
    endpointId: payload.endpoint.id
  };
}

test("GET /api/config returns empty endpoints without a session", async (t) => {
  const { app, fetchMock } = await createTestContext(t);

  const response = await app.inject({ method: "GET", url: "/api/config" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    endpoints: [],
    defaultClabApiUrl: "http://default-api.test:8080"
  });
  assert.equal(fetchMock.calls.length, 0);
});

test("POST /auth/login normalizes endpoint URL, forwards credentials, and hides tokens", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", (call) => {
    assert.deepEqual(JSON.parse(call.body ?? "{}"), {
      username: "alice",
      password: "secret",
      sessionDuration: "7d"
    });
    return jsonResponse({ token: "secret-token" });
  });

  const response = await context.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: {
      url: "api.example.test/",
      label: "Primary API",
      username: "alice",
      password: "secret",
      sessionDuration: "7d"
    }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers["set-cookie"]), /clab_session=/);
  assert.deepEqual(response.json(), {
    success: true,
    username: "alice",
    clabApiUrl: "http://api.example.test",
    endpoint: {
      id: response.json<{ endpoint: { id: string } }>().endpoint.id,
      url: "http://api.example.test",
      label: "Primary API",
      username: "alice",
      sessionDuration: "7d",
      status: "connected",
      connected: true
    }
  });
  assert.equal(response.body.includes("secret-token"), false);

  const config = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie: extractSessionCookie(response) }
  });
  assert.equal(config.statusCode, 200, config.body);
  assert.equal(config.body.includes("secret-token"), false);
  assert.equal(config.json<{ endpoints: unknown[] }>().endpoints.length, 1);
});

test("GET /auth/me reports connected, expired, and offline endpoint states", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", /\/login$/, (call) => {
    return jsonResponse({ token: `${call.url.hostname}-token` });
  });
  context.fetchMock.on("GET", "http://connected.test/api/v1/version", () => {
    return jsonResponse({ versionInfo: "connected" });
  });
  context.fetchMock.on("GET", "http://expired.test/api/v1/version", () => {
    return textResponse("expired", 401);
  });
  context.fetchMock.on("GET", "http://offline.test/api/v1/version", () => {
    throw new Error("offline");
  });

  const connected = await loginEndpoint(context, {
    url: "http://connected.test",
    label: "Connected"
  });
  await loginEndpoint(
    context,
    {
      url: "http://expired.test",
      label: "Expired"
    },
    connected.cookie
  );
  await loginEndpoint(
    context,
    {
      url: "http://offline.test",
      label: "Offline"
    },
    connected.cookie
  );

  const response = await context.app.inject({
    method: "GET",
    url: "/auth/me",
    headers: { cookie: connected.cookie }
  });

  assert.equal(response.statusCode, 200, response.body);
  const payload = response.json<{
    authenticated: boolean;
    endpoints: Array<{ label: string; status: string; connected: boolean }>;
  }>();
  assert.equal(payload.authenticated, true);
  assert.deepEqual(
    payload.endpoints.map((endpoint) => ({
      label: endpoint.label,
      status: endpoint.status,
      connected: endpoint.connected
    })),
    [
      { label: "Connected", status: "connected", connected: true },
      { label: "Expired", status: "session_expired", connected: false },
      { label: "Offline", status: "offline", connected: false }
    ]
  );
});

test("endpoint preference updates reject invalid durations and persist valid ones", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test"
  });

  const invalid = await context.app.inject({
    method: "PATCH",
    url: `/auth/endpoints/${endpointId}/preferences`,
    headers: { cookie },
    payload: { sessionDuration: "forever" }
  });
  assert.equal(invalid.statusCode, 400, invalid.body);

  const valid = await context.app.inject({
    method: "PATCH",
    url: `/auth/endpoints/${endpointId}/preferences`,
    headers: { cookie },
    payload: { sessionDuration: "36h" }
  });
  assert.equal(valid.statusCode, 200, valid.body);
  assert.equal(valid.json<{ sessionDuration: string }>().sessionDuration, "36h");

  const config = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie }
  });
  assert.equal(config.statusCode, 200, config.body);
  assert.equal(
    config.json<{ endpoints: Array<{ sessionDuration: string }> }>().endpoints[0]?.sessionDuration,
    "36h"
  );
});

test("deleting the last endpoint clears the browser session", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test"
  });

  const response = await context.app.inject({
    method: "DELETE",
    url: `/auth/endpoints/${endpointId}`,
    headers: { cookie }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers["set-cookie"]), /clab_session=;/);

  const config = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie }
  });
  assert.deepEqual(config.json<{ endpoints: unknown[] }>().endpoints, []);
});

test("protected proxy routes return 401 without a valid session", async (t) => {
  const { app } = await createTestContext(t);

  const files = await app.inject({ method: "GET", url: "/files" });
  const inspectAll = await app.inject({ method: "GET", url: "/api/runtime/inspect/all" });

  assert.equal(files.statusCode, 401, files.body);
  assert.equal(inspectAll.statusCode, 401, inspectAll.body);
});

test("/files proxies topology entries with bearer auth and Explorer topology refs", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on("GET", "http://api.example.test/api/v1/labs/topology/files", (call) => {
    assert.equal(call.headers.get("authorization"), "Bearer secret-token");
    return jsonResponse([
      {
        labName: "demo",
        yamlFileName: "labs/demo.clab.yml",
        annotationsFileName: "labs/demo.clab.yml.annotations.json",
        hasAnnotations: true,
        deploymentState: "deployed"
      }
    ]);
  });

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test"
  });
  const response = await context.app.inject({
    method: "GET",
    url: "/files",
    headers: { cookie }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), [
    {
      endpointId,
      filename: "labs/demo.clab.yml",
      path: "labs/demo.clab.yml",
      hasAnnotations: true,
      labName: "demo",
      deploymentState: "deployed",
      topologyRef: {
        topologyId: `standalone:${endpointId}::labs/demo.clab.yml`,
        labName: "demo",
        yamlPath: "labs/demo.clab.yml",
        annotationsPath: "labs/demo.clab.yml.annotations.json",
        source: "standalone"
      }
    }
  ]);
});

test("/api/runtime/inspect/all scopes duplicate lab names across endpoints", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", /\/login$/, (call) => {
    return jsonResponse({ token: `${call.url.hostname}-token` });
  });
  context.fetchMock.on("GET", "http://east.test/api/v1/labs", (call) => {
    assert.equal(call.headers.get("authorization"), "Bearer east.test-token");
    return jsonResponse({ demo: [{ name: "clab-demo-east" }] });
  });
  context.fetchMock.on("GET", "http://west.test/api/v1/labs", (call) => {
    assert.equal(call.headers.get("authorization"), "Bearer west.test-token");
    return jsonResponse({ demo: [{ name: "clab-demo-west" }] });
  });

  const east = await loginEndpoint(context, {
    url: "http://east.test",
    label: "East"
  });
  await loginEndpoint(
    context,
    {
      url: "http://west.test",
      label: "West"
    },
    east.cookie
  );

  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/inspect/all",
    headers: { cookie: east.cookie }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    "demo @ East": [{ name: "clab-demo-east" }],
    "demo @ West": [{ name: "clab-demo-west" }]
  });
});

test("terminal session creation resolves topology ref and short node name before proxying", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on("GET", "http://api.example.test/api/v1/labs/topology/files", () => {
    return jsonResponse([
      {
        labName: "demo",
        yamlFileName: "labs/demo.clab.yml",
        annotationsFileName: "labs/demo.clab.yml.annotations.json",
        hasAnnotations: true,
        deploymentState: "deployed"
      }
    ]);
  });
  context.fetchMock.on("GET", "http://api.example.test/api/v1/labs/demo", () => {
    return jsonResponse([
      {
        name: "clab-demo-srl1",
        containerId: "abc",
        image: "ghcr.io/nokia/srlinux",
        kind: "nokia_srlinux",
        state: "running",
        status: "Up",
        ipv4Address: "",
        ipv6Address: "",
        labName: "demo",
        labPath: "labs/demo.clab.yml",
        absLabPath: "/labs/demo.clab.yml",
        group: "",
        owner: ""
      }
    ]);
  });
  context.fetchMock.on(
    "POST",
    "http://api.example.test/api/v1/labs/demo/nodes/clab-demo-srl1/terminal-sessions",
    (call) => {
      assert.deepEqual(JSON.parse(call.body ?? "{}"), {
        protocol: "ssh",
        cols: 80,
        rows: 24
      });
      return jsonResponse({
        sessionId: "terminal-1",
        username: "admin",
        labName: "demo",
        nodeName: "clab-demo-srl1",
        protocol: "ssh",
        state: "open",
        createdAt: "2026-04-24T00:00:00Z",
        expiresAt: "2026-04-24T01:00:00Z",
        lastActivity: "2026-04-24T00:00:00Z"
      });
    }
  );

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test"
  });

  const response = await context.app.inject({
    method: "POST",
    url: "/api/runtime/terminal-sessions",
    headers: { cookie },
    payload: {
      topologyRef: {
        topologyId: `standalone:${endpointId}::labs/demo.clab.yml`,
        labName: "demo",
        yamlPath: "labs/demo.clab.yml",
        source: "standalone"
      },
      nodeName: "srl1",
      protocol: "ssh",
      cols: 80,
      rows: 24
    }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json<{ sessionId: string }>().sessionId, "terminal-1");
});
