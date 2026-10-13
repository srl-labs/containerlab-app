import assert from "node:assert/strict";
import test from "node:test";

import { isInternalInterfaceName, nodeNamespaceInterfaceName } from "./runtimeInterfaces";

test("stitched link ports map to their name inside the node, per kind", () => {
  const stitched = (alias: string) => ({ name: "clab-s-6b26d4e7", alias });

  assert.equal(nodeNamespaceInterfaceName("nokia_srsim", stitched("1/1/c1/1")), "e1-1-c1-1");
  assert.equal(nodeNamespaceInterfaceName("nokia_srsim", stitched("1/x1/1/c2/3")), "e1-x1-1-c2-3");
  assert.equal(nodeNamespaceInterfaceName("nokia_srlinux", stitched("e1-1")), "e1-1");
  assert.equal(nodeNamespaceInterfaceName("nokia_srlinux", stitched("ethernet-1/3")), "e1-3");
  assert.equal(nodeNamespaceInterfaceName("nokia_srlinux", stitched("ethernet-1/3/2")), "e1-3-2");
  assert.equal(nodeNamespaceInterfaceName("linux", stitched("eth1")), "eth1");
  assert.equal(nodeNamespaceInterfaceName("ceos", stitched("eth2")), "eth2");
});

test("unknown vendor aliases keep the host-side link end", () => {
  assert.equal(
    nodeNamespaceInterfaceName("ceos", { name: "clab-s-6b26d4e7", alias: "Ethernet1" }),
    undefined
  );
  assert.equal(nodeNamespaceInterfaceName("nokia_srsim", { name: "clab-s-6b26d4e7" }), undefined);
});

test("interfaces already inside the node keep their name", () => {
  assert.equal(nodeNamespaceInterfaceName("ceos", { name: "eth0" }), "eth0");
  assert.equal(nodeNamespaceInterfaceName(undefined, { name: "e1-3", alias: "" }), "e1-3");
});

test("platform plumbing is internal, router ports are not", () => {
  assert.equal(isInternalInterfaceName("nokia_srsim", "_nokia_fabric"), true);
  assert.equal(isInternalInterfaceName("nokia_srlinux", "gway-2800"), true);
  assert.equal(isInternalInterfaceName("nokia_srlinux", "monit_in"), true);
  assert.equal(isInternalInterfaceName("nokia_srlinux", "mgmt0-0"), true);
  assert.equal(isInternalInterfaceName("nokia_srlinux", "mgmt0"), false);
  assert.equal(isInternalInterfaceName("nokia_srlinux", "e1-1"), false);
  assert.equal(isInternalInterfaceName("linux", "gway-2800"), false);
});
