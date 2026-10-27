import assert from "node:assert/strict";
import test from "node:test";

import {
  containerRuntimeFeatures,
  effectiveSupport,
  labHostRuntimeLabel,
  parseLabHostInfo,
  type LabBackendCapabilities,
  type LabBackendFeatures
} from "./labHostSupport";

const ALL_CAPABILITIES: LabBackendCapabilities = {
  sshAccess: true,
  deployFromUrl: true,
  importFromUrl: true,
  edgesharkManagement: true,
  wiresharkVnc: true,
  healthMetrics: true,
  sharedWorkspace: true,
  tailscaleStatus: true
};

function features(containerRuntime: boolean): LabBackendFeatures {
  return {
    validate: true,
    graphMermaid: true,
    graphDot: true,
    sshxReaders: true,
    gottyOptions: true,
    nodeStats: true,
    terminalResume: true,
    ...containerRuntimeFeatures(containerRuntime),
    manifestExport: !containerRuntime,
    c9sDeployOptions: !containerRuntime
  };
}

test("a Docker host offers what its backend kind can do", () => {
  const support = effectiveSupport(ALL_CAPABILITIES, features(true));
  assert.equal(support.edgesharkManagement, true);
  assert.equal(support.wiresharkVnc, true);
  assert.equal(support.healthMetrics, true);
  assert.equal(support.tailscaleStatus, true);
  assert.equal(support.netem, true);
  assert.equal(support.manifestExport, false);
});

test("the runtime narrows the static capabilities, never widens them", () => {
  const c9s = effectiveSupport(ALL_CAPABILITIES, features(false));
  assert.equal(c9s.edgesharkManagement, false);
  assert.equal(c9s.wiresharkVnc, false);
  assert.equal(c9s.healthMetrics, false);
  assert.equal(c9s.tailscaleStatus, false);
  assert.equal(c9s.sshAccess, true);
  assert.equal(c9s.sharedWorkspace, true);
  assert.equal(c9s.manifestExport, true);

  const local = effectiveSupport({ ...ALL_CAPABILITIES, tailscaleStatus: false, sshAccess: false }, features(true));
  assert.equal(local.tailscaleStatus, false);
  assert.equal(local.sshAccess, false);
});

test("host info from a transport keeps only well-formed values", () => {
  const support = effectiveSupport(ALL_CAPABILITIES, features(false));
  const parsed = parseLabHostInfo({
    profile: { runtime: "c9s", kubeContext: "kind-a", kubeconfig: "/k/a", namespaceMode: "fixed", namespace: "team-a", exposeType: "x" },
    support: { ...support, netem: "yes" }
  });
  assert.deepEqual(parsed?.profile, { runtime: "c9s", kubeContext: "kind-a", kubeconfig: "/k/a", namespaceMode: "fixed", namespace: "team-a" });
  assert.equal(parsed?.support.netem, false);
  assert.equal(parsed?.support.manifestExport, true);
  assert.equal(parseLabHostInfo({ profile: { runtime: "lxd" }, support: {} }), undefined);
  assert.equal(parseLabHostInfo(undefined), undefined);
});

test("runtime labels name the cluster and namespace", () => {
  assert.equal(labHostRuntimeLabel({ runtime: "docker" }), "Docker");
  assert.equal(labHostRuntimeLabel({ runtime: "podman" }), "Podman");
  assert.equal(labHostRuntimeLabel({ runtime: "c9s" }), "Kubernetes");
  assert.equal(labHostRuntimeLabel({ runtime: "c9s", kubeContext: "prod" }), "Kubernetes · prod");
  assert.equal(
    labHostRuntimeLabel({ runtime: "c9s", kubeContext: "prod", namespace: "team" }, "c9s-demo"),
    "Kubernetes · prod/c9s-demo"
  );
});
