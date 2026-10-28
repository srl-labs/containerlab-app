import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { effectiveSupport } from "../index.ts";
import { LocalLabBackend } from "./localLabBackend.ts";
import { containerlabPlatformProblem, detectLocalEnvironment, suidRootCheck } from "./detect.ts";
import { expandKubeconfigPath, resolveLocalOptions } from "./options.ts";

const ENV = { PATH: "/nonexistent", HOME: "/nonexistent" };

test("a Docker host keeps every container runtime feature and has no c9s options", async () => {
  const backend = new LocalLabBackend({ env: ENV, workspaceRoot: "/tmp/clab-docker" });
  assert.deepEqual(await backend.hostProfile(), { runtime: "docker" });
  const support = effectiveSupport(backend.capabilities, await backend.features());
  assert.equal(support.netem, true);
  assert.equal(support.edgesharkManagement, true);
  assert.equal(support.wiresharkVnc, true);
  assert.equal(support.healthMetrics, true);
  assert.equal(support.c9sDeployOptions, false);
  assert.equal(support.manifestExport, false);
  assert.equal(backend.scope, "local:/tmp/clab-docker");
});

test("a c9s host turns the container runtime features off and reports its cluster", async () => {
  const backend = new LocalLabBackend({
    env: ENV,
    workspaceRoot: "/tmp/clab-c9s",
    runtime: "c9s",
    c9s: { kubeContext: "kind-c9s-app", namespace: "team-a", exposeType: "LoadBalancer", persistence: false }
  });
  assert.deepEqual(await backend.hostProfile(), {
    runtime: "c9s",
    kubeContext: "kind-c9s-app",
    namespaceMode: "fixed",
    namespace: "team-a",
    exposeType: "LoadBalancer",
    persistence: false
  });
  const support = effectiveSupport(backend.capabilities, await backend.features());
  for (const flag of [
    "imageManagement",
    "netem",
    "snapshots",
    "nodePause",
    "fcli",
    "edgeshark",
    "edgesharkManagement",
    "wiresharkVnc",
    "healthMetrics",
    "shareTools",
    "hostCapture",
    "nodeStats"
  ] as const) {
    assert.equal(support[flag], false, flag);
  }
  assert.equal(support.c9sDeployOptions, true);
  assert.equal(support.manifestExport, true);
  // `inspect interfaces -r c9s` and `capture` work on a cluster; links to a capture need a server.
  assert.equal(support.interfaceInspect, true);
  assert.equal(support.captureStream, true);
  assert.equal(support.captureTickets, false);
  assert.equal(support.captureVnc, false);
  assert.equal(support.validate, true);
  assert.equal(backend.scope, "local-c9s:kind-c9s-app:/tmp/clab-c9s");
});

test("c9s options reach containerlab through its environment, never through sudo", () => {
  const resolved = resolveLocalOptions({
    runtime: " C9S ",
    sudo: true,
    env: { PATH: "/bin" },
    c9s: { kubeContext: "ctx", kubeconfig: "/k/config", namespace: " ns ", exposeType: "Bogus" as never }
  });
  assert.equal(resolved.runtime, "c9s");
  assert.equal(resolved.sudo, false);
  assert.deepEqual(resolved.c9s, { kubeContext: "ctx", kubeconfig: "/k/config", namespace: "ns" });
  assert.equal(resolved.env.CLAB_KUBE_CONTEXT, "ctx");
  assert.equal(resolved.env.CLAB_KUBECONFIG, "/k/config");
  assert.equal(resolved.env.CLAB_KUBE_NAMESPACE, "ns");

  const docker = resolveLocalOptions({ env: { PATH: "/bin" }, c9s: { kubeContext: "ignored" } });
  assert.equal(docker.c9s, undefined);
  assert.equal(docker.env.CLAB_KUBE_CONTEXT, undefined);
  assert.throws(() => resolveLocalOptions({ runtime: "lxd" }), /Unknown lab runtime "lxd"/);
});

test("a c9s host's kubeconfig may start with ~ and tells apart clusters with the same context name", async () => {
  const resolved = resolveLocalOptions({ runtime: "c9s", env: ENV, c9s: { kubeContext: "kind", kubeconfig: " ~/kube/a " } });
  assert.equal(resolved.c9s?.kubeconfig, path.join(os.homedir(), "kube/a"));
  assert.equal(resolved.env.CLAB_KUBECONFIG, path.join(os.homedir(), "kube/a"));
  assert.equal(expandKubeconfigPath(`~/a${path.delimiter}/b${path.delimiter}~`, "/home/u"), `/home/u/a${path.delimiter}/b${path.delimiter}/home/u`);
  assert.equal(expandKubeconfigPath("/x/~/y", "/home/u"), "/x/~/y");

  const fromFile = (kubeconfig?: string) =>
    new LocalLabBackend({
      env: ENV,
      workspaceRoot: "/tmp/clab-c9s",
      runtime: "c9s",
      c9s: { kubeContext: "kind", ...(kubeconfig ? { kubeconfig } : {}) }
    });
  assert.equal(fromFile().scope, "local-c9s:kind:/tmp/clab-c9s");
  assert.equal(fromFile("/k/a").scope, "local-c9s:kind@/k/a:/tmp/clab-c9s");
  assert.notEqual(fromFile("/k/a").scope, fromFile("/k/b").scope);
  assert.equal((await fromFile("/k/a").hostProfile()).kubeconfig, "/k/a");
  assert.equal((await fromFile().hostProfile()).kubeconfig, undefined);
});

test("containerlab runs on Linux only, also for a host whose labs run on a cluster", async () => {
  assert.equal(containerlabPlatformProblem("linux"), undefined);
  for (const platform of ["darwin", "win32"] as const) {
    assert.match(containerlabPlatformProblem(platform) ?? "", /^containerlab runs on Linux only\. Use a clab-api-server lab host, or run the app in WSL or a Linux VM\.$/);
    for (const runtime of ["docker", "c9s"]) {
      const status = await detectLocalEnvironment(
        { runtime, env: ENV, c9s: { kubeContext: "kind-c9s-app" } },
        {
          platform,
          kubeProbe: () => {
            throw new Error("the cluster is not asked");
          }
        }
      );
      assert.equal(status.available, false);
      assert.equal(status.platform, platform);
      assert.deepEqual(status.problems, [containerlabPlatformProblem(platform)]);
    }
  }
});

test("detection of a c9s host skips the Docker checks and asks the cluster", async () => {
  const status = await detectLocalEnvironment(
    { runtime: "c9s", env: ENV, binaryPath: "/nonexistent/containerlab", c9s: { kubeContext: "kind-c9s-app" } },
    {
      kubeProbe: () => ({
        context: "kind-c9s-app",
        serverVersion: async () => "v1.33.1",
        hasTopologyResource: async () => true,
        clabernetesVersion: async () => "0.11.0",
        canI: async () => true,
        whoAmI: async () => "alice"
      })
    }
  );
  assert.equal(status.runtime, "c9s");
  assert.equal(status.kubeContext, "kind-c9s-app");
  assert.equal(status.clabernetesVersion, "0.11.0");
  // Only containerlab is missing; nothing about Docker or groups.
  assert.equal(status.problems.length, 1);
  assert.match(status.problems[0], /containerlab is not installed/);
  assert.equal(status.available, false);
});

test("an unknown runtime is a detection problem, not a crash", async () => {
  const status = await detectLocalEnvironment({ runtime: "lxd", env: ENV });
  assert.equal(status.available, false);
  assert.deepEqual(status.problems, ['Unknown lab runtime "lxd". Use docker, podman or c9s.']);
});

test("a containerlab binary that is not SUID root is a failed check with the fix", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clab-suid-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binary = path.join(directory, "my containerlab");
  await fs.writeFile(binary, "#!/bin/sh\n", { mode: 0o755 });
  const check = await suidRootCheck(binary);
  assert.equal(check.status, "failed");
  assert.equal(check.message, `containerlab at ${binary} is not SUID root, so it cannot run Docker labs without sudo.`);
  assert.equal(check.command, `sudo chown root:root '${binary}' && sudo chmod 4755 '${binary}'`);
  assert.equal((await suidRootCheck(path.join(directory, "missing"))).status, "skipped");
});
