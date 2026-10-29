import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { KubeAccessCheck, KubeClusterProbe } from "./clusterProbe.ts";
import { imageTag } from "./clusterProbe.ts";
import { c9sPermissionChecks, detectC9sEnvironment } from "./detect.ts";
import { kubeconfigFiles, listKubeContexts, loadKubeConfig } from "./kubeConfig.ts";
import { C9S_MIN_CONTAINERLAB_VERSION, meetsMinimumVersion } from "./versions.ts";

/** A cluster that answers everything, with what each test overrides. */
function fakeProbe(overrides: Partial<KubeClusterProbe> = {}, denied: string[] = []): KubeClusterProbe {
  return {
    context: "kind-c9s",
    serverVersion: async () => "v1.33.1",
    hasTopologyResource: async () => true,
    clabernetesVersion: async () => "0.11.0",
    canI: async (check: KubeAccessCheck) =>
      !denied.includes(check.subresource ? `${check.resource}/${check.subresource}` : check.resource),
    whoAmI: async () => "alice",
    ...overrides
  };
}

const HOST = { env: {}, c9s: {} };

test("a ready cluster has no problems", async () => {
  const { checks, ...status } = await detectC9sEnvironment(HOST, "0.83.0", () => fakeProbe());
  assert.deepEqual(status, {
    problems: [],
    kubeContext: "kind-c9s",
    kubernetesVersion: "v1.33.1",
    clabernetesVersion: "0.11.0"
  });
  assert.deepEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ["containerlab", "ok"],
      ["kubeconfig", "ok"],
      ["cluster", "ok"],
      ["clabernetes", "ok"],
      ["access:topologies.c9s.run", "ok"],
      ["access:pods/exec", "ok"],
      ["access:pods/portforward", "ok"],
      ["access:pods/log", "ok"],
      ["access:namespaces", "ok"],
      ["access:namespaces:get", "ok"],
      ["access:namespaces:delete", "ok"]
    ]
  );
});

test("a check that stops the rest marks the later checks as skipped", async () => {
  const { checks } = await detectC9sEnvironment({ env: {}, c9s: { namespace: "team-a" } }, "0.83.0", () =>
    fakeProbe({ serverVersion: () => Promise.reject(new Error("connect ECONNREFUSED")) })
  );
  assert.deepEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ["containerlab", "ok"],
      ["kubeconfig", "ok"],
      ["cluster", "failed"],
      ["clabernetes", "skipped"],
      ["access:topologies.c9s.run", "skipped"],
      ["access:pods/exec", "skipped"],
      ["access:pods/portforward", "skipped"],
      ["access:pods/log", "skipped"]
    ]
  );
  assert.equal(checks[2].message, "connect ECONNREFUSED");
  assert.ok(checks[2].fix);
});

test("a missing permission comes with the binding command for the user the cluster sees", async () => {
  const fixed = await detectC9sEnvironment({ env: {}, c9s: { namespace: "team-a" } }, "0.83.0", () =>
    fakeProbe({}, ["pods/exec"])
  );
  const exec = fixed.checks.find((check) => check.id === "access:pods/exec");
  assert.equal(exec?.status, "failed");
  assert.equal(
    exec?.command,
    "kubectl create rolebinding clab-lab-editor-alice --clusterrole clabernetes-lab-editor --user alice -n team-a"
  );
  const perLab = await detectC9sEnvironment(HOST, "0.83.0", () =>
    fakeProbe({ whoAmI: async () => "system:serviceaccount:labs:runner" }, ["topologies"])
  );
  assert.equal(
    perLab.checks.find((check) => check.id === "access:topologies.c9s.run")?.command,
    "kubectl create clusterrolebinding clab-lab-editor-system-serviceaccount-labs-runner --clusterrole clabernetes-lab-editor --serviceaccount labs:runner"
  );
  const unknown = await detectC9sEnvironment({ env: {}, c9s: { namespace: "team-a" } }, "0.83.0", () =>
    fakeProbe({ whoAmI: async () => undefined }, ["pods/log"])
  );
  assert.match(unknown.checks.find((check) => check.id === "access:pods/log")?.command ?? "", /--user <your-user> -n team-a$/);
});

test("an old containerlab names the version it needs; a development build passes", async () => {
  const old = await detectC9sEnvironment(HOST, "0.82.0", () => fakeProbe());
  assert.equal(old.problems.length, 1);
  assert.match(old.problems[0], new RegExp(`containerlab ${C9S_MIN_CONTAINERLAB_VERSION.replace(/\./g, "\\.")} or later`));
  assert.match(old.problems[0], /0\.82\.0 is installed/);
  assert.deepEqual((await detectC9sEnvironment(HOST, "0.0.0", () => fakeProbe())).problems, []);
});

test("a kubeconfig that does not load stops the checks with its error", async () => {
  const status = await detectC9sEnvironment(HOST, "0.83.0", () => {
    throw new Error('The kubeconfig has no context "prod".');
  });
  assert.deepEqual(status.problems, ['The kubeconfig has no context "prod".']);
});

test("an unreachable cluster names its context", async () => {
  const status = await detectC9sEnvironment(HOST, "0.83.0", () =>
    fakeProbe({ serverVersion: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6443")) })
  );
  assert.deepEqual(status.problems, [
    'The cluster of context "kind-c9s" does not answer: connect ECONNREFUSED 127.0.0.1:6443'
  ]);
});

test("a cluster without clabernetes says to install it", async () => {
  const status = await detectC9sEnvironment(HOST, "0.83.0", () =>
    fakeProbe({ hasTopologyResource: async () => false })
  );
  assert.equal(status.problems.length, 1);
  assert.match(status.problems[0], /serves no topologies\.c9s\.run\. Install clabernetes 0\.11\.0 or later/);
});

test("an old clabernetes names the version it needs; an unreadable one is left to containerlab", async () => {
  const old = await detectC9sEnvironment(HOST, "0.83.0", () => fakeProbe({ clabernetesVersion: async () => "0.10.1" }));
  assert.deepEqual(old.problems, [
    "This lab host needs clabernetes 0.11.0 or later; the cluster runs 0.10.1. Upgrade clabernetes."
  ]);
  const hidden = await detectC9sEnvironment(HOST, "0.83.0", () =>
    fakeProbe({ clabernetesVersion: async () => undefined })
  );
  assert.deepEqual(hidden.problems, []);
  assert.equal(hidden.clabernetesVersion, undefined);
});

test("missing permissions name the permission, the namespace and the role to bind", async () => {
  const status = await detectC9sEnvironment({ env: {}, c9s: { namespace: "team-a" } }, "0.83.0", () =>
    fakeProbe({}, ["pods/exec", "pods/log"])
  );
  assert.deepEqual(status.problems, [
    "Your account cannot create pods/exec in namespace team-a. Bind clabernetes-lab-editor in team-a.",
    "Your account cannot get pods/log in namespace team-a. Bind clabernetes-lab-editor in team-a."
  ]);
});

test("a namespace per lab needs to get, create and delete namespaces", async () => {
  const status = await detectC9sEnvironment(HOST, "0.83.0", () => fakeProbe({}, ["namespaces"]));
  assert.equal(status.problems.length, 3);
  assert.match(status.problems[0], /cannot create namespaces.*Set the lab host's namespace/);

  // Creating alone passes deploy, then destroy --cleanup fails: the check says so up front.
  const deleteDenied = await detectC9sEnvironment(HOST, "0.83.0", () =>
    fakeProbe({ canI: async (check) => !(check.resource === "namespaces" && check.verb === "delete") })
  );
  assert.deepEqual(deleteDenied.problems, [
    "Your account cannot delete namespaces, which destroy --cleanup needs to remove the lab's namespace. Set the lab host's namespace to one you may use, or ask for the right to get, create and delete namespaces."
  ]);
  const failed = deleteDenied.checks?.find((check) => check.status === "failed");
  assert.equal(failed?.id, "access:namespaces:delete");
  assert.equal(failed?.label, "May delete namespaces (destroy --cleanup)");
  assert.match(failed?.fix ?? "", /get, create and delete namespaces/);
  assert.deepEqual(
    c9sPermissionChecks(undefined)
      .filter((check) => check.resource === "namespaces")
      .map((check) => check.verb),
    ["create", "get", "delete"]
  );
  assert.ok(c9sPermissionChecks(undefined).some((check) => check.resource === "namespaces"));
  assert.ok(!c9sPermissionChecks("team-a").some((check) => check.resource === "namespaces"));
});

test("a failing access review is reported, not taken as denied", async () => {
  const status = await detectC9sEnvironment({ env: {}, c9s: { namespace: "team-a" } }, "0.83.0", () =>
    fakeProbe({
      canI: async (check) => {
        if (check.subresource === "portforward") throw new Error("Unauthorized");
        return true;
      }
    })
  );
  assert.deepEqual(status.problems, [
    "Could not check whether your account can create pods/portforward: Unauthorized"
  ]);
});

test("versions compare numerically and development builds pass", () => {
  assert.equal(meetsMinimumVersion("0.83.0", "0.83.0"), true);
  assert.equal(meetsMinimumVersion("v0.100.1", "0.83.0"), true);
  assert.equal(meetsMinimumVersion("0.9.9", "0.83.0"), false);
  assert.equal(meetsMinimumVersion("1.0.0", "0.83.0"), true);
  assert.equal(meetsMinimumVersion("0.0.0", "0.83.0"), true);
  assert.equal(meetsMinimumVersion("dev-abc123", "0.11.0"), true);
});

test("image tags come from the reference without registry port or digest", () => {
  assert.equal(imageTag("ghcr.io/srl-labs/clabernetes/clabernetes-manager:0.11.0"), "0.11.0");
  assert.equal(imageTag("registry:5000/clabernetes-manager:dev@sha256:abc"), "dev");
  assert.equal(imageTag("registry:5000/clabernetes-manager"), undefined);
});

const KUBECONFIG = `apiVersion: v1
kind: Config
current-context: kind-a
clusters:
  - name: a
    cluster: { server: "https://127.0.0.1:6443" }
  - name: b
    cluster: { server: "https://127.0.0.1:7443" }
users:
  - name: u
    user: { token: "t" }
contexts:
  - name: kind-a
    context: { cluster: a, user: u }
  - name: kind-b
    context: { cluster: b, user: u, namespace: team-b }
`;

async function withKubeconfig(run: (file: string) => Promise<void> | void): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clab-kube-"));
  try {
    const file = path.join(directory, "config");
    await fs.writeFile(file, KUBECONFIG);
    await run(file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("the kubeconfig comes from the host, CLAB_KUBECONFIG, KUBECONFIG, then HOME", () => {
  assert.deepEqual(kubeconfigFiles({ kubeconfig: "/a" }, { KUBECONFIG: "/b" }), ["/a"]);
  assert.deepEqual(kubeconfigFiles({}, { CLAB_KUBECONFIG: "/c", KUBECONFIG: "/b" }), ["/c"]);
  assert.deepEqual(kubeconfigFiles({}, { KUBECONFIG: `/b${path.delimiter}/d` }), ["/b", "/d"]);
  assert.deepEqual(kubeconfigFiles({}, { HOME: "/home/u" }), ["/home/u/.kube/config"]);
  assert.deepEqual(kubeconfigFiles({ kubeconfig: "~/kube/a" }, { HOME: "/home/u" }), ["/home/u/kube/a"]);
});

test("the host's context is selected, and a missing one lists the others", async () => {
  await withKubeconfig((file) => {
    assert.equal(loadKubeConfig({ kubeconfig: file }, {}).getCurrentContext(), "kind-a");
    assert.equal(loadKubeConfig({ kubeconfig: file, kubeContext: "kind-b" }, {}).getCurrentContext(), "kind-b");
    assert.throws(
      () => loadKubeConfig({ kubeconfig: file, kubeContext: "prod" }, {}),
      /no context "prod"\. Pick one of: kind-a, kind-b/
    );
  });
  assert.throws(() => loadKubeConfig({ kubeconfig: "/nonexistent/kubeconfig" }, {}), /No kubeconfig found/);
});

test("contexts are listed for Add lab host", async () => {
  await withKubeconfig((file) => {
    assert.deepEqual(listKubeContexts({}, { KUBECONFIG: file }), [
      { name: "kind-a", cluster: "a", current: true },
      { name: "kind-b", cluster: "b", namespace: "team-b", current: false }
    ]);
  });
  assert.deepEqual(listKubeContexts({ kubeconfig: "/nonexistent/kubeconfig" }, {}), []);
});
