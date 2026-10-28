import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalEndpoints, resolveLocalBackendConfig as resolve } from "./localEndpointConfig.ts";

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
    env: {
      WEB_LOCAL_LABS: "true",
      WEB_LOCAL_WORKSPACE: "/home/alice/.clab",
      WEB_LOCAL_CLAB_BINARY: "/usr/local/bin/containerlab",
      WEB_LOCAL_WIRESHARK_IMAGE: "ghcr.io/srl-labs/wireshark-vnc-docker:dev"
    }
  });
  assert.equal(enabled.enabled, true);
  assert.deepEqual(enabled.options, {
    binaryPath: "/usr/local/bin/containerlab",
    workspaceRoot: "/home/alice/.clab",
    wiresharkImage: "ghcr.io/srl-labs/wireshark-vnc-docker:dev"
  });
});

test("the desktop app's own host can be a cluster: CONTAINERLAB_DESKTOP_RUNTIME=c9s", () => {
  const config = resolveLocalBackendConfig(
    "linux",
    {
      CONTAINERLAB_DESKTOP_RUNTIME: "c9s",
      CONTAINERLAB_DESKTOP_KUBE_CONTEXT: "kind-c9s-app",
      CONTAINERLAB_DESKTOP_KUBE_NAMESPACE: "team-a",
      CONTAINERLAB_DESKTOP_C9S_EXPOSE_TYPE: "LoadBalancer",
      CONTAINERLAB_DESKTOP_C9S_PERSISTENCE: "false"
    },
    undefined
  );
  assert.equal(config.enabled, true);
  assert.deepEqual(config.options, {
    runtime: "c9s",
    c9s: { kubeContext: "kind-c9s-app", namespace: "team-a", exposeType: "LoadBalancer", persistence: false }
  });
  assert.deepEqual(config.problems, []);
});

test("a cluster needs Linux too: containerlab on this computer drives it", () => {
  const env = { CONTAINERLAB_DESKTOP_RUNTIME: "c9s", CONTAINERLAB_DESKTOP_KUBE_CONTEXT: "kind-c9s-app" };
  const file = JSON.stringify({ clusters: [{ kubeContext: "lab-prod" }] });
  for (const platform of ["darwin", "win32"] as const) {
    for (const config of [resolveLocalBackendConfig(platform, env, undefined), resolveLocalBackendConfig(platform, {}, file)]) {
      assert.equal(config.enabled, false);
      assert.deepEqual(config.clusters, []);
      assert.deepEqual(config.problems, [
        "Kubernetes clusters are left out: containerlab runs on Linux only. Use a clab-api-server lab host, or run the app in WSL or a Linux VM."
      ]);
      assert.deepEqual(createLocalEndpoints(config, { label: "This computer" }), []);
    }
    // Nothing to report when no cluster is configured: the app starts on the sign-in page as before.
    assert.deepEqual(resolveLocalBackendConfig(platform, {}, undefined).problems, []);
  }
});

test("a cluster's kubeconfig may start with ~ and is part of its address", () => {
  const config = resolveLocalBackendConfig(
    "linux",
    { PATH: "/nonexistent" },
    JSON.stringify({
      enabled: true,
      clusters: [
        { kubeContext: "kind", kubeconfig: "~/kube/a" },
        { kubeContext: "kind", kubeconfig: "/k/b" },
        { kubeContext: "kind" }
      ]
    })
  );
  assert.equal(config.clusters[0]?.options.c9s?.kubeconfig, path.join(os.homedir(), "kube/a"));
  const endpoints = createLocalEndpoints(config, { label: "This computer" });
  assert.deepEqual(
    endpoints.map((endpoint) => endpoint.url),
    [
      "local://this-computer",
      `local://c9s/kind?kubeconfig=${encodeURIComponent(path.join(os.homedir(), "kube/a"))}`,
      "local://c9s/kind?kubeconfig=%2Fk%2Fb",
      "local://c9s/kind"
    ]
  );
  assert.equal(endpoints[2].backend.options.env.CLAB_KUBECONFIG, "/k/b");
});

test("local-backend.json lists clusters next to this computer", () => {
  const file = JSON.stringify({
    runtime: "docker",
    binaryPath: "/opt/containerlab",
    clusters: [
      { kubeContext: "lab-prod", label: "Lab prod", namespace: "labs", persistence: false },
      { kubeContext: "kind-dev", exposeType: "ClusterIP" },
      { label: "no context" },
      { kubeContext: "x", exposeType: "NodePort" },
      "nonsense"
    ]
  });
  const config = resolveLocalBackendConfig("linux", {}, file);
  assert.equal(config.enabled, true);
  assert.deepEqual(config.clusters, [
    {
      label: "Lab prod",
      options: { runtime: "c9s", c9s: { kubeContext: "lab-prod", namespace: "labs", persistence: false } },
      settings: { kubeContext: "lab-prod", label: "Lab prod", namespace: "labs", persistence: false }
    },
    {
      options: { runtime: "c9s", c9s: { kubeContext: "kind-dev", exposeType: "ClusterIP" } },
      settings: { kubeContext: "kind-dev", exposeType: "ClusterIP" }
    }
  ]);
  assert.deepEqual(config.problems, [
    "clusters[2] names no kubeContext.",
    'clusters[3]: exposeType "NodePort" is none of ClusterIP, Headless, LoadBalancer, None.',
    "clusters[4] is not an object."
  ]);
  // Like this computer, clusters need Linux.
  const mac = resolveLocalBackendConfig("darwin", {}, file);
  assert.equal(mac.enabled, false);
  assert.equal(mac.clusters.length, 0);
  assert.deepEqual(resolveLocalBackendConfig("linux", { CONTAINERLAB_DESKTOP_LOCAL: "0" }, file).clusters, []);
});

test("an unknown runtime is reported and turns the host off instead of guessing", () => {
  const config = resolveLocalBackendConfig("linux", { CONTAINERLAB_DESKTOP_RUNTIME: "lxd" }, undefined);
  assert.equal(config.enabled, false);
  assert.deepEqual(config.problems, ['Unknown lab runtime "lxd". Use docker, podman or c9s.']);
});

test("the web app runs labs on a cluster with WEB_LOCAL_RUNTIME=c9s", () => {
  const web = { envPrefix: "WEB_LOCAL_", enableVariable: "WEB_LOCAL_LABS", enabledByDefault: false };
  const config = resolve({ ...web, platform: "linux", env: { WEB_LOCAL_LABS: "1", WEB_LOCAL_RUNTIME: "c9s" } });
  assert.equal(config.enabled, true);
  assert.deepEqual(config.options, { runtime: "c9s", c9s: {} });
});

test("each local lab host gets its own address and label", () => {
  const config = resolveLocalBackendConfig(
    "linux",
    { PATH: "/nonexistent" },
    JSON.stringify({ clusters: [{ kubeContext: "lab-prod" }, { kubeContext: "lab-prod" }, { kubeContext: "kind dev" }] })
  );
  const endpoints = createLocalEndpoints(config, { label: "This computer" });
  assert.deepEqual(
    endpoints.map((endpoint) => endpoint.url),
    ["local://this-computer", "local://c9s/lab-prod", "local://c9s/kind%20dev"]
  );
  assert.deepEqual(
    endpoints.map((endpoint) => endpoint.backend.options.runtime),
    ["docker", "c9s", "c9s"]
  );
  assert.equal(endpoints[1].backend.options.env.CLAB_KUBE_CONTEXT, "lab-prod");
});
