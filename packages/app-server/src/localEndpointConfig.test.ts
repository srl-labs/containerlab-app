import assert from "node:assert/strict";
import test from "node:test";

import { resolveLocalBackendConfig as resolve } from "./localEndpointConfig.ts";

const DESKTOP = { envPrefix: "CONTAINERLAB_DESKTOP_", enableVariable: "CONTAINERLAB_DESKTOP_LOCAL", enabledByDefault: true };

/** The desktop app's settings: `local-backend.json`, then CONTAINERLAB_DESKTOP_* variables. */
function resolveLocalBackendConfig(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, fileContent: string | undefined) {
  return resolve({ ...DESKTOP, platform, env, fileContent });
}

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

test("the web app runs labs on its host only when WEB_LOCAL_LABS is set", () => {
  const web = { envPrefix: "WEB_LOCAL_", enableVariable: "WEB_LOCAL_LABS", enabledByDefault: false };
  assert.equal(resolve({ ...web, platform: "linux", env: {} }).enabled, false);
  const enabled = resolve({
    ...web,
    platform: "linux",
    env: { WEB_LOCAL_LABS: "true", WEB_LOCAL_WORKSPACE: "/home/alice/.clab", WEB_LOCAL_CLAB_BINARY: "/usr/local/bin/containerlab" }
  });
  assert.equal(enabled.enabled, true);
  assert.deepEqual(enabled.options, { binaryPath: "/usr/local/bin/containerlab", workspaceRoot: "/home/alice/.clab" });
});
