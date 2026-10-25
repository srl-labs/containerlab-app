import assert from "node:assert/strict";
import test from "node:test";

import {
  isPartialDestroy,
  labLifecycleCliFlags,
  labLifecycleQueryParams,
  normalizeLabLifecycleOptions
} from "./lifecycleOptions";

const EVERYTHING = {
  nodeFilter: ["r1", "r2"],
  maxWorkers: 4,
  skipPostDeploy: true,
  skipLabdirAcl: true,
  exportTemplate: "__full",
  graceful: true,
  keepMgmtNet: true
};

test("each action keeps only the options containerlab takes for it", () => {
  assert.deepEqual(normalizeLabLifecycleOptions("deploy", EVERYTHING), {
    nodeFilter: ["r1", "r2"],
    maxWorkers: 4,
    skipPostDeploy: true,
    skipLabdirAcl: true,
    exportTemplate: "__full"
  });
  assert.deepEqual(normalizeLabLifecycleOptions("redeploy", EVERYTHING), {
    maxWorkers: 4,
    skipPostDeploy: true,
    skipLabdirAcl: true,
    exportTemplate: "__full",
    graceful: true,
    keepMgmtNet: true
  });
  assert.deepEqual(normalizeLabLifecycleOptions("destroy", EVERYTHING), {
    nodeFilter: ["r1", "r2"],
    graceful: true,
    keepMgmtNet: true
  });
});

test("malformed or empty options are dropped", () => {
  assert.equal(normalizeLabLifecycleOptions("deploy", undefined), undefined);
  assert.equal(normalizeLabLifecycleOptions("deploy", "nodeFilter=r1"), undefined);
  assert.equal(normalizeLabLifecycleOptions("deploy", {}), undefined);
  assert.equal(
    normalizeLabLifecycleOptions("deploy", {
      nodeFilter: ["", "r1;rm -rf /", 3],
      maxWorkers: 0,
      skipPostDeploy: "true",
      exportTemplate: "../etc/passwd"
    }),
    undefined
  );
  assert.equal(normalizeLabLifecycleOptions("deploy", { maxWorkers: 2.5 }), undefined);
  assert.equal(normalizeLabLifecycleOptions("deploy", { exportTemplate: "a b" }), undefined);
});

test("node names are trimmed and de-duplicated", () => {
  assert.deepEqual(
    normalizeLabLifecycleOptions("destroy", { nodeFilter: [" r1 ", "r1", "leaf-2.a"] }),
    { nodeFilter: ["r1", "leaf-2.a"] }
  );
});

test("options turn into containerlab flags", () => {
  assert.deepEqual(labLifecycleCliFlags(undefined), []);
  assert.deepEqual(labLifecycleCliFlags(EVERYTHING), [
    "--node-filter",
    "r1,r2",
    "--max-workers",
    "4",
    "--skip-post-deploy",
    "--skip-labdir-acl",
    "--export-template",
    "__full",
    "--graceful",
    "--keep-mgmt-net"
  ]);
});

test("options turn into clab-api-server query parameters", () => {
  assert.deepEqual(labLifecycleQueryParams(undefined), []);
  assert.deepEqual(labLifecycleQueryParams(EVERYTHING), [
    ["nodeFilter", "r1,r2"],
    ["maxWorkers", "4"],
    ["skipPostDeploy", "true"],
    ["skipLabdirAcl", "true"],
    ["exportTemplate", "__full"],
    ["graceful", "true"],
    ["keepMgmtNet", "true"]
  ]);
});

test("a destroy with a node filter is partial", () => {
  assert.equal(isPartialDestroy(undefined), false);
  assert.equal(isPartialDestroy({ graceful: true }), false);
  assert.equal(isPartialDestroy({ nodeFilter: ["r1"] }), true);
});

test("a vars file applies to every action and maps to --vars and varsPath", () => {
  for (const kind of ["deploy", "redeploy", "destroy"] as const) {
    assert.deepEqual(normalizeLabLifecycleOptions(kind, { varsFile: " lab.clab_vars.prod.yml " }), {
      varsFile: "lab.clab_vars.prod.yml"
    });
  }
  assert.equal(normalizeLabLifecycleOptions("deploy", { varsFile: "/etc/passwd" }), undefined);
  assert.deepEqual(labLifecycleCliFlags({ varsFile: "vars.yml" }), ["--vars", "vars.yml"]);
  assert.deepEqual(labLifecycleQueryParams({ varsFile: "vars.yml" }), [["varsPath", "vars.yml"]]);
});
