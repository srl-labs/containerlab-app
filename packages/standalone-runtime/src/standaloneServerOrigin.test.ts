import assert from "node:assert/strict";
import test from "node:test";

import { resolveAppBasePath, resolveStandaloneServerOrigin, standaloneServerUrl } from "./standaloneServerOrigin";

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
      true,
      "standalone"
    ),
    "https://localhost:3000"
  );
});

test("resolveStandaloneServerOrigin keeps Pages mode on the current origin", () => {
  assert.equal(
    resolveStandaloneServerOrigin(
      { origin: "https://localhost:5174" },
      "https://localhost:3000",
      true,
      "pages"
    ),
    "https://localhost:5174"
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

test("app base resolution handles directories and HTML entrypoints", () => {
  for (const [documentUrl, expected] of [
    ["https://app.test/", "/"],
    ["https://app.test/index.html", "/"],
    ["https://app.test/terminal.html?target=example", "/"],
    ["https://app.test/wireshark.html?sessionId=capture", "/"],
    ["https://app.test/tools/clab/", "/tools/clab/"],
    ["https://app.test/tools/clab/terminal.html?target=example", "/tools/clab/"],
    ["invalid", "/"]
  ]) {
    assert.equal(resolveAppBasePath(documentUrl), expected, documentUrl);
  }
});

test("standalone requests retain the base path and target the configured server", () => {
  assert.equal(
    standaloneServerUrl("/api/config", "https://backend.test", "/tools/clab/", "standalone"),
    "https://backend.test/tools/clab/api/config"
  );
  assert.equal(
    standaloneServerUrl("/auth/endpoints/saved/reconnect", "https://backend.test", "/", "standalone"),
    "https://backend.test/auth/endpoints/saved/reconnect"
  );
});

test("Pages keeps API routes at the root independently of the site path", () => {
  for (const path of ["/files", "/api/topology/sessions", "/auth/me", "/api/events"]) {
    assert.equal(
      standaloneServerUrl(path, "https://pages.test", "/containerlab-app/", "pages"),
      `https://pages.test${path}`
    );
  }
});
