import assert from "node:assert/strict";
import test from "node:test";
import undici, { Response } from "undici";

import { ApiLabBackend, containerForNode } from "./apiLabBackend.ts";

interface Recorded {
  method: string;
  url: URL;
  body?: string;
}

const CONTAINERS = [
  { name: "clab-demo-r1" },
  { name: "clab-demo-r2" },
  { name: "clab-demo-leaf-r2" }
];

let serverCount = 0;

/**
 * A clab-api-server stand-in on a fresh base URL (features are cached per
 * server). `/health` lists `features`; inspect returns CONTAINERS.
 */
function fakeServer(t: test.TestContext, features: string[] | undefined): {
  backend: ApiLabBackend;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  serverCount += 1;
  const baseUrl = `https://api-${serverCount}.test`;
  t.mock.method(undici, "fetch", (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push({ method, url, ...(init?.body ? { body: init.body } : {}) });
    const json = (value: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    if (url.pathname === "/health") {
      return json(features ? { status: "healthy", features } : { status: "healthy" });
    }
    if (method === "GET" && url.pathname === "/api/v1/labs/demo" && !url.searchParams.has("details")) {
      return json(CONTAINERS);
    }
    if (url.pathname.endsWith("/exec")) {
      const container = url.searchParams.get("nodeFilter") ?? "clab-demo-r1";
      return json({ [container]: [{ cmd: ["ls"], "return-code": 0, stdout: "ok", stderr: "" }] });
    }
    return json({ message: "done" });
  });
  return { backend: new ApiLabBackend({ baseUrl, token: "token" }), requests };
}

const ALL_FEATURES = [
  "exec-filters",
  "lab-lifecycle-node-filter",
  "save-copy",
  "inspect-details",
  "snapshot-save",
  "deploy-restore"
];

test("containers are found for topology node names", () => {
  assert.equal(containerForNode("demo", CONTAINERS, "r2"), "clab-demo-r2");
  assert.equal(containerForNode("demo", [{ name: "r1" }], "r1"), "r1");
  assert.equal(containerForNode("demo", [{ name: "pre-r3" }], "r3"), "pre-r3");
  assert.throws(() => containerForNode("demo", CONTAINERS, "r9"), { status: 404 });
});

test("a server's /health features decide what is supported", async (t) => {
  const { backend, requests } = fakeServer(t, ALL_FEATURES);
  assert.deepEqual(await backend.labOperationSupport(), {
    execByLabel: true,
    snapshotSave: true,
    deployRestore: true,
    saveCopy: true,
    inspectDetails: true
  });
  await backend.labOperationSupport();
  assert.equal(requests.filter((request) => request.url.pathname === "/health").length, 1);
});

test("servers without a feature list support none of the new operations", async (t) => {
  const { backend } = fakeServer(t, undefined);
  assert.deepEqual(Object.values(await backend.labOperationSupport()), [false, false, false, false, false]);
});

test("exec by node and label goes in one call on new servers", async (t) => {
  const { backend, requests } = fakeServer(t, ALL_FEATURES);
  await backend.exec({ labName: "demo" }, { command: "ls", nodeNames: ["r1", "r2"], labels: ["a=b", "c=d"] });
  const exec = requests.filter((request) => request.url.pathname.endsWith("/exec"));
  assert.equal(exec.length, 1);
  assert.equal(exec[0]?.url.searchParams.get("nodes"), "r1,r2");
  assert.deepEqual(exec[0]?.url.searchParams.getAll("label"), ["a=b", "c=d"]);
  assert.equal(exec[0]?.body, JSON.stringify({ command: "ls" }));
});

test("exec on older servers runs per container and refuses labels", async (t) => {
  const { backend, requests } = fakeServer(t, []);
  const result = await backend.exec({ labName: "demo" }, { command: "ls", nodeNames: ["r1", "r2"] });
  assert.deepEqual(Object.keys(result).sort(), ["clab-demo-r1", "clab-demo-r2"]);
  const exec = requests.filter((request) => request.url.pathname.endsWith("/exec"));
  assert.deepEqual(
    exec.map((request) => request.url.searchParams.get("nodeFilter")),
    ["clab-demo-r1", "clab-demo-r2"]
  );
  await assert.rejects(backend.exec({ labName: "demo" }, { command: "ls", labels: ["a=b"] }), {
    status: 501
  });
});

test("several nodes start in one call, or node by node on older servers", async (t) => {
  const current = fakeServer(t, ALL_FEATURES);
  await current.backend.nodesAction({ labName: "demo" }, ["r1", "r2"], "stop");
  const lab = current.requests.find((request) => request.url.pathname === "/api/v1/labs/demo/stop");
  assert.equal(lab?.url.searchParams.get("nodeFilter"), "r1,r2");

  t.mock.restoreAll();
  const older = fakeServer(t, []);
  await older.backend.nodesAction({ labName: "demo" }, ["r1", "r2"], "stop");
  const paths = older.requests.map((request) => request.url.pathname);
  assert.equal(paths.includes("/api/v1/labs/demo/stop"), false);
  assert.deepEqual(
    paths.filter((pathname) => pathname.includes("/nodes/")),
    ["/api/v1/labs/demo/nodes/clab-demo-r1/stop", "/api/v1/labs/demo/nodes/clab-demo-r2/stop"]
  );
});

test("save copy, snapshots, details and restore need the server feature", async (t) => {
  const { backend } = fakeServer(t, []);
  await assert.rejects(backend.save({ labName: "demo" }, { copyDir: "configs" }), { status: 501 });
  await assert.rejects(backend.saveSnapshots({ labName: "demo" }, {}), { status: 501 });
  await assert.rejects(backend.inspectLabDetails({ labName: "demo" }), { status: 501 });
  await assert.rejects(
    backend.runLifecycle("deploy", { labName: "demo" }, { lifecycleOptions: { restoreAll: "snapshots" } }),
    { status: 501 }
  );
  await backend.save({ labName: "demo" });
});

test("save copy, snapshots, details and restore reach the server", async (t) => {
  const { backend, requests } = fakeServer(t, ALL_FEATURES);
  await backend.save({ labName: "demo" }, { nodeFilter: "r1", copyDir: "configs" });
  await backend.saveSnapshots({ labName: "demo" }, { nodeNames: ["vm1"], outputDir: "snaps", timeout: "5m" });
  await backend.inspectLabDetails({ labName: "demo" });
  await backend.runLifecycle(
    "deploy",
    { labName: "demo", path: "demo.clab.yml" },
    { lifecycleOptions: { restoreAll: "snaps", restore: [{ node: "vm1", path: "x/vm1.tar" }] } }
  );
  const byPath = (pathname: string) => requests.find((request) => request.url.pathname === pathname);
  assert.equal(byPath("/api/v1/labs/demo/save")?.url.searchParams.get("copy"), "configs");
  assert.equal(
    byPath("/api/v1/labs/demo/snapshots")?.body,
    JSON.stringify({ nodes: ["vm1"], outputDir: "snaps", timeout: "5m" })
  );
  assert.ok(
    requests.some(
      (request) => request.url.pathname === "/api/v1/labs/demo" && request.url.searchParams.get("details") === "true"
    )
  );
  const deploy = byPath("/api/v1/labs/demo/deploy");
  assert.equal(deploy?.url.searchParams.get("restoreAll"), "snaps");
  assert.deepEqual(deploy?.url.searchParams.getAll("restore"), ["vm1=x/vm1.tar"]);
});
