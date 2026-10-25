import assert from "node:assert/strict";
import test from "node:test";
import undici, { Response } from "undici";

import { ApiLabBackend } from "./apiLabBackend.ts";

interface RecordedRequest {
  url: URL;
  method: string;
  body?: unknown;
}

/** Answers like a clab-api-server that lists `features` on `/health`. */
function mockServer(
  t: test.TestContext,
  options: { features?: string[]; missingRoutes?: RegExp } = {}
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  t.mock.method(undici, "fetch", (input: unknown, init: { method?: string; body?: string } = {}) => {
    const url = new URL(String(input));
    requests.push({
      url,
      method: init.method ?? "GET",
      ...(init.body ? { body: JSON.parse(init.body) as unknown } : {})
    });
    if (url.pathname === "/health") {
      const health = { status: "healthy", ...(options.features ? { features: options.features } : {}) };
      return Promise.resolve(Response.json(health));
    }
    if (options.missingRoutes?.test(url.pathname)) {
      return Promise.resolve(new Response("404 page not found", { status: 404 }));
    }
    return Promise.resolve(Response.json({ message: "ok", link: "https://sshx.io/s/a#r,w" }));
  });
  return requests;
}

const NEW_SERVER = ["validate", "graph-mermaid", "graph-dot", "sshx-readers", "gotty-options"];

test("features come from the server's health endpoint and older servers list none", async (t) => {
  mockServer(t, { features: NEW_SERVER });
  const current = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });
  assert.deepEqual(await current.features(), {
    validate: true,
    graphMermaid: true,
    graphDot: true,
    sshxReaders: true,
    gottyOptions: true
  });

  t.mock.restoreAll();
  mockServer(t);
  // Features are cached per server, so the older server has its own URL.
  const older = new ApiLabBackend({ baseUrl: "https://older.test", token: "token" });
  assert.deepEqual(await older.features(), {
    validate: true,
    graphMermaid: false,
    graphDot: false,
    sshxReaders: false,
    gottyOptions: false
  });
});

test("graph exports go to the format's endpoint with the topology path", async (t) => {
  const requests = mockServer(t, { features: NEW_SERVER });
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });

  await backend.graphExport({ labName: "demo", path: "demo/demo.clab.yml" }, "mermaid", { direction: "LR" });
  await backend.graphExport({ labName: "demo" }, "dot");

  const [mermaid, dot] = requests.filter((request) => request.url.pathname.includes("/graph/"));
  assert.equal(mermaid.url.pathname, "/api/v1/labs/demo/graph/mermaid");
  assert.equal(mermaid.url.searchParams.get("path"), "demo/demo.clab.yml");
  assert.deepEqual(mermaid.body, { direction: "LR" });
  assert.equal(dot.url.pathname, "/api/v1/labs/demo/graph/dot");
  assert.deepEqual(dot.body, {});
});

test("an older server refuses graph exports and share options before anything runs", async (t) => {
  const requests = mockServer(t);
  const backend = new ApiLabBackend({ baseUrl: "https://older.test", token: "token" });

  await assert.rejects(backend.graphExport({ labName: "demo" }, "dot"), { status: 501 });
  await assert.rejects(backend.shareTool("sshx", "demo", "attach", { enableReaders: true }), {
    status: 501
  });
  await assert.rejects(
    backend.shareTool("gotty", "demo", "attach", { username: "lab", password: "secret" }),
    { status: 501 }
  );
  assert.ok(requests.every((request) => request.url.pathname === "/health"));

  // Plain sharing keeps working.
  await backend.shareTool("gotty", "demo", "attach", { port: 8081 });
  assert.equal(requests.at(-1)?.url.searchParams.get("port"), "8081");
});

test("share options travel in the request body", async (t) => {
  const requests = mockServer(t, { features: NEW_SERVER });
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });

  await backend.shareTool("sshx", "demo", "reattach", { enableReaders: true });
  await backend.shareTool("gotty", "demo", "attach", {
    port: 8081,
    username: "lab",
    password: "secret",
    shell: "sh"
  });
  await backend.shareTool("gotty", "demo", "detach", { username: "lab", password: "secret" });

  const shares = requests.filter((request) => request.url.pathname !== "/health");
  assert.deepEqual(shares[0].body, { enableReaders: true });
  assert.deepEqual(shares[1].body, { username: "lab", password: "secret", shell: "sh" });
  assert.equal(shares[1].url.searchParams.get("port"), "8081");
  assert.deepEqual(shares[2].body, {});

  await assert.rejects(
    backend.shareTool("gotty", "demo", "attach", { username: "lab", password: "a b" }),
    { status: 400 }
  );
});

test("validate on a server without the endpoint asks for an update", async (t) => {
  const requests = mockServer(t, { missingRoutes: /\/validate$/ });
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });

  await assert.rejects(backend.validate({ labName: "demo", path: "demo.clab.yml" }), {
    status: 501,
    message: /does not support topology validation/
  });
  assert.equal(requests[0].url.searchParams.get("path"), "demo.clab.yml");
});

test("generate never deploys or writes on the server", async (t) => {
  const requests = mockServer(t);
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });

  await backend.generateTopology({ name: "clos", tiers: [{ count: 2 }], images: { nokia_srlinux: "srl" } });

  assert.equal(requests[0].url.pathname, "/api/v1/generate");
  assert.deepEqual(requests[0].body, {
    name: "clos",
    tiers: [{ count: 2 }],
    images: { nokia_srlinux: "srl" },
    deploy: false
  });
});
