import assert from "node:assert/strict";
import test from "node:test";

import { resolveStandaloneServerOrigin } from "./standaloneServerOrigin";

test("resolveStandaloneServerOrigin keeps production origin", () => {
  assert.equal(
    resolveStandaloneServerOrigin(
      { origin: "https://localhost:3000" },
      "https://localhost:3000",
      false
    ),
    "https://localhost:3000"
  );
});

test("resolveStandaloneServerOrigin routes Vite dev traffic to standalone backend", () => {
  assert.equal(
    resolveStandaloneServerOrigin(
      { origin: "https://localhost:5174" },
      "https://localhost:3000",
      true
    ),
    "https://localhost:3000"
  );
});

test("resolveStandaloneServerOrigin falls back to current origin for invalid config", () => {
  assert.equal(
    resolveStandaloneServerOrigin(
      { origin: "https://localhost:5174" },
      "not a url",
      true
    ),
    "https://localhost:5174"
  );
});
