import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLifecycleOptionsRequest,
  buildLifecycleRun,
  createLifecycleOptionsForm,
  labSettingsFromForm,
  timeoutDefaultLabel,
  timeoutError,
  isCleanupBlocked,
  lifecycleKindTakes,
  maxWorkersError,
  varsFileError,
  restoreError
} from "./lifecycleOptionsForm";
import { kubeNameError } from "./C9sDeployFields";

test("an untouched form runs the plain action without options", () => {
  assert.deepEqual(buildLifecycleOptionsRequest(createLifecycleOptionsForm("deploy")), {
    action: "deployLab",
    command: "containerlab deploy"
  });
  assert.deepEqual(buildLifecycleOptionsRequest(createLifecycleOptionsForm("destroy")), {
    action: "destroyLab",
    command: "containerlab destroy"
  });
});

test("cleanup picks the cleanup action", () => {
  const form = { ...createLifecycleOptionsForm("redeploy"), cleanup: true, graceful: true };
  assert.deepEqual(buildLifecycleOptionsRequest(form), {
    action: "redeployLabCleanup",
    options: { graceful: true },
    command: "containerlab redeploy -c --graceful"
  });
});

test("fields the action does not take are left out", () => {
  const form = {
    ...createLifecycleOptionsForm("redeploy"),
    nodeFilter: ["r1"],
    maxWorkers: " 3 ",
    exportTemplate: "__full"
  };
  assert.deepEqual(buildLifecycleOptionsRequest(form), {
    action: "redeployLab",
    options: { maxWorkers: 3, exportTemplate: "__full" },
    command: "containerlab redeploy --max-workers 3 --export-template __full"
  });
});

test("destroying some nodes cannot clean up", () => {
  const form = {
    ...createLifecycleOptionsForm("destroy"),
    cleanup: true,
    nodeFilter: ["r1", "r2"],
    keepMgmtNet: true
  };
  assert.equal(isCleanupBlocked(form), true);
  assert.deepEqual(buildLifecycleOptionsRequest(form), {
    action: "destroyLab",
    options: { nodeFilter: ["r1", "r2"], keepMgmtNet: true },
    command: "containerlab destroy --node-filter r1,r2 --keep-mgmt-net"
  });
  assert.equal(isCleanupBlocked({ ...form, kind: "deploy" }), false);
});

test("max workers must be a whole number above 0 when set", () => {
  assert.equal(maxWorkersError(""), undefined);
  assert.equal(maxWorkersError(" 8 "), undefined);
  assert.notEqual(maxWorkersError("0"), undefined);
  assert.notEqual(maxWorkersError("1.5"), undefined);
  assert.notEqual(maxWorkersError("many"), undefined);
});

test("a template variables file is passed with --vars, relative to the topology", () => {
  const form = { ...createLifecycleOptionsForm("destroy"), varsFile: " vars/prod.yml " };
  assert.deepEqual(buildLifecycleOptionsRequest(form), {
    action: "destroyLab",
    options: { varsFile: "vars/prod.yml" },
    command: "containerlab destroy --vars vars/prod.yml"
  });
  assert.equal(varsFileError(""), undefined);
  assert.equal(varsFileError("../common/vars.yml"), undefined);
  assert.notEqual(varsFileError("/etc/vars.yml"), undefined);
  assert.notEqual(varsFileError("vars file.yml"), undefined);
});

test("a deploy can restore VM snapshots", () => {
  const form = {
    ...createLifecycleOptionsForm("deploy"),
    restoreSnapshots: true,
    restore: [
      { node: "vm1", path: "golden/vm1.tar" },
      { node: "", path: "" }
    ]
  };
  assert.equal(restoreError(form), undefined);
  assert.deepEqual(buildLifecycleOptionsRequest(form), {
    action: "deployLab",
    options: { restoreAll: "snapshots", restore: [{ node: "vm1", path: "golden/vm1.tar" }] },
    command: "containerlab deploy --restore-all=snapshots --restore=vm1=golden/vm1.tar"
  });
  assert.notEqual(restoreError({ ...form, restoreAll: " ", restore: [] }), undefined);
  assert.equal(restoreError({ ...form, restoreSnapshots: false, restoreAll: "" }), undefined);
  // Switched off, the defaults stay out of the request.
  assert.equal(buildLifecycleOptionsRequest({ ...form, restoreSnapshots: false }).options, undefined);
});

test("on c9s the form sends the c9s options and drops the Docker-only ones", () => {
  const form = {
    ...createLifecycleOptionsForm("deploy", "c9s"),
    nodeFilter: ["leaf1"],
    skipPostDeploy: true,
    namespace: "team-a",
    exposeType: "LoadBalancer" as const,
    noPersistence: true,
    imagePullSecret: "regcred",
    noTopologyCR: true
  };
  assert.deepEqual(buildLifecycleOptionsRequest(form), {
    action: "deployLab",
    options: {
      noPersistence: true,
      noTopologyCR: true,
      namespace: "team-a",
      exposeType: "LoadBalancer",
      imagePullSecret: "regcred"
    },
    command:
      "containerlab deploy -r c9s --namespace team-a --expose-type LoadBalancer --no-persistence --image-pull-secret regcred --no-topology-cr"
  });
  assert.equal(lifecycleKindTakes("deploy", "nodeFilter", "c9s"), false);
  assert.equal(lifecycleKindTakes("destroy", "namespace", "c9s"), true);
  assert.equal(lifecycleKindTakes("destroy", "exposeType", "c9s"), false);
});

test("on Docker the c9s fields never reach the request", () => {
  const form = { ...createLifecycleOptionsForm("deploy"), namespace: "team-a", noTopologyCR: true };
  assert.deepEqual(buildLifecycleOptionsRequest(form), { action: "deployLab", command: "containerlab deploy" });
});

test("Kubernetes names are checked before running", () => {
  assert.equal(kubeNameError("", "namespace"), undefined);
  assert.equal(kubeNameError("team-a", "namespace"), undefined);
  assert.match(kubeNameError("Team_A", "namespace") ?? "", /Lowercase/);
  assert.equal(kubeNameError("registry.example-cred", "secret"), undefined);
});

test("a form starts from the lab's settings and gives them back", () => {
  const settings = { timeout: "30m", maxWorkers: 2, namespace: "team-a", noPersistence: true };
  const form = createLifecycleOptionsForm("redeploy", "c9s", settings);
  assert.equal(form.timeout, "30m");
  assert.equal(form.maxWorkers, "2");
  assert.deepEqual(buildLifecycleOptionsRequest(form), {
    action: "redeployLab",
    options: { timeout: "30m", maxWorkers: 2, noPersistence: true, namespace: "team-a" },
    command: "containerlab redeploy -r c9s --timeout 30m --max-workers 2 --namespace team-a --no-persistence"
  });
  assert.deepEqual(labSettingsFromForm({ ...form, nodeFilter: ["r1"], cleanup: true }), settings);
});

test("a lab host without a timeout parameter runs without it", () => {
  const form = { ...createLifecycleOptionsForm("deploy", "c9s"), timeout: "30m" };
  assert.equal(buildLifecycleRun(form, false, false).request.options, undefined);
  assert.deepEqual(buildLifecycleRun(form, false, true).request.options, { timeout: "30m" });
});

test("the timeout field takes Go durations", () => {
  assert.equal(timeoutError(""), undefined);
  assert.equal(timeoutError(" 45m "), undefined);
  assert.equal(timeoutError("45"), "Enter a duration such as 30m or 1h30m");
});

test("the Timeout names the lab host's default, or the lab server's when it does not report one", () => {
  // Before the lab host answers: containerlab's default for the runtime.
  assert.deepEqual(timeoutDefaultLabel("c9s", undefined), { placeholder: "10m", text: "10m" });
  assert.deepEqual(timeoutDefaultLabel("docker", undefined), { placeholder: "2m", text: "2m" });
  // This machine reports containerlab's; a lab server its own.
  assert.deepEqual(timeoutDefaultLabel("docker", { runtime: "docker", defaultTimeout: "5m" }), {
    placeholder: "5m",
    text: "5m"
  });
  assert.deepEqual(timeoutDefaultLabel("c9s", { runtime: "c9s" }), {
    placeholder: "Server default",
    text: "the lab server's default"
  });
});
