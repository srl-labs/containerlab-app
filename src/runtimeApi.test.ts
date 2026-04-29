import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeRequestUrl } from "./runtimeApi";

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
