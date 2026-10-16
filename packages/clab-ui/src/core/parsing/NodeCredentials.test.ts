import assert from "node:assert/strict";
import test from "node:test";

import * as YAML from "yaml";

import type { ClabTopology } from "../types/topology";

import { resolveNodeCredentials, resolveNodeCredentialsFromYaml } from "./NodeCredentials";

function topology(yaml: string): ClabTopology {
  return YAML.parse(yaml) as ClabTopology;
}

function resolve(parsed: ClabTopology, nodeName: string, inheritedOnly = false) {
  const node = parsed.topology?.nodes?.[nodeName] ?? {};
  return resolveNodeCredentials(parsed, node, { inheritedOnly });
}

const LEVELS = topology(`
topology:
  defaults:
    credentials:
      username: admin
      password: adminpw
      identity-file: ~/.ssh/lab
  kinds:
    nokia_srlinux:
      credentials:
        username: srl-admin
        password: srl-password
  groups:
    spines:
      credentials:
        identity-file: keys/spine
  nodes:
    srl1:
      kind: nokia_srlinux
    srl2:
      kind: nokia_srlinux
      credentials:
        password: only-password
    srl3:
      kind: nokia_srlinux
      group: spines
    linux1:
      kind: linux
`);

test("the most specific level with a username or password wins", () => {
  assert.deepEqual(resolve(LEVELS, "srl1"), {
    username: "srl-admin",
    password: "srl-password",
    source: "kind",
    identityFile: "~/.ssh/lab",
    identityFileSource: "defaults"
  });
  assert.deepEqual(resolve(LEVELS, "linux1"), {
    username: "admin",
    password: "adminpw",
    source: "defaults",
    identityFile: "~/.ssh/lab",
    identityFileSource: "defaults"
  });
});

test("username and password are not merged across levels", () => {
  const resolved = resolve(LEVELS, "srl2");
  assert.equal(resolved.source, "node");
  assert.equal(resolved.password, "only-password");
  assert.equal(resolved.username, undefined);
});

test("an identity file alone does not pick the login level", () => {
  // The group only sets identity-file, so the login still comes from the kind
  assert.deepEqual(resolve(LEVELS, "srl3"), {
    username: "srl-admin",
    password: "srl-password",
    source: "kind",
    identityFile: "keys/spine",
    identityFileSource: "group"
  });
});

test("inheritedOnly skips the node's own credentials", () => {
  const resolved = resolve(LEVELS, "srl2", true);
  assert.equal(resolved.source, "kind");
  assert.equal(resolved.username, "srl-admin");
});

test("kind names match case-insensitively and groups come from the kind", () => {
  const parsed = topology(`
topology:
  kinds:
    Nokia_SRLinux:
      group: leaves
  groups:
    leaves:
      credentials:
        username: leaf
  nodes:
    srl1:
      kind: nokia_srlinux
`);
  assert.deepEqual(resolve(parsed, "srl1"), { username: "leaf", source: "group" });
});

test("the node kind can come from the defaults group", () => {
  const parsed = topology(`
topology:
  defaults:
    group: base
  groups:
    base:
      kind: arista_ceos
  kinds:
    arista_ceos:
      credentials:
        username: ceos
        password: 1234
  nodes:
    ceos1: {}
`);
  assert.deepEqual(resolve(parsed, "ceos1"), {
    username: "ceos",
    password: "1234",
    source: "kind"
  });
});

test("resolveNodeCredentialsFromYaml tolerates bad YAML and unknown nodes", () => {
  assert.deepEqual(resolveNodeCredentialsFromYaml("topology: [", "srl1"), {});
  assert.deepEqual(resolveNodeCredentialsFromYaml("name: x\n", "srl1"), {});
  assert.deepEqual(
    resolveNodeCredentialsFromYaml(
      "topology:\n  nodes:\n    srl1:\n      credentials:\n        username: ops\n",
      "srl1"
    ),
    { username: "ops", source: "node" }
  );
});
