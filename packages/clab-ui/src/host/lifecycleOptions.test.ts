import assert from "node:assert/strict";
import test from "node:test";

import {
  isPartialDestroy,
  isValidLifecycleTimeout,
  labLifecycleCliFlags,
  labLifecycleOptionFields,
  labLifecycleQueryParams,
  labSettingsFromOptions,
  labSettingsOptions,
  normalizeLabLifecycleOptions,
  normalizeLabSettings,
  restoresSnapshots
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

test("snapshot restore is a deploy option", () => {
  const restore = {
    restoreAll: " snapshots ",
    restore: [
      { node: "r1", path: "snaps/r1.tar" },
      { node: "r1", path: "other/r1.tar" },
      { node: "bad name", path: "x.tar" },
      { node: "r2", path: "" },
      { node: "r3", path: "line\nbreak.tar" }
    ]
  };
  assert.deepEqual(normalizeLabLifecycleOptions("deploy", restore), {
    restoreAll: "snapshots",
    restore: [{ node: "r1", path: "other/r1.tar" }]
  });
  assert.equal(normalizeLabLifecycleOptions("redeploy", restore), undefined);
  assert.equal(normalizeLabLifecycleOptions("destroy", restore), undefined);
});

test("snapshot restore turns into flags and query parameters", () => {
  const options = {
    restoreAll: "snapshots",
    restore: [
      { node: "r1", path: "a b/r1.tar" },
      { node: "r2", path: "r2.tar" }
    ]
  };
  assert.deepEqual(labLifecycleCliFlags(options), [
    "--restore-all=snapshots",
    "--restore=r1=a b/r1.tar",
    "--restore=r2=r2.tar"
  ]);
  assert.deepEqual(labLifecycleQueryParams(options), [
    ["restoreAll", "snapshots"],
    ["restore", "r1=a b/r1.tar"],
    ["restore", "r2=r2.tar"]
  ]);
  assert.equal(restoresSnapshots(options), true);
  assert.equal(restoresSnapshots({ restore: [] }), false);
  assert.equal(restoresSnapshots(undefined), false);
});

test("the runtime filter hides container-only options on c9s and c9s options elsewhere", () => {
  assert.deepEqual(labLifecycleOptionFields("deploy", "c9s"), [
    "timeout",
    "maxWorkers",
    "varsFile",
    "namespace",
    "exposeType",
    "noPersistence",
    "imagePullSecret",
    "noTopologyCR"
  ]);
  assert.deepEqual(labLifecycleOptionFields("destroy", "c9s"), ["timeout", "varsFile", "namespace"]);
  assert.deepEqual(labLifecycleOptionFields("redeploy", "podman"), [
    "timeout",
    "maxWorkers",
    "skipPostDeploy",
    "skipLabdirAcl",
    "exportTemplate",
    "graceful",
    "keepMgmtNet",
    "varsFile"
  ]);
  assert.deepEqual(labLifecycleOptionFields("deploy"), labLifecycleOptionFields("deploy", "docker"));
  assert.ok(!labLifecycleOptionFields("deploy", "docker").includes("namespace"));
});

const C9S_OPTIONS = {
  ...EVERYTHING,
  restoreAll: "snapshots",
  namespace: " team-a ",
  exposeType: "LoadBalancer",
  noPersistence: true,
  imagePullSecret: "regcred",
  noTopologyCR: true
};

test("c9s keeps only the options containerlab takes under -r c9s", () => {
  assert.deepEqual(normalizeLabLifecycleOptions("deploy", C9S_OPTIONS, "c9s"), {
    maxWorkers: 4,
    noPersistence: true,
    noTopologyCR: true,
    namespace: "team-a",
    exposeType: "LoadBalancer",
    imagePullSecret: "regcred"
  });
  assert.deepEqual(normalizeLabLifecycleOptions("destroy", C9S_OPTIONS, "c9s"), {
    namespace: "team-a"
  });
  assert.equal(normalizeLabLifecycleOptions("deploy", { namespace: "team-a" }, "docker"), undefined);
});

test("malformed c9s options are dropped", () => {
  assert.equal(
    normalizeLabLifecycleOptions(
      "deploy",
      { namespace: "Team_A", exposeType: "NodePort", imagePullSecret: "-bad", noPersistence: "yes" },
      "c9s"
    ),
    undefined
  );
  assert.equal(normalizeLabLifecycleOptions("deploy", { namespace: "a".repeat(64) }, "c9s"), undefined);
});

test("c9s options turn into containerlab flags and no API parameters", () => {
  const options = normalizeLabLifecycleOptions("deploy", C9S_OPTIONS, "c9s");
  assert.deepEqual(labLifecycleCliFlags(options), [
    "--max-workers",
    "4",
    "--namespace",
    "team-a",
    "--expose-type",
    "LoadBalancer",
    "--no-persistence",
    "--image-pull-secret",
    "regcred",
    "--no-topology-cr"
  ]);
  assert.deepEqual(labLifecycleQueryParams(options), [["maxWorkers", "4"]]);
});

test("the timeout is a positive Go duration and a flag, but no API parameter", () => {
  for (const value of ["30m", "1h30m", "90s", "1.5h", "500ms"]) {
    assert.equal(isValidLifecycleTimeout(value), true, value);
  }
  for (const value of ["", "30", "0s", "-5m", "5 m", "10d", "5m;rm"]) {
    assert.equal(isValidLifecycleTimeout(value), false, value);
  }
  const options = normalizeLabLifecycleOptions("deploy", { timeout: " 30m ", maxWorkers: 2 }, "c9s");
  assert.deepEqual(options, { timeout: "30m", maxWorkers: 2 });
  assert.deepEqual(labLifecycleCliFlags(options), ["--timeout", "30m", "--max-workers", "2"]);
  assert.deepEqual(labLifecycleQueryParams(options), [["maxWorkers", "2"]]);
  assert.deepEqual(normalizeLabLifecycleOptions("destroy", { timeout: "5m" }, "docker"), { timeout: "5m" });
  assert.equal(normalizeLabLifecycleOptions("deploy", { timeout: "soon" }), undefined);
});

test("any runtime keeps the options of every runtime for the lab host to narrow", () => {
  assert.deepEqual(normalizeLabLifecycleOptions("deploy", { namespace: "team-a", skipPostDeploy: true }, "any"), {
    skipPostDeploy: true,
    namespace: "team-a"
  });
});

test("lab settings keep the options a lab remembers, not those of one run", () => {
  const settings = normalizeLabSettings({ ...C9S_OPTIONS, timeout: "20m", varsFile: "vars.yml" });
  assert.deepEqual(settings, {
    timeout: "20m",
    maxWorkers: 4,
    skipPostDeploy: true,
    skipLabdirAcl: true,
    exportTemplate: "__full",
    varsFile: "vars.yml",
    namespace: "team-a",
    exposeType: "LoadBalancer",
    noPersistence: true,
    imagePullSecret: "regcred",
    noTopologyCR: true
  });
  assert.deepEqual(normalizeLabSettings(C9S_OPTIONS, "docker"), {
    maxWorkers: 4,
    skipPostDeploy: true,
    skipLabdirAcl: true,
    exportTemplate: "__full"
  });
  assert.equal(normalizeLabSettings({ nodeFilter: ["r1"], restoreAll: "snapshots" }), undefined);
  assert.deepEqual(labSettingsFromOptions({ nodeFilter: ["r1"], timeout: "5m" }), { timeout: "5m" });
});

test("each action takes its part of the lab settings", () => {
  const settings = { timeout: "20m", maxWorkers: 4, namespace: "team-a", noTopologyCR: true };
  assert.deepEqual(labSettingsOptions("deploy", settings, "c9s"), settings);
  assert.deepEqual(labSettingsOptions("apply", settings, "c9s"), settings);
  assert.deepEqual(labSettingsOptions("destroy", settings, "c9s"), { timeout: "20m", namespace: "team-a" });
  assert.deepEqual(labSettingsOptions("redeploy", settings, "docker"), { timeout: "20m", maxWorkers: 4 });
  assert.equal(labSettingsOptions("deploy", undefined), undefined);
});
