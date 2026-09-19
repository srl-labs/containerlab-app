import assert from "node:assert/strict";
import test from "node:test";

import { listFileExplorerDirectory, resolveRuntimeRequestUrl, writeFileExplorerFile } from "./runtimeApi";

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
test.beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://app.example.test" } } });
});
test.afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("resolveRuntimeRequestUrl routes relative API paths through standalone backend origin", () => {
  assert.equal(
    resolveRuntimeRequestUrl("/api/runtime/nodes/restart", (path) => `https://localhost:3001${path}`),
    "https://localhost:3001/api/runtime/nodes/restart"
  );
});

test("resolveRuntimeRequestUrl keeps absolute request URLs unchanged", () => {
  assert.equal(
    resolveRuntimeRequestUrl("https://api.example.test/api/runtime/nodes/restart", () => {
      throw new Error("absolute URLs should not be rewritten");
    }),
    "https://api.example.test/api/runtime/nodes/restart"
  );
});

test("workspace reads recover after a transient browser network change", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) throw new TypeError("Failed to fetch");
    return Response.json([]);
  });
  await listFileExplorerDirectory("test", "@shared");
  assert.equal(calls, 2);
});

test("workspace reads stop retrying when the connection remains unavailable", async (t) => {
  const mocked = t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(listFileExplorerDirectory("test", "@shared"), /Failed to fetch/);
  assert.equal(mocked.mock.callCount(), 2);
});

test("workspace writes are never replayed after a network failure", async (t) => {
  const mocked = t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(writeFileExplorerFile({ endpointId: "test", path: "@shared/notes.txt", content: "new" }), /Failed to fetch/);
  assert.equal(mocked.mock.callCount(), 1);
});
