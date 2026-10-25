import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLifecycleOptionsRequest,
  createLifecycleOptionsForm,
  isCleanupBlocked,
  maxWorkersError,
  varsFileError
} from "./lifecycleOptionsForm";

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
