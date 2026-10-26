import assert from "node:assert/strict";
import test from "node:test";

import { bindSourcePath, resolveLabFileReference, resolveWorkspaceLabFile } from "./labFiles";

const scope = {
  labName: "dc",
  variables: { labName: "dc-main", topologyDir: "/home/u/labs", env: { CFG: "configs" } }
};

test("the host side of a bind is the part before the first colon", () => {
  assert.equal(bindSourcePath("configs/r1.cfg:/etc/r1.cfg:ro"), "configs/r1.cfg");
  assert.equal(bindSourcePath("/lib/modules:/lib/modules"), "/lib/modules");
  assert.equal(bindSourcePath("/data"), undefined);
  assert.equal(bindSourcePath(":/data"), undefined);
});

test("relative files open from the topology directory and may be created", () => {
  assert.deepEqual(resolveLabFileReference("configs/r1.cfg:/etc/r1.cfg", "bind", scope), {
    path: "configs/r1.cfg",
    create: true
  });
  assert.deepEqual(resolveLabFileReference(" startup/r1.txt ", "file", scope), {
    path: "startup/r1.txt",
    create: true
  });
  // Startup configs and licenses are files whatever their name.
  assert.deepEqual(resolveLabFileReference("license", "file", scope), { path: "license", create: true });
});

test("variables expand before a file opens", () => {
  assert.deepEqual(resolveLabFileReference("${CFG}/r1.cfg:/r1.cfg", "bind", scope), {
    path: "configs/r1.cfg",
    create: true
  });
  assert.deepEqual(resolveLabFileReference("${MISSING:=defaults}/r1.cfg:/r1.cfg", "bind", scope), {
    path: "defaults/r1.cfg",
    create: true
  });
  // The node directory is inside the topology directory, so it is opened relative to it.
  assert.deepEqual(
    resolveLabFileReference("__clabNodeDir__/flash/boot.cfg:/flash/boot.cfg", "bind", {
      ...scope,
      nodeName: "r1"
    }),
    { path: "clab-dc-main/r1/flash/boot.cfg", create: true }
  );
  assert.deepEqual(resolveLabFileReference("__clabDir__/ca.pem", "file", { labName: "dc" }), {
    path: "./clab-dc/ca.pem",
    create: true
  });
});

test("values that cannot be opened have no file", () => {
  // A directory bind, a container-only volume and a home directory path.
  assert.equal(resolveLabFileReference("configs:/configs", "bind", scope), undefined);
  assert.equal(resolveLabFileReference("/data", "bind", scope), undefined);
  assert.equal(resolveLabFileReference("~/.ssh/id_rsa.pub:/root/.ssh/key.pub", "bind", scope), undefined);
  // A variable without a value, and a node variable outside a node.
  assert.equal(resolveLabFileReference("$UNSET/r1.cfg:/r1.cfg", "bind", scope), undefined);
  assert.equal(resolveLabFileReference("__clabNodeDir__/a.cfg:/a.cfg", "bind", scope), undefined);
  // URLs and inline configs.
  assert.equal(resolveLabFileReference("https://example.com/r1.cfg", "file", scope), undefined);
  assert.equal(resolveLabFileReference("set system name r1\nset x", "file", scope), undefined);
  assert.equal(resolveLabFileReference("", "file", scope), undefined);
});

test("absolute paths open inside the topology directory, elsewhere without creating", () => {
  assert.deepEqual(resolveLabFileReference("/home/u/labs/cfg/r1.cfg:/r1.cfg", "bind", scope), {
    path: "cfg/r1.cfg",
    create: true
  });
  assert.deepEqual(resolveLabFileReference("/etc/hosts.allow:/etc/hosts.allow", "bind", scope), {
    path: "/etc/hosts.allow",
    create: false
  });
});

test("workspace paths start at the topology's workspace directory", () => {
  assert.equal(resolveWorkspaceLabFile({ path: "configs/r1.cfg" }, "labs/dc/dc.clab.yml"), "labs/dc/configs/r1.cfg");
  assert.equal(resolveWorkspaceLabFile({ path: "./r1.cfg" }, "dc.clab.yml"), "r1.cfg");
  assert.equal(resolveWorkspaceLabFile({ path: "../common/a.cfg" }, "labs/dc/dc.clab.yml"), "labs/common/a.cfg");
  assert.equal(resolveWorkspaceLabFile({ path: "../../../a.cfg" }, "labs/dc/dc.clab.yml"), undefined);
  assert.equal(
    resolveWorkspaceLabFile({ path: "configs/r1.cfg" }, "@shared/labs/dc.clab.yml"),
    "@shared/labs/configs/r1.cfg"
  );
});

test("absolute workspace paths need the topology directory and stay inside the workspace", () => {
  const topology = "labs/dc/dc.clab.yml";
  assert.equal(resolveWorkspaceLabFile({ path: "/srv/ws/labs/x.cfg" }, topology, "/srv/ws/labs/dc"), "labs/x.cfg");
  assert.equal(resolveWorkspaceLabFile({ path: "/srv/ws/labs/x.cfg" }, topology), undefined);
  assert.equal(resolveWorkspaceLabFile({ path: "/etc/hosts" }, topology, "/srv/ws/labs/dc"), undefined);
  // A directory that does not end in the topology's workspace directory has no workspace root.
  assert.equal(resolveWorkspaceLabFile({ path: "/srv/ws/x.cfg" }, topology, "/srv/other"), undefined);
  assert.equal(
    resolveWorkspaceLabFile({ path: "/srv/shared/labs/x.cfg" }, "@shared/labs/dc.clab.yml", "/srv/shared/labs"),
    "@shared/labs/x.cfg"
  );
  // Topologies outside the workspace have no workspace paths.
  assert.equal(resolveWorkspaceLabFile({ path: "x.cfg" }, "/opt/labs/dc.clab.yml"), undefined);
});
