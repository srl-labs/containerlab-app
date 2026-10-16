import assert from "node:assert/strict";
import test from "node:test";

import type { ClabTopology } from "../types/topology";

import {
  getInheritanceLayers,
  resolveInheritedConfig,
  resolveInheritedFrom,
  resolveNodeConfig,
  resolveNodeGroupName,
  resolveNodeKindName
} from "./NodeConfigResolver";

function topo(topology: ClabTopology["topology"]): ClabTopology {
  return { name: "t", topology };
}

test("kind names match case-insensitively, an exact name first", () => {
  const parsed = topo({
    kinds: { Nokia_SRLinux: { image: "upper" }, nokia_srlinux: { image: "exact" } },
    nodes: {}
  });
  assert.equal(resolveNodeConfig(parsed, { kind: "nokia_srlinux" }).image, "exact");
  assert.equal(resolveNodeConfig(parsed, { kind: "NOKIA_SRLINUX" }).image, "upper");
});

test("the kind comes from the node, its group, the default group, then defaults", () => {
  const parsed = topo({
    defaults: { kind: "linux", group: "base" },
    groups: { base: { kind: "nokia_srlinux" }, spine: { kind: "arista_ceos" } },
    nodes: {}
  });
  assert.equal(resolveNodeKindName(parsed, { kind: "frr" }), "frr");
  assert.equal(resolveNodeKindName(parsed, { group: "spine" }), "arista_ceos");
  assert.equal(resolveNodeKindName(parsed, {}), "nokia_srlinux");
  assert.equal(resolveNodeKindName(topo({ defaults: { kind: "linux" } }), {}), "linux");
});

test("the group comes from the node, its kind, then defaults", () => {
  const parsed = topo({
    defaults: { group: "base" },
    kinds: { nokia_srlinux: { group: "routers" } },
    groups: { base: { image: "b" }, routers: { image: "r" }, spine: { image: "s" } },
    nodes: {}
  });
  assert.equal(resolveNodeGroupName(parsed, { kind: "linux", group: "spine" }), "spine");
  assert.equal(resolveNodeGroupName(parsed, { kind: "nokia_srlinux" }), "routers");
  assert.equal(resolveNodeGroupName(parsed, { kind: "linux" }), "base");
  assert.equal(resolveNodeConfig(parsed, { kind: "nokia_srlinux" }).image, "r");
  assert.deepEqual(
    getInheritanceLayers(parsed, { kind: "nokia_srlinux" }).map((layer) => layer.name ?? layer.level),
    ["defaults", "nokia_srlinux", "routers"]
  );
});

test("a group wins over a kind, a kind over defaults, the node over all", () => {
  const parsed = topo({
    defaults: { image: "d", user: "d", cmd: "d", memory: "1G" },
    kinds: { linux: { image: "k", user: "k" } },
    groups: { g: { image: "g" } },
    nodes: {}
  });
  const resolved = resolveNodeConfig(parsed, { kind: "linux", group: "g", memory: "2G" });
  assert.equal(resolved.image, "g");
  assert.equal(resolved.user, "k");
  assert.equal(resolved.cmd, "d");
  assert.equal(resolved.memory, "2G");
});

test("maps and lists merge across every level", () => {
  const parsed = topo({
    defaults: {
      env: { A: "d", B: "d" },
      labels: { team: "core" },
      exec: ["echo d"],
      "cap-add": ["NET_ADMIN"],
      binds: ["/d:/data", "/x:/x:ro"]
    },
    kinds: { linux: { env: { B: "k" }, exec: ["echo k"], binds: ["/k:/data"] } },
    groups: { g: { env: { C: "g" }, sysctls: { "net.ipv4.ip_forward": 1 } } },
    nodes: {}
  });
  const resolved = resolveNodeConfig(parsed, {
    kind: "linux",
    group: "g",
    env: { C: "n" },
    exec: ["echo d", "echo n"],
    "cap-add": ["SYS_ADMIN"]
  });
  assert.deepEqual(resolved.env, { A: "d", B: "k", C: "n" });
  assert.deepEqual(resolved.labels, { team: "core" });
  assert.deepEqual(resolved.exec, ["echo d", "echo k", "echo n"]);
  assert.deepEqual(resolved["cap-add"], ["NET_ADMIN", "SYS_ADMIN"]);
  assert.deepEqual(resolved.binds, ["/k:/data", "/x:/x:ro"]);
  assert.deepEqual(resolved.sysctls, { "net.ipv4.ip_forward": 1 });
});

test("certificate fields and config vars merge, other blocks are replaced", () => {
  const parsed = topo({
    defaults: {
      certificate: { issue: true, "key-size": 2048 },
      config: { vars: { a: { x: 1, y: 1 } } },
      healthcheck: { test: ["CMD", "a"], retries: 3 }
    },
    kinds: { linux: { healthcheck: { test: ["CMD", "b"] } } },
    nodes: {}
  });
  const resolved = resolveNodeConfig(parsed, {
    kind: "linux",
    certificate: { "validity-duration": "720h" },
    config: { vars: { a: { y: 2 } } }
  });
  assert.deepEqual(resolved.certificate, {
    issue: true,
    "key-size": 2048,
    "validity-duration": "720h"
  });
  assert.deepEqual(resolved.config, { vars: { a: { x: 1, y: 2 } } });
  assert.deepEqual(resolved.healthcheck, { test: ["CMD", "b"] });
});

test("management addresses and aliases are never inherited", () => {
  const parsed = topo({
    defaults: { "mgmt-ipv4": "10.0.0.1", aliases: ["a"], "mgmt-net": "oob" },
    nodes: {}
  });
  const resolved = resolveNodeConfig(parsed, { kind: "linux" });
  assert.equal(resolved["mgmt-ipv4"], undefined);
  assert.equal(resolved.aliases, undefined);
  assert.equal(resolved["mgmt-net"], "oob");
  assert.deepEqual(resolveInheritedFrom(parsed, { kind: "linux" }), { "mgmt-net": "defaults" });
});

test("empty and zero values fall back to the inherited value where containerlab does", () => {
  const parsed = topo({
    kinds: { linux: { image: "k", cpu: 2, "startup-delay": 5, "auto-remove": true } },
    nodes: {}
  });
  const resolved = resolveNodeConfig(parsed, {
    kind: "linux",
    image: "",
    cpu: 0,
    "startup-delay": 0,
    "auto-remove": false
  });
  assert.equal(resolved.image, "k");
  assert.equal(resolved.cpu, 2);
  assert.equal(resolved["startup-delay"], 5);
  assert.equal(resolved["auto-remove"], false);
});

test("inherited config leaves out the node's own values", () => {
  const parsed = topo({
    defaults: { kind: "linux", env: { A: "1" } },
    kinds: { linux: { image: "alpine", group: "edge" } },
    groups: { edge: { env: { B: "2" } } },
    nodes: {}
  });
  assert.deepEqual(resolveInheritedConfig(parsed, { image: "own", env: { C: "3" } }), {
    kind: "linux",
    group: "edge",
    image: "alpine",
    env: { A: "1", B: "2" }
  });
});
