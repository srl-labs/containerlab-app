import assert from "node:assert/strict";
import test from "node:test";

import { KUBERNETES_LIMITS, runtimeLimit, unsupportedReason } from "./kubernetesLimits";

test("Docker, Podman and an unknown lab host have no limits", () => {
  for (const runtime of ["docker", "podman"] as const) {
    for (const key of Object.keys(KUBERNETES_LIMITS) as Array<keyof typeof KUBERNETES_LIMITS>) {
      assert.equal(runtimeLimit({ runtime }, key), undefined, `${runtime} ${key}`);
    }
  }
  assert.equal(runtimeLimit(undefined, "nodeCpuSet"), undefined);
});

test("a Kubernetes lab host greys out what it refuses and hints at what it does differently", () => {
  const c9s = { runtime: "c9s" as const };
  assert.match(unsupportedReason(c9s, "nodeCpuSet") ?? "", /^Not supported on Kubernetes \(c9s\)/);
  assert.match(unsupportedReason(c9s, "mgmtNetworkOptions") ?? "", /^Ignored on Kubernetes \(c9s\)/);
  assert.equal(runtimeLimit(c9s, "nodeBinds")?.level, "partial");
  // Partly supported options stay editable: no reason to grey them out.
  assert.equal(unsupportedReason(c9s, "nodeBinds"), undefined);
  for (const limit of Object.values(KUBERNETES_LIMITS)) assert.match(limit.reason, /Kubernetes \(c9s\)/);
});
