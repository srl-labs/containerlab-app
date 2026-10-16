import assert from "node:assert/strict";
import test from "node:test";

import { resolveLocalBackendConfig } from "./localBackendConfig.ts";

test("the local endpoint is offered on Linux only", () => {
  assert.equal(resolveLocalBackendConfig("linux", {}, undefined).enabled, true);
  assert.equal(resolveLocalBackendConfig("darwin", {}, undefined).enabled, false);
  assert.equal(resolveLocalBackendConfig("win32", {}, undefined).enabled, false);
});

test("local-backend.json configures the backend and the environment overrides it", () => {
  const file = JSON.stringify({
    binaryPath: "/opt/clab/containerlab",
    runtime: "podman",
    workspaceRoot: "/srv/labs",
    sudo: true,
    deployExtraArgs: ["--max-workers", "2"],
    ignored: 42
  });
  assert.deepEqual(resolveLocalBackendConfig("linux", {}, file).options, {
    binaryPath: "/opt/clab/containerlab",
    runtime: "podman",
    workspaceRoot: "/srv/labs",
    sudo: true,
    deployExtraArgs: ["--max-workers", "2"]
  });

  const overridden = resolveLocalBackendConfig(
    "linux",
    {
      CONTAINERLAB_DESKTOP_RUNTIME: "docker",
      CONTAINERLAB_DESKTOP_WORKSPACE: "/tmp/labs",
      CONTAINERLAB_DESKTOP_SUDO: "false"
    },
    file
  ).options;
  assert.equal(overridden.runtime, "docker");
  assert.equal(overridden.workspaceRoot, "/tmp/labs");
  assert.equal(overridden.sudo, false);
});

test("the local endpoint can be turned off by file or environment", () => {
  assert.equal(resolveLocalBackendConfig("linux", {}, JSON.stringify({ enabled: false })).enabled, false);
  assert.equal(resolveLocalBackendConfig("linux", { CONTAINERLAB_DESKTOP_LOCAL: "0" }, undefined).enabled, false);
  assert.equal(
    resolveLocalBackendConfig("linux", { CONTAINERLAB_DESKTOP_LOCAL: "1" }, JSON.stringify({ enabled: false })).enabled,
    true
  );
  assert.equal(resolveLocalBackendConfig("linux", {}, "{not json").enabled, true);
});
