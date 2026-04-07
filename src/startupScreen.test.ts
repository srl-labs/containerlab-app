import assert from "node:assert/strict";
import test from "node:test";

import { resolveStandaloneStartupScreen } from "./startupScreen";

test("resolveStandaloneStartupScreen shows login when no endpoints are saved", () => {
  assert.equal(resolveStandaloneStartupScreen([]), "login");
});

test("resolveStandaloneStartupScreen shows the app when only saved endpoints exist", () => {
  assert.equal(
    resolveStandaloneStartupScreen([{ status: "saved" }]),
    "app"
  );
});

test("resolveStandaloneStartupScreen shows the app for disconnected endpoint sessions", () => {
  assert.equal(
    resolveStandaloneStartupScreen([
      { status: "offline" },
      { status: "session_expired" }
    ]),
    "app"
  );
});

test("resolveStandaloneStartupScreen shows the app when any endpoint is connected", () => {
  assert.equal(
    resolveStandaloneStartupScreen([
      { status: "saved" },
      { status: "connected" }
    ]),
    "app"
  );
});
