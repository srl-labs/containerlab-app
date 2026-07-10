import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { gunzipSync } from "node:zlib";

import { createStandaloneApp } from "./app";
import type { EndpointAccessPolicy } from "./endpointPolicy";
import { createEndpointAccessPolicy } from "./endpointPolicy";

interface FetchCall {
  body: string | undefined;
  headers: Headers;
  method: string;
  redirect: "error" | "follow" | "manual" | undefined;
  signal: AbortSignal | null;
  url: URL;
}

type FetchHandler = (call: FetchCall) => Response | Promise<Response>;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function isRequestObject(input: FetchInput): input is Request {
  return typeof input !== "string" && !(input instanceof URL);
}

function fetchInputUrl(input: FetchInput): URL {
  return new URL(isRequestObject(input) ? input.url : input);
}

function fetchInputMethod(input: FetchInput, init: FetchInit): string {
  return (
    init?.method ?? (isRequestObject(input) ? input.method : "GET")
  ).toUpperCase();
}

function fetchInputHeaders(input: FetchInput, init: FetchInit): Headers {
  return new Headers(
    init?.headers ?? (isRequestObject(input) ? input.headers : undefined),
  );
}

function fetchInputSignal(
  input: FetchInput,
  init: FetchInit,
): AbortSignal | null {
  return init?.signal ?? (isRequestObject(input) ? input.signal : null);
}

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
        return typeof url === "string"
          ? call.url.toString() === url
          : url.test(call.url.toString());
      },
      handler,
    });
  }

  fetch: typeof fetch = async (input, init) => {
    const call: FetchCall = {
      body: bodyToString(init?.body),
      headers: fetchInputHeaders(input, init),
      method: fetchInputMethod(input, init),
      redirect: init?.redirect,
      signal: fetchInputSignal(input, init),
      url: fetchInputUrl(input),
    };
    this.calls.push(call);

    const route = this.handlers.find((candidate) => candidate.match(call));
    if (!route) {
      throw new Error(
        `Unexpected fetch: ${call.method} ${call.url.toString()}`,
      );
    }
    return await route.handler(call);
  };
}

interface TestAppContext {
  app: Awaited<ReturnType<typeof createStandaloneApp>>;
  fetchMock: FetchMock;
}

const allowAllEndpointPolicy: EndpointAccessPolicy = {
  assertAllowed(): void {},
  isAllowed(): boolean {
    return true;
  },
};

async function createTestContext(
  t: TestContext,
  options: {
    endpointPolicy?: EndpointAccessPolicy;
    readinessProbeTimeoutMs?: number;
  } = {},
): Promise<TestAppContext> {
  const originalFetch = globalThis.fetch;
  const fetchMock = new FetchMock();
  globalThis.fetch = fetchMock.fetch;

  const app = await createStandaloneApp({
    defaultClabApiUrl: "https://default-api.test:8080",
    endpointPolicy: options.endpointPolicy ?? allowAllEndpointPolicy,
    isDev: true,
    logger: false,
    readinessProbeTimeoutMs: options.readinessProbeTimeoutMs,
    viteDevUrl: "http://vite.test",
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
    headers: { "content-type": "application/json" },
  });
}

function textResponse(payload: string, status = 200): Response {
  return new Response(payload, { status });
}

function bufferResponse(
  payload: Buffer,
  headers: Record<string, string> = {},
  status = 200,
): Response {
  return new Response(payload, { status, headers });
}

function ndjsonResponse(payload: string): Response {
  return new Response(payload, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}

function failingNdjsonResponse(
  firstChunk: string,
  errorMessage: string,
): Response {
  const encoder = new TextEncoder();
  let readCount = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      readCount += 1;
      if (readCount === 1) {
        controller.enqueue(encoder.encode(firstChunk));
        return;
      }
      controller.error(new Error(errorMessage));
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}

function extractSessionCookie(response: {
  headers: Record<string, number | string | string[] | undefined>;
}): string {
  const raw = response.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(header, "expected set-cookie header");

  const headerText = String(header);
  const match = /(?:^|;\s*)clab_session=([^;]+)/.exec(headerText);
  assert.ok(match?.[1], `expected clab_session cookie in ${headerText}`);
  return `clab_session=${match[1]}`;
}

function buildMultipartBody(input: {
  boundary: string;
  fields?: Record<string, string>;
  files?: Array<{
    content: Buffer;
    contentType?: string;
    fieldName: string;
    filename: string;
  }>;
}): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(input.fields ?? {})) {
    chunks.push(
      Buffer.from(
        `--${input.boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const file of input.files ?? []) {
    chunks.push(
      Buffer.from(
        `--${input.boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType ?? "application/octet-stream"}\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${input.boundary}--\r\n`));
  return Buffer.concat(chunks);
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
  cookie?: string,
): Promise<{ cookie: string; endpointId: string }> {
  const response = await context.app.inject({
    method: "POST",
    url: "/auth/login",
    headers: cookie ? { cookie } : undefined,
    payload: {
      password: "password",
      username: "admin",
      ...body,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  const payload = response.json<{
    endpoint: { id: string };
  }>();
  return {
    cookie: extractSessionCookie(response),
    endpointId: payload.endpoint.id,
  };
}

function mockLoginAndTopology(context: TestAppContext): void {
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/topology/files",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return jsonResponse([
        {
          labName: "demo",
          yamlFileName: "labs/demo.clab.yml",
          annotationsFileName: "labs/demo.clab.yml.annotations.json",
          hasAnnotations: true,
          deploymentState: "undeployed",
        },
      ]);
    },
  );
}

function mockDirectLabArchiveWorkspace(context: TestAppContext): void {
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/workspace/tree?path=srl-mirroring-lab",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return jsonResponse([
        {
          name: "srl-mirroring-lab.clab.yml",
          path: "srl-mirroring-lab/srl-mirroring-lab.clab.yml",
          kind: "file",
        },
        {
          name: "configs",
          path: "srl-mirroring-lab/configs",
          kind: "directory",
        },
      ]);
    },
  );
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/workspace/tree?path=srl-mirroring-lab%2Fconfigs",
    () =>
      jsonResponse([
        {
          name: "leaf.cfg",
          path: "srl-mirroring-lab/configs/leaf.cfg",
          kind: "file",
        },
      ]),
  );
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/workspace/file?path=srl-mirroring-lab%2Fsrl-mirroring-lab.clab.yml",
    () => textResponse("name: srl-mirroring-lab\n"),
  );
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/workspace/file?path=srl-mirroring-lab%2Fconfigs%2Fleaf.cfg",
    () => textResponse("set / system\n"),
  );
}

function demoTopologyRef(endpointId: string): {
  topologyId: string;
  labName: string;
  yamlPath: string;
  annotationsPath: string;
  source: "standalone";
} {
  return {
    topologyId: `standalone:${endpointId}::labs/demo.clab.yml`,
    labName: "demo",
    yamlPath: "labs/demo.clab.yml",
    annotationsPath: "labs/demo.clab.yml.annotations.json",
    source: "standalone",
  };
}

function vlanMismatchTopologyRef(endpointId: string): ReturnType<typeof demoTopologyRef> {
  return {
    topologyId: `standalone:${endpointId}::vlan.clab.yml`,
    labName: "srlinux-vlan-handling-lab",
    yamlPath: "vlan.clab.yml",
    annotationsPath: "vlan.clab.yml.annotations.json",
    source: "standalone",
  };
}

function mockVlanMismatchTopology(context: TestAppContext): void {
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/topology/files",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return jsonResponse([
        {
          labName: "srlinux-vlan-handling-lab",
          yamlFileName: "vlan.clab.yml",
          annotationsFileName: "vlan.clab.yml.annotations.json",
          hasAnnotations: true,
          deploymentState: "undeployed",
        },
      ]);
    },
  );
  context.fetchMock.on("GET", "http://api.example.test/api/v1/labs", (call) => {
    assert.equal(call.headers.get("authorization"), "Bearer secret-token");
    return jsonResponse({
      vlan: [
        {
          name: "clab-vlan-srl1",
          lab_name: "vlan",
          absLabPath: "/home/flschwar/.clab/srlinux-vlan-handling-lab/vlan.clab.yml",
          labPath: "/home/flschwar/.clab/srlinux-vlan-handling-lab/vlan.clab.yml",
        },
      ],
    });
  });
  context.fetchMock.on("GET", "http://api.example.test/api/v1/labs/vlan", (call) => {
    assert.equal(call.headers.get("authorization"), "Bearer secret-token");
    return jsonResponse([{ name: "clab-vlan-srl1" }]);
  });
}

test("GET /api/config returns empty endpoints without a session", async (t) => {
  const { app, fetchMock } = await createTestContext(t);

  const response = await app.inject({ method: "GET", url: "/api/config" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    endpoints: [],
    defaultClabApiUrl: "https://default-api.test:8080",
  });
  assert.equal(fetchMock.calls.length, 0);
});

test("health endpoints separate local liveness from upstream readiness", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("GET", "https://default-api.test:8080/health", (call) => {
    assert.equal(call.redirect, "error");
    return jsonResponse({ status: "ok" });
  });

  const live = await context.app.inject({ method: "GET", url: "/api/health/live" });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), { status: "ok" });
  assert.equal(context.fetchMock.calls.length, 0);

  const ready = await context.app.inject({ method: "GET", url: "/api/health/ready" });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json(), { status: "ready" });
});

test("readiness returns 503 when the upstream health probe times out", async (t) => {
  const context = await createTestContext(t, { readinessProbeTimeoutMs: 20 });
  context.fetchMock.on(
    "GET",
    "https://default-api.test:8080/health",
    (call) =>
      new Promise<Response>((_resolve, reject) => {
        assert.ok(call.signal);
        call.signal.addEventListener(
          "abort",
          () => reject(call.signal?.reason ?? new Error("aborted")),
          { once: true },
        );
      }),
  );

  const ready = await context.app.inject({
    method: "GET",
    url: "/api/health/ready",
  });
  assert.equal(ready.statusCode, 503, ready.body);
  assert.deepEqual(ready.json(), { status: "upstream_unavailable" });
});

test("endpoint policy rejects unlisted metadata destinations before fetch", async (t) => {
  const endpointPolicy = createEndpointAccessPolicy({
    defaultApiUrl: "https://default-api.test:8080",
  });
  const context = await createTestContext(t, { endpointPolicy });

  const response = await context.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: {
      url: "http://169.254.169.254",
      username: "alice",
      password: "secret",
    },
  });

  assert.equal(response.statusCode, 403, response.body);
  assert.match(response.json<{ error: string }>().error, /not allowed/);
  assert.equal(context.fetchMock.calls.length, 0);
});

test("login rejects endpoint URLs with embedded credentials before fetch", async (t) => {
  const context = await createTestContext(t);

  const response = await context.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: {
      url: "https://embedded:secret@api.example.test:8090/path?query=yes#fragment",
      username: "alice",
      password: "secret",
    },
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(context.fetchMock.calls.length, 0);
});

test("login normalizes endpoint paths, queries, and fragments to a clean origin", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "https://api.example.test:8090/login", () =>
    jsonResponse({ token: "secret-token" }),
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: {
      url: "https://api.example.test:8090/base?query=yes#fragment",
      username: "alice",
      password: "secret",
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json<{ clabApiUrl: string }>().clabApiUrl, "https://api.example.test:8090");
});

test("POST /auth/login normalizes endpoint URL, forwards credentials, and hides tokens", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "https://api.example.test/login", (call) => {
    assert.equal(call.redirect, "error");
    assert.deepEqual(JSON.parse(call.body ?? "{}"), {
      username: "alice",
      password: "secret",
      sessionDuration: "7d",
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
      sessionDuration: "7d",
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers["set-cookie"]), /clab_session=/);
  assert.deepEqual(response.json(), {
    success: true,
    username: "alice",
    clabApiUrl: "https://api.example.test",
    endpoint: {
      id: response.json<{ endpoint: { id: string } }>().endpoint.id,
      url: "https://api.example.test",
      label: "Primary API",
      username: "alice",
      sessionDuration: "7d",
      status: "connected",
      connected: true,
    },
  });
  assert.equal(response.body.includes("secret-token"), false);

  const config = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie: extractSessionCookie(response) },
  });
  assert.equal(config.statusCode, 200, config.body);
  assert.equal(config.body.includes("secret-token"), false);
  assert.equal(config.json<{ endpoints: unknown[] }>().endpoints.length, 1);
});

test("login replaces an unknown caller-supplied session cookie", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "https://api.example.test/login", () =>
    jsonResponse({ token: "victim-token" }),
  );

  const attackerCookie = "clab_session=attacker-chosen-id";
  const login = await context.app.inject({
    method: "POST",
    url: "/auth/login",
    headers: { cookie: attackerCookie },
    payload: {
      url: "https://api.example.test",
      username: "victim",
      password: "secret",
    },
  });
  assert.equal(login.statusCode, 200, login.body);
  const freshCookie = extractSessionCookie(login);
  assert.notEqual(freshCookie, attackerCookie);

  const attackerReplay = await context.app.inject({
    method: "GET",
    url: "/auth/me",
    headers: { cookie: attackerCookie },
  });
  assert.equal(attackerReplay.statusCode, 200, attackerReplay.body);
  assert.deepEqual(attackerReplay.json(), {
    authenticated: false,
    endpoints: [],
  });

  context.fetchMock.on(
    "GET",
    "https://api.example.test/api/v1/version",
    () => jsonResponse({ versionInfo: "connected" }),
  );
  const victim = await context.app.inject({
    method: "GET",
    url: "/auth/me",
    headers: { cookie: freshCookie },
  });
  assert.equal(victim.statusCode, 200, victim.body);
  assert.equal(victim.json<{ authenticated: boolean }>().authenticated, true);
});

test("adding credentials rotates an existing valid session cookie", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "https://attacker-api.test/login", () =>
    jsonResponse({ token: "attacker-token" }),
  );
  context.fetchMock.on("POST", "https://victim-api.test/login", () =>
    jsonResponse({ token: "victim-token" }),
  );

  const attacker = await loginEndpoint(context, {
    url: "https://attacker-api.test",
    username: "attacker",
  });
  const victimLogin = await context.app.inject({
    method: "POST",
    url: "/auth/endpoints/add",
    headers: { cookie: attacker.cookie },
    payload: {
      url: "https://victim-api.test",
      username: "victim",
      password: "secret",
    },
  });
  assert.equal(victimLogin.statusCode, 200, victimLogin.body);
  const rotatedCookie = extractSessionCookie(victimLogin);
  assert.notEqual(rotatedCookie, attacker.cookie);

  const attackerReplay = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie: attacker.cookie },
  });
  assert.deepEqual(attackerReplay.json<{ endpoints: unknown[] }>().endpoints, []);

  const victimConfig = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie: rotatedCookie },
  });
  assert.equal(victimConfig.json<{ endpoints: unknown[] }>().endpoints.length, 2);
});

test("GET /auth/me reports connected, expired, and offline endpoint states", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", /\/login$/, (call) => {
    return jsonResponse({ token: `${call.url.hostname}-token` });
  });
  context.fetchMock.on("GET", "http://connected.test/api/v1/version", (call) => {
    assert.equal(call.redirect, "error");
    return jsonResponse({ versionInfo: "connected" });
  });
  context.fetchMock.on("GET", "http://expired.test/api/v1/version", () => {
    return textResponse("expired", 401);
  });
  context.fetchMock.on("GET", "http://offline.test/api/v1/version", () => {
    throw new Error("offline");
  });

  let connected = await loginEndpoint(context, {
    url: "http://connected.test",
    label: "Connected",
  });
  connected = await loginEndpoint(
    context,
    {
      url: "http://expired.test",
      label: "Expired",
    },
    connected.cookie,
  );
  connected = await loginEndpoint(
    context,
    {
      url: "http://offline.test",
      label: "Offline",
    },
    connected.cookie,
  );

  const response = await context.app.inject({
    method: "GET",
    url: "/auth/me",
    headers: { cookie: connected.cookie },
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
      connected: endpoint.connected,
    })),
    [
      { label: "Connected", status: "connected", connected: true },
      { label: "Expired", status: "session_expired", connected: false },
      { label: "Offline", status: "offline", connected: false },
    ],
  );
});

test("endpoint preference updates reject invalid durations and persist valid ones", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const invalid = await context.app.inject({
    method: "PATCH",
    url: `/auth/endpoints/${endpointId}/preferences`,
    headers: { cookie },
    payload: { sessionDuration: "forever" },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);

  const valid = await context.app.inject({
    method: "PATCH",
    url: `/auth/endpoints/${endpointId}/preferences`,
    headers: { cookie },
    payload: { sessionDuration: "36h" },
  });
  assert.equal(valid.statusCode, 200, valid.body);
  assert.equal(
    valid.json<{ sessionDuration: string }>().sessionDuration,
    "36h",
  );

  const config = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie },
  });
  assert.equal(config.statusCode, 200, config.body);
  assert.equal(
    config.json<{ endpoints: Array<{ sessionDuration: string }> }>()
      .endpoints[0]?.sessionDuration,
    "36h",
  );
});

test("endpoint PATCH never forwards an existing token to a changed origin", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "https://server-a.test/login", () =>
    jsonResponse({ token: "server-a-token" }),
  );
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "https://server-a.test",
    username: "alice",
  });

  const response = await context.app.inject({
    method: "PATCH",
    url: `/auth/endpoints/${endpointId}`,
    headers: { cookie },
    payload: { url: "https://server-b.test", username: "bob" },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.match(response.json<{ error: string }>().error, /requires reconnecting/i);
  assert.equal(
    context.fetchMock.calls.some((call) => call.url.hostname === "server-b.test"),
    false,
  );
});

test("authenticated reconnect can move an endpoint to a new origin", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "https://server-a.test/login", () =>
    jsonResponse({ token: "server-a-token" }),
  );
  context.fetchMock.on("POST", "https://server-b.test/login", (call) => {
    assert.equal(call.headers.get("authorization"), null);
    assert.deepEqual(JSON.parse(call.body ?? "{}"), {
      username: "bob",
      password: "new-password",
      sessionDuration: "24h",
    });
    return jsonResponse({ token: "server-b-token" });
  });
  const original = await loginEndpoint(context, {
    url: "https://server-a.test",
    username: "alice",
  });

  const reconnect = await context.app.inject({
    method: "POST",
    url: `/auth/endpoints/${original.endpointId}/reconnect`,
    headers: { cookie: original.cookie },
    payload: {
      url: "https://server-b.test",
      username: "bob",
      password: "new-password",
    },
  });
  assert.equal(reconnect.statusCode, 200, reconnect.body);
  const rotatedCookie = extractSessionCookie(reconnect);
  const config = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie: rotatedCookie },
  });
  assert.deepEqual(
    config.json<{ endpoints: Array<{ url: string; username: string }> }>().endpoints,
    [
      {
        id: original.endpointId,
        label: "server-a.test",
        sessionDuration: "24h",
        url: "https://server-b.test",
        username: "bob",
      },
    ],
  );
});

test("saved endpoint can reconnect after its server session has expired", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "https://saved-server.test/login", (call) => {
    assert.deepEqual(JSON.parse(call.body ?? "{}"), {
      username: "alice",
      password: "new-password",
      sessionDuration: "7d",
    });
    return jsonResponse({ token: "fresh-token" });
  });

  const reconnect = await context.app.inject({
    method: "POST",
    url: "/auth/endpoints/saved-endpoint/reconnect",
    payload: {
      label: "Saved lab host",
      url: "https://saved-server.test",
      username: "alice",
      password: "new-password",
      sessionDuration: "7d",
    },
  });
  assert.equal(reconnect.statusCode, 200, reconnect.body);
  const freshCookie = extractSessionCookie(reconnect);

  const config = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie: freshCookie },
  });
  assert.deepEqual(config.json<{ endpoints: unknown[] }>().endpoints, [
    {
      id: "saved-endpoint",
      label: "Saved lab host",
      sessionDuration: "7d",
      url: "https://saved-server.test",
      username: "alice",
    },
  ]);
});

test("deleting the last endpoint clears the browser session", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const response = await context.app.inject({
    method: "DELETE",
    url: `/auth/endpoints/${endpointId}`,
    headers: { cookie },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers["set-cookie"]), /clab_session=;/);

  const config = await context.app.inject({
    method: "GET",
    url: "/api/config",
    headers: { cookie },
  });
  assert.deepEqual(config.json<{ endpoints: unknown[] }>().endpoints, []);
});

test("protected proxy routes return 401 without a valid session", async (t) => {
  const { app } = await createTestContext(t);

  const files = await app.inject({ method: "GET", url: "/files" });
  const inspectAll = await app.inject({
    method: "GET",
    url: "/api/runtime/inspect/all",
  });

  assert.equal(files.statusCode, 401, files.body);
  assert.equal(inspectAll.statusCode, 401, inspectAll.body);
});

test("/files proxies topology entries with bearer auth and Explorer topology refs", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/topology/files",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return jsonResponse([
        {
          labName: "demo",
          yamlFileName: "labs/demo.clab.yml",
          annotationsFileName: "labs/demo.clab.yml.annotations.json",
          hasAnnotations: true,
          deploymentState: "deployed",
        },
      ]);
    },
  );

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "GET",
    url: "/files",
    headers: { cookie },
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
        source: "standalone",
      },
    },
  ]);
});

test("/api/runtime/file-explorer/tree proxies workspace entries without topology polling", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/workspace/tree?path=labs",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return jsonResponse([
        {
          name: "demo.clab.yml",
          path: "labs/demo.clab.yml",
          kind: "file",
          size: 42,
          modifiedAt: "2026-05-18T18:00:00Z",
          hasChildren: false,
        },
        {
          name: "configs",
          path: "labs/configs",
          kind: "directory",
          hasChildren: true,
        },
      ]);
    },
  );
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/file-explorer/tree?path=labs",
    headers: { cookie, "x-endpoint-id": endpointId },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), [
    {
      endpointId,
      name: "demo.clab.yml",
      path: "labs/demo.clab.yml",
      kind: "file",
      hasChildren: false,
    },
    {
      endpointId,
      name: "configs",
      path: "labs/configs",
      kind: "directory",
      hasChildren: true,
    },
  ]);
});

test("/api/runtime/file-explorer/events forwards workspace NDJSON as SSE", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/workspace/events",
    (call) => {
      assert.ok(call.signal instanceof AbortSignal);
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return ndjsonResponse(
        `${JSON.stringify({
          type: "workspace-file",
          path: "labs/configs",
          parentPath: "labs",
          action: "delete",
        })}\n`,
      );
    },
  );
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/file-explorer/events",
    headers: {
      cookie,
      "x-endpoint-id": endpointId,
      origin: "https://localhost:5173",
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(
    response.headers["content-type"] as string,
    /text\/event-stream/,
  );
  assert.equal(
    response.headers["access-control-allow-origin"],
    "https://localhost:5173",
  );
  assert.match(
    response.body,
    /^:ok\n\nid: 1\ndata: {"type":"workspace-file","path":"labs\/configs","parentPath":"labs","action":"delete"}\n\n$/,
  );
});

test("/api/runtime/file-explorer/file writes workspace file content", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "PUT",
    "http://api.example.test/api/v1/labs/workspace/file?path=labs%2Fdemo.clab.yml",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("content-type"), "text/plain");
      assert.equal(call.body, "name: demo\n");
      return jsonResponse({ success: true });
    },
  );

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "PUT",
    url: "/api/runtime/file-explorer/file?path=labs%2Fdemo.clab.yml",
    headers: { cookie, "x-endpoint-id": endpointId },
    payload: {
      path: "labs/demo.clab.yml",
      content: "name: demo\n",
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    endpointId,
    path: "labs/demo.clab.yml",
    success: true,
  });
});

test("/api/runtime/file-explorer/file rejects large upstream files before reading", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/workspace/file?path=labs%2Fhuge.log",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return new Response("", {
        headers: { "content-length": String(1024 * 1024 + 1) },
      });
    },
  );

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/file-explorer/file?path=labs%2Fhuge.log",
    headers: { cookie, "x-endpoint-id": endpointId },
  });

  assert.equal(response.statusCode, 413, response.body);
  assert.match(response.json<{ error: string }>().error, /too large/i);
});

test("/api/runtime/file-explorer/file preserves upstream error status", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/workspace/file?path=labs%2Fmissing.txt",
    () => jsonResponse({ error: "File not found" }, 404),
  );

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/file-explorer/file?path=labs%2Fmissing.txt",
    headers: { cookie, "x-endpoint-id": endpointId },
  });

  assert.equal(response.statusCode, 404, response.body);
  assert.match(response.json<{ error: string }>().error, /404/);
});

test("/api/runtime/file-explorer/file forwards recursive deletes", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "DELETE",
    "http://api.example.test/api/v1/labs/workspace/file?path=labs%2Fconfigs&recursive=true",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return jsonResponse({ success: true });
    },
  );

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "DELETE",
    url: "/api/runtime/file-explorer/file?path=labs%2Fconfigs&recursive=true",
    headers: { cookie, "x-endpoint-id": endpointId },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    endpointId,
    path: "labs/configs",
    success: true,
  });
});

test("/api/runtime/file-explorer/download streams binary workspace files", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/workspace/file?path=labs%2Fimage.bin",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return bufferResponse(Buffer.from([0, 1, 2, 255]), {
        "content-type": "application/octet-stream",
      });
    },
  );

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/file-explorer/download?path=labs%2Fimage.bin",
    headers: { cookie, "x-endpoint-id": endpointId },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers["content-disposition"] as string, /image\.bin/);
  assert.deepEqual(response.rawPayload, Buffer.from([0, 1, 2, 255]));
});

test("/api/runtime/file-explorer/upload forwards multipart file bytes", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "PUT",
    "http://api.example.test/api/v1/labs/workspace/file?path=labs%2Fimage.bin",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("content-type"), "application/octet-stream");
      assert.equal(call.body, Buffer.from([0, 1, 2, 255]).toString());
      return jsonResponse({ success: true });
    },
  );
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const boundary = "----clab-test-boundary";
  const response = await context.app.inject({
    method: "POST",
    url: "/api/runtime/file-explorer/upload",
    headers: {
      cookie,
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "x-endpoint-id": endpointId,
    },
    payload: buildMultipartBody({
      boundary,
      fields: { path: "labs/image.bin" },
      files: [
        {
          content: Buffer.from([0, 1, 2, 255]),
          fieldName: "file",
          filename: "image.bin",
        },
      ],
    }),
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    endpointId,
    filesWritten: 1,
    path: "labs/image.bin",
    paths: ["labs/image.bin"],
    success: true,
  });
});

test("/api/runtime/file-explorer/upload forwards multiple files to a directory target", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  const written = new Map<string, string | undefined>();
  for (const pathValue of [
    "labs/configs/leaf.cfg",
    "labs/configs/spine.cfg",
  ] as const) {
    context.fetchMock.on(
      "PUT",
      `http://api.example.test/api/v1/labs/workspace/file?path=${encodeURIComponent(pathValue)}`,
      (call) => {
        assert.equal(call.headers.get("authorization"), "Bearer secret-token");
        written.set(pathValue, call.body);
        return jsonResponse({ success: true });
      },
    );
  }
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const boundary = "----clab-test-multi-boundary";
  const response = await context.app.inject({
    method: "POST",
    url: "/api/runtime/file-explorer/upload",
    headers: {
      cookie,
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "x-endpoint-id": endpointId,
    },
    payload: buildMultipartBody({
      boundary,
      fields: { path: "labs/configs", targetKind: "directory" },
      files: [
        {
          content: Buffer.from("leaf\n"),
          contentType: "text/plain",
          fieldName: "file",
          filename: "leaf.cfg",
        },
        {
          content: Buffer.from("spine\n"),
          contentType: "text/plain",
          fieldName: "file",
          filename: "spine.cfg",
        },
      ],
    }),
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    endpointId,
    filesWritten: 2,
    path: "labs/configs/leaf.cfg",
    paths: ["labs/configs/leaf.cfg", "labs/configs/spine.cfg"],
    success: true,
  });
  assert.deepEqual(written, new Map([
    ["labs/configs/leaf.cfg", "leaf\n"],
    ["labs/configs/spine.cfg", "spine\n"],
  ]));
});

test("/api/runtime/labs/archive downloads all files from a direct lab folder", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  mockDirectLabArchiveWorkspace(context);

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/labs/archive?path=srl-mirroring-lab&format=zip",
    headers: { cookie, "x-endpoint-id": endpointId },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.rawPayload.readUInt32LE(0), 0x04034b50);
  assert.match(response.headers["content-disposition"] as string, /srl-mirroring-lab\.zip/);
  assert.match(response.rawPayload.toString("utf8"), /srl-mirroring-lab\/srl-mirroring-lab\.clab\.yml/);
  assert.match(response.rawPayload.toString("utf8"), /srl-mirroring-lab\/configs\/leaf\.cfg/);
});

test("/api/runtime/labs/archive downloads tar.gz archives", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  mockDirectLabArchiveWorkspace(context);

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/labs/archive?path=srl-mirroring-lab&format=tar.gz",
    headers: { cookie, "x-endpoint-id": endpointId },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["content-type"], "application/gzip");
  assert.match(response.headers["content-disposition"] as string, /srl-mirroring-lab\.tar\.gz/);
  const tarContent = gunzipSync(response.rawPayload).toString("utf8");
  assert.match(tarContent, /srl-mirroring-lab\/srl-mirroring-lab\.clab\.yml/);
  assert.match(tarContent, /srl-mirroring-lab\/configs\/leaf\.cfg/);
  assert.match(tarContent, /set \/ system/);
});

test("/api/runtime/labs/archive rejects nested folder download targets", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });
  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/labs/archive?path=srl-mirroring-lab%2Fconfigs&format=zip",
    headers: { cookie, "x-endpoint-id": endpointId },
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.match(response.json<{ error: string }>().error, /direct lab folders/i);
});

test("/api/lab/deploy/stream forwards lifecycle NDJSON and topology path", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const upstreamBody = `${JSON.stringify({ type: "log", line: "deploying", stream: "stdout" })}\n${JSON.stringify({ type: "done", message: "deployed" })}\n`;
  context.fetchMock.on(
    "POST",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/demo\/deploy\?/,
    (call) => {
      assert.ok(call.signal instanceof AbortSignal);
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("content-type"), "application/json");
      assert.equal(call.body, "{}");
      assert.equal(call.url.searchParams.get("stream"), "true");
      assert.equal(call.url.searchParams.get("path"), "labs/demo.clab.yml");
      assert.equal(call.url.searchParams.get("reconfigure"), "true");
      assert.equal(call.url.searchParams.get("cleanup"), null);
      return ndjsonResponse(upstreamBody);
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/deploy/stream",
    headers: {
      cookie,
      origin: "https://localhost:5173",
    },
    payload: { cleanup: true, topologyRef: demoTopologyRef(endpointId) },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(
    response.headers["content-type"] as string,
    /application\/x-ndjson/,
  );
  assert.equal(
    response.headers["access-control-allow-origin"],
    "https://localhost:5173",
  );
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.equal(response.body, upstreamBody);
});

test("/api/lab/deploy reconciles upstream network errors", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  context.fetchMock.on(
    "POST",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/demo\/deploy\?/,
    () => {
      throw new TypeError("fetch failed");
    },
  );
  let inspectCalls = 0;
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/demo",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      inspectCalls += 1;
      if (inspectCalls === 1) {
        return jsonResponse({ error: "lab not found" }, 404);
      }
      return jsonResponse([{ name: "clab-demo-srl1" }]);
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/deploy",
    headers: { cookie },
    payload: { topologyRef: demoTopologyRef(endpointId) },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    success: true,
    reconciled: true,
    result: {
      labName: "demo",
      running: true,
    },
    message: "Lifecycle deploy result reconciled after the upstream connection was interrupted.",
    logs: [],
  });
});

test("/api/lab/destroy reconciles upstream network errors", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  context.fetchMock.on(
    "DELETE",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/demo\?/,
    () => {
      throw new TypeError("fetch failed");
    },
  );
  let inspectCalls = 0;
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/demo",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      inspectCalls += 1;
      if (inspectCalls === 1) {
        return jsonResponse([{ name: "clab-demo-srl1" }]);
      }
      return jsonResponse({ error: "lab not found" }, 404);
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/destroy",
    headers: { cookie },
    payload: {
      cleanup: true,
      topologyRef: demoTopologyRef(endpointId),
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    success: true,
    reconciled: true,
    result: {
      labName: "demo",
      running: false,
    },
    message: "Lifecycle destroy result reconciled after the upstream connection was interrupted.",
    logs: [],
  });
});

test("/api/lab/redeploy reports indeterminate upstream network errors as retryable", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  context.fetchMock.on(
    "PUT",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/demo\?/,
    () => {
      throw new TypeError("fetch failed");
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/redeploy",
    headers: { cookie },
    payload: {
      cleanup: true,
      topologyRef: demoTopologyRef(endpointId),
    },
  });

  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.headers["retry-after"], "5");
  assert.deepEqual(response.json(), {
    success: false,
    reconciled: false,
    error: "Lifecycle redeploy result is unknown after the upstream connection was interrupted. Retry after a short delay or refresh lab state.",
  });
});

test("/api/lab/start/stream forwards lab node lifecycle NDJSON", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const upstreamBody = `${JSON.stringify({ type: "done", message: "started" })}\n`;
  context.fetchMock.on(
    "POST",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/demo\/start\?/,
    (call) => {
      assert.ok(call.signal instanceof AbortSignal);
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("content-type"), "application/json");
      assert.equal(call.body, "{}");
      assert.equal(call.url.searchParams.get("stream"), "true");
      return ndjsonResponse(upstreamBody);
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/start/stream",
    headers: { cookie },
    payload: { topologyRef: demoTopologyRef(endpointId) },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body, upstreamBody);
});

test("/api/events includes CORS headers for direct Vite dev EventSource", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    /^http:\/\/api\.example\.test\/api\/v1\/events\?/,
    (call) => {
      assert.ok(call.signal instanceof AbortSignal);
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.url.searchParams.get("initialState"), "true");
      assert.equal(call.url.searchParams.get("interfaceStats"), "true");
      return ndjsonResponse(`${JSON.stringify({ event: "ready" })}\n`);
    },
  );
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const response = await context.app.inject({
    method: "GET",
    url: `/api/events?endpointId=${endpointId}`,
    headers: {
      cookie,
      origin: "https://localhost:5173",
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(
    response.headers["content-type"] as string,
    /text\/event-stream/,
  );
  assert.equal(
    response.headers["access-control-allow-origin"],
    "https://localhost:5173",
  );
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.match(response.body, /^:ok\n\nid: 1\ndata: {"event":"ready"}\n\n$/);
});

test("/api/lab/destroy/stream forwards DELETE lifecycle request with cleanup", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const upstreamBody = `${JSON.stringify({ type: "done", message: "destroyed" })}\n`;
  context.fetchMock.on(
    "DELETE",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/demo\?/,
    (call) => {
      assert.ok(call.signal instanceof AbortSignal);
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("content-type"), null);
      assert.equal(call.body, undefined);
      assert.equal(call.url.searchParams.get("stream"), "true");
      assert.equal(call.url.searchParams.get("cleanup"), "true");
      return ndjsonResponse(upstreamBody);
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/destroy/stream",
    headers: { cookie },
    payload: {
      cleanup: true,
      topologyRef: demoTopologyRef(endpointId),
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body, upstreamBody);
});

test("/api/lab/redeploy/stream forwards PUT lifecycle request", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const upstreamBody = `${JSON.stringify({ type: "done", message: "redeployed" })}\n`;
  context.fetchMock.on(
    "PUT",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/demo\?/,
    (call) => {
      assert.ok(call.signal instanceof AbortSignal);
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("content-type"), "application/json");
      assert.equal(call.body, "{}");
      assert.equal(call.url.searchParams.get("stream"), "true");
      return ndjsonResponse(upstreamBody);
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/redeploy/stream",
    headers: { cookie },
    payload: { topologyRef: demoTopologyRef(endpointId) },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body, upstreamBody);
});

test("/api/lab/apply keeps editable topology lab name when runtime lab name differs", async (t) => {
  const context = await createTestContext(t);
  mockVlanMismatchTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  context.fetchMock.on(
    "POST",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/srlinux-vlan-handling-lab\/apply\?/,
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("content-type"), "application/json");
      assert.equal(call.body, "{}");
      assert.equal(call.url.searchParams.get("path"), "vlan.clab.yml");
      assert.equal(call.url.searchParams.get("includeLogs"), "true");
      return jsonResponse({
        labName: "vlan",
        addedNodes: ["client4"],
        deletedNodes: [],
      });
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/apply",
    headers: { cookie },
    payload: { topologyRef: vlanMismatchTopologyRef(endpointId) },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    success: true,
    result: {
      labName: "vlan",
      addedNodes: ["client4"],
      deletedNodes: [],
    },
    logs: [],
  });
});

test("/api/lab/apply/stream keeps editable topology lab name when runtime lab name differs", async (t) => {
  const context = await createTestContext(t);
  mockVlanMismatchTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const upstreamBody = `${JSON.stringify({ type: "done", message: "applied" })}\n`;
  context.fetchMock.on(
    "POST",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/srlinux-vlan-handling-lab\/apply\?/,
    (call) => {
      assert.ok(call.signal instanceof AbortSignal);
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("content-type"), "application/json");
      assert.equal(call.body, "{}");
      assert.equal(call.url.searchParams.get("stream"), "true");
      assert.equal(call.url.searchParams.get("path"), "vlan.clab.yml");
      return ndjsonResponse(upstreamBody);
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/apply/stream",
    headers: { cookie },
    payload: { topologyRef: vlanMismatchTopologyRef(endpointId) },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body, upstreamBody);
});

test("/api/lab/deploy/stream converts upstream stream errors to NDJSON errors", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  const firstChunk = `${JSON.stringify({ type: "log", line: "starting", stream: "stdout" })}\n`;
  context.fetchMock.on(
    "POST",
    /^http:\/\/api\.example\.test\/api\/v1\/labs\/demo\/deploy\?/,
    (call) => {
      assert.ok(call.signal instanceof AbortSignal);
      return failingNdjsonResponse(firstChunk, "upstream stream reset");
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/lab/deploy/stream",
    headers: { cookie },
    payload: { topologyRef: demoTopologyRef(endpointId) },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(
    response.headers["content-type"] as string,
    /application\/x-ndjson/,
  );
  assert.match(
    response.body,
    /^{"type":"log","line":"starting","stream":"stdout"}\n/,
  );
  assert.match(
    response.body,
    /{"type":"error","error":"upstream stream reset"}\n$/,
  );
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
    label: "East",
  });
  const west = await loginEndpoint(
    context,
    {
      url: "http://west.test",
      label: "West",
    },
    east.cookie,
  );

  const response = await context.app.inject({
    method: "GET",
    url: "/api/runtime/inspect/all",
    headers: { cookie: west.cookie },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    "demo @ East": [{ name: "clab-demo-east" }],
    "demo @ West": [{ name: "clab-demo-west" }],
  });
});

test("/api/runtime/nodes/restart forwards node lifecycle request", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/demo",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return jsonResponse([
        {
          name: "clab-demo-leaf1",
          state: "running",
        },
      ]);
    },
  );
  context.fetchMock.on(
    "POST",
    "http://api.example.test/api/v1/labs/demo/nodes/clab-demo-leaf1/restart",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("content-type"), "application/json");
      assert.equal(call.body, "{}");
      return jsonResponse({ message: "Node restarted." });
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/runtime/nodes/restart",
    headers: { cookie },
    payload: {
      nodeName: "leaf1",
      topologyRef: demoTopologyRef(endpointId),
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { success: true });
});

test("/api/runtime/capture resolves unresolved topology prefix to runtime container name", async (t) => {
  const context = await createTestContext(t);
  mockLoginAndTopology(context);
  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
  });

  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/demo",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      return jsonResponse([
        {
          name: "demo-leaf2",
          state: "running",
        },
      ]);
    },
  );
  context.fetchMock.on(
    "POST",
    "http://api.example.test/api/v1/labs/demo/capture/wireshark-vnc-sessions",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.deepEqual(JSON.parse(call.body ?? "{}"), {
        targets: [{ containerName: "demo-leaf2", interfaceName: "e1-50" }],
        theme: "dark",
      });
      return jsonResponse({
        sessions: [
          {
            sessionId: "capture-1",
            labName: "demo",
            containerName: "demo-leaf2",
            interfaceNames: ["e1-50"],
            vncPath: "/api/v1/capture/wireshark-vnc-sessions/capture-1/vnc/",
            showVolumeTip: false,
            createdAt: "2026-05-18T00:00:00Z",
            expiresAt: "2026-05-18T01:00:00Z",
          },
        ],
      });
    },
  );

  const response = await context.app.inject({
    method: "POST",
    url: "/api/runtime/capture/wireshark-vnc-sessions",
    headers: { cookie },
    payload: {
      topologyRef: demoTopologyRef(endpointId),
      targets: [
        {
          containerName: '${LAB_PREFIX:-""}-demo-leaf2',
          interfaceName: "e1-50",
        },
      ],
      theme: "dark",
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(
    response.json<{ sessions: Array<{ containerName: string }> }>().sessions[0]
      ?.containerName,
    "demo-leaf2",
  );

  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/capture/wireshark-vnc-sessions/capture-1/vnc/index.html?view=fit",
    (call) => {
      assert.equal(call.headers.get("authorization"), "Bearer secret-token");
      assert.equal(call.headers.get("accept"), "text/html");
      assert.equal(call.headers.get("accept-encoding"), "identity");
      assert.equal(call.headers.get("range"), "bytes=0-9");
      assert.equal(call.headers.get("cookie"), null);
      assert.equal(call.headers.get("x-endpoint-id"), null);
      assert.equal(call.headers.get("proxy-authorization"), null);
      assert.equal(call.redirect, "error");
      return new Response("vnc client", {
        headers: {
          "clear-site-data": '"cookies"',
          "content-encoding": "gzip",
          "content-length": "999",
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "clab_session=upstream-known; Path=/; HttpOnly",
        },
      });
    },
  );
  const vncAsset = await context.app.inject({
    method: "GET",
    url: `/api/runtime/capture/wireshark-vnc-sessions/capture-1/vnc/index.html?view=fit&endpointId=${encodeURIComponent(endpointId)}`,
    headers: {
      accept: "text/html",
      "accept-encoding": "gzip",
      cookie,
      "proxy-authorization": "Basic browser-secret",
      range: "bytes=0-9",
      "x-endpoint-id": endpointId,
    },
  });
  assert.equal(vncAsset.statusCode, 200, vncAsset.body);
  assert.equal(vncAsset.body, "vnc client");
  assert.equal(vncAsset.headers["clear-site-data"], undefined);
  assert.equal(vncAsset.headers["content-encoding"], undefined);
  assert.equal(vncAsset.headers["content-length"], String(Buffer.byteLength("vnc client")));
  assert.equal(vncAsset.headers["set-cookie"], undefined);
  assert.match(String(vncAsset.headers["content-type"]), /^text\/html/);

  const upstreamCallCount = context.fetchMock.calls.length;
  const traversal = await context.app.inject({
    method: "GET",
    url: "/api/runtime/capture/wireshark-vnc-sessions/capture-1/vnc/..%2F..%2Fusers",
    headers: { cookie },
  });
  assert.equal(traversal.statusCode, 400, traversal.body);
  assert.equal(context.fetchMock.calls.length, upstreamCallCount);
});

test("terminal session creation resolves topology ref and short node name before proxying", async (t) => {
  const context = await createTestContext(t);
  context.fetchMock.on("POST", "http://api.example.test/login", () => {
    return jsonResponse({ token: "secret-token" });
  });
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/topology/files",
    () => {
      return jsonResponse([
        {
          labName: "demo",
          yamlFileName: "labs/demo.clab.yml",
          annotationsFileName: "labs/demo.clab.yml.annotations.json",
          hasAnnotations: true,
          deploymentState: "deployed",
        },
      ]);
    },
  );
  context.fetchMock.on(
    "GET",
    "http://api.example.test/api/v1/labs/demo",
    () => {
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
          owner: "",
        },
      ]);
    },
  );
  context.fetchMock.on(
    "POST",
    "http://api.example.test/api/v1/labs/demo/nodes/clab-demo-srl1/terminal-sessions",
    (call) => {
      assert.deepEqual(JSON.parse(call.body ?? "{}"), {
        protocol: "ssh",
        cols: 80,
        rows: 24,
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
        lastActivity: "2026-04-24T00:00:00Z",
      });
    },
  );

  const { cookie, endpointId } = await loginEndpoint(context, {
    url: "http://api.example.test",
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
        source: "standalone",
      },
      nodeName: "srl1",
      protocol: "ssh",
      cols: 80,
      rows: 24,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json<{ sessionId: string }>().sessionId, "terminal-1");
});
