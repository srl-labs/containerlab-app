import assert from "node:assert/strict";
import test from "node:test";

import * as YAML from "yaml";

import { editNodeInDoc } from "../io/NodePersistenceIO";
import { TopologyParser } from "../parsing/TopologyParser";
import type { ClabTopology } from "../types/topology";
import type { NodeEditorData } from "../types/editors";

import {
  convertEditorDataToNodeSaveData,
  convertEditorDataToYaml,
  convertToEditorData,
  isGoDuration,
  normalizeHealthcheckTest,
  normalizeImagePullPolicy
} from "./nodeEditorConversions";
import { convertTemplateToEditorData } from "./customNodeConversions";

/** Load a node into the editor the way the app does: YAML -> graph node -> editor data */
function openEditor(yaml: string, nodeId: string): NodeEditorData {
  const { topology } = TopologyParser.parseToReactFlow(yaml);
  const node = topology.nodes.find((entry) => entry.id === nodeId);
  assert.ok(node, `node ${nodeId} not found`);
  const editorData = convertToEditorData({ id: node.id, ...node.data });
  assert.ok(editorData);
  return editorData;
}

/** Open the editor, apply an edit and save it back into the YAML document */
function saveEdit(
  yaml: string,
  nodeId: string,
  edit: (data: NodeEditorData) => NodeEditorData = (data) => data
): string {
  const baseline = openEditor(yaml, nodeId);
  const edited = edit({ ...baseline });
  const saveData = convertEditorDataToNodeSaveData(edited, undefined, baseline);
  const doc = YAML.parseDocument(yaml);
  const result = editNodeInDoc(doc, saveData, doc.toJS() as ClabTopology);
  assert.deepEqual(result, { success: true, renamed: undefined });
  return doc.toString();
}

function nodeOf(yaml: string, nodeId: string): Record<string, unknown> {
  const parsed = YAML.parse(yaml) as {
    topology: { nodes: Record<string, Record<string, unknown>> };
  };
  return parsed.topology.nodes[nodeId];
}

/** Fixture YAML must survive a plain parse/stringify, so differences come from the editor */
function fixture(yaml: string): string {
  assert.equal(YAML.parseDocument(yaml).toString(), yaml);
  return yaml;
}

const RICH_TOPOLOGY = fixture(`name: roundtrip

topology:
  defaults:
    auto-remove: true
    enforce-startup-config: true
  kinds:
    nokia_srlinux:
      startup-delay: 5
  nodes:
    srl1:
      kind: nokia_srlinux # line card chassis
      type: ixr-6e
      image: ghcr.io/nokia/srlinux:latest
      custom-prompt: false
      components:
        - slot: 1
          type: imm36-800g-qsfpdd
        - slot: A
          type: cpm-ixr-6e
      auto-remove: false
      enforce-startup-config: false
      startup-delay: 0
      restart-policy: Always
      image-pull-policy: IfNotPresent
      runtime: podman
      network-mode: container:srl2
      env:
        PLAIN: text
        COUNT: 3
        ENABLED: true
      labels:
        team: core
        rack: 12
      sysctls:
        net.ipv4.ip_forward: 1
        net.ipv6.conf.all.disable_ipv6: "0"
      dns:
        servers:
          - 1.1.1.1
        search:
          - example.com
        options:
          - ndots:2
      certificate:
        issue: true
        key-size: 2048
        validity-duration: 720h
        sans:
          - srl1.example.com
      healthcheck:
        test:
          - CMD-SHELL
          - cat /etc/os-release
        start-period: 0
        interval: 30
        timeout: 10
        retries: 3
    srl2:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:latest
  links:
    - endpoints:
        - srl1:e1-1
        - srl2:e1-1
`);

const SROS_TOPOLOGY = fixture(`name: sros

topology:
  nodes:
    vsros:
      kind: nokia_sros
      image: vrnetlab/nokia_sros:25.3.R1
      type: sr-7s
      sfm: sfm2-s
      components:
        - slot: A
          type: cpm2-s
          cpu: 4
          ram: 6
        - slot: 1
          type: xcm2-7s
          max-nics: 8
          mda:
            - slot: 1
              type: x2-s36-800g-qsfpdd-18.0t
    sim:
      kind: nokia_srsim
      image: nokia_srsim:25.3.R1
      type: sr-7s
      sfm: m-sfm6-7/12
      components:
        - slot: A
          type: cpm2-s
        - slot: 1
          type: xcm2-7s
          env:
            NOKIA_SROS_LICENSE: /opt/license.txt
          mda:
            - slot: 1
              type: x2-s36-800g-qsfpdd-18.0t
  links: []
`);

test("saving an unchanged node keeps its YAML byte for byte", () => {
  assert.equal(saveEdit(RICH_TOPOLOGY, "srl1"), RICH_TOPOLOGY);
  assert.equal(saveEdit(RICH_TOPOLOGY, "srl2"), RICH_TOPOLOGY);
  assert.equal(saveEdit(SROS_TOPOLOGY, "vsros"), SROS_TOPOLOGY);
  assert.equal(saveEdit(SROS_TOPOLOGY, "sim"), SROS_TOPOLOGY);
});

test("the editor loads every field with its containerlab shape", () => {
  const data = openEditor(RICH_TOPOLOGY, "srl1");

  assert.equal(data.autoRemove, false);
  assert.equal(data.enforceStartupConfig, false);
  assert.equal(data.startupDelay, 0);
  assert.equal(data.restartPolicy, "always");
  assert.equal(data.imagePullPolicy, "IfNotPresent");
  assert.equal(data.runtime, "podman");
  assert.equal(data.networkMode, "container:srl2");
  assert.deepEqual(data.env, { PLAIN: "text", COUNT: 3, ENABLED: true });
  assert.deepEqual(data.labels, { team: "core", rack: 12 });
  assert.deepEqual(data.sysctls, {
    "net.ipv4.ip_forward": 1,
    "net.ipv6.conf.all.disable_ipv6": "0"
  });
  assert.deepEqual(data.dnsServers, ["1.1.1.1"]);
  assert.deepEqual(data.dnsSearch, ["example.com"]);
  assert.deepEqual(data.dnsOptions, ["ndots:2"]);
  assert.equal(data.certIssue, true);
  assert.equal(data.certKeySize, 2048);
  assert.equal(data.certValidity, "720h");
  assert.deepEqual(data.sans, ["srl1.example.com"]);
  assert.deepEqual(data.healthCheck, {
    test: ["CMD-SHELL", "cat /etc/os-release"],
    startPeriod: 0,
    interval: 30,
    timeout: 10,
    retries: 3
  });
  assert.equal(data.components?.length, 2);
});

test("editing one field leaves every other key of the node untouched", () => {
  const out = saveEdit(RICH_TOPOLOGY, "srl1", (data) => ({ ...data, user: "admin" }));
  // The new key is appended at the end of the node, everything else stays as written
  const expected = RICH_TOPOLOGY.replace(
    "          - cat /etc/os-release\n        start-period: 0\n        interval: 30\n        timeout: 10\n        retries: 3\n",
    "          - cat /etc/os-release\n        start-period: 0\n        interval: 30\n        timeout: 10\n        retries: 3\n      user: admin\n"
  );
  assert.equal(out, expected);
});

test("certificate edits write sans and an integer key-size", () => {
  const out = saveEdit(RICH_TOPOLOGY, "srl1", (data) => ({
    ...data,
    sans: [...(data.sans ?? []), "10.0.0.1"],
    certKeySize: 4096
  }));
  assert.deepEqual(nodeOf(out, "srl1").certificate, {
    issue: true,
    "key-size": 4096,
    "validity-duration": "720h",
    sans: ["srl1.example.com", "10.0.0.1"]
  });
  assert.ok(out.includes("key-size: 4096"));
  assert.ok(!out.includes("SANs"));
});

test("certificates written by older editor versions load and are rewritten correctly", () => {
  const legacy = fixture(`topology:
  nodes:
    n1:
      kind: linux
      certificate:
        issue: true
        key-size: "2048"
        SANs:
          - n1.lab
`);
  const data = openEditor(legacy, "n1");
  assert.equal(data.certKeySize, 2048);
  assert.deepEqual(data.sans, ["n1.lab"]);

  const out = saveEdit(legacy, "n1", (d) => ({ ...d, certValidity: "8760h" }));
  assert.deepEqual(nodeOf(out, "n1").certificate, {
    issue: true,
    "key-size": 2048,
    "validity-duration": "8760h",
    sans: ["n1.lab"]
  });
});

test("healthcheck test is saved as a list", () => {
  const out = saveEdit(RICH_TOPOLOGY, "srl1", (data) => ({
    ...data,
    healthCheck: { ...data.healthCheck, test: ["CMD", "ping", "-c", "1", "127.0.0.1"] }
  }));
  assert.deepEqual(nodeOf(out, "srl1").healthcheck, {
    test: ["CMD", "ping", "-c", "1", "127.0.0.1"],
    "start-period": 0,
    interval: 30,
    timeout: 10,
    retries: 3
  });
});

test("a healthcheck test written as a string loads as a list", () => {
  assert.deepEqual(normalizeHealthcheckTest("CMD-SHELL cat /etc/os-release"), [
    "CMD-SHELL",
    "cat /etc/os-release"
  ]);
  assert.deepEqual(normalizeHealthcheckTest("CMD ping -c 1 host"), [
    "CMD",
    "ping",
    "-c",
    "1",
    "host"
  ]);
  assert.deepEqual(normalizeHealthcheckTest("NONE"), ["NONE"]);
  assert.deepEqual(normalizeHealthcheckTest("curl -f localhost"), [
    "CMD-SHELL",
    "curl -f localhost"
  ]);
  assert.deepEqual(normalizeHealthcheckTest(["CMD", "ping", 1]), ["CMD", "ping", "1"]);

  const template = convertTemplateToEditorData({
    name: "old",
    kind: "linux",
    healthCheck: { test: "CMD-SHELL true" as unknown as string[], retries: 2 },
    certKeySize: "4096" as unknown as number
  });
  assert.deepEqual(template.healthCheck, { test: ["CMD-SHELL", "true"], retries: 2 });
  assert.equal(template.certKeySize, 4096);
});

test("dns is saved as a map with servers, search and options", () => {
  const out = saveEdit(RICH_TOPOLOGY, "srl2", (data) => ({
    ...data,
    dnsServers: ["8.8.8.8", ""],
    dnsSearch: ["lab.local"]
  }));
  assert.deepEqual(nodeOf(out, "srl2").dns, { servers: ["8.8.8.8"], search: ["lab.local"] });

  const edited = saveEdit(RICH_TOPOLOGY, "srl1", (data) => ({
    ...data,
    dnsOptions: [...(data.dnsOptions ?? []), "timeout:1"]
  }));
  assert.deepEqual(nodeOf(edited, "srl1").dns, {
    servers: ["1.1.1.1"],
    search: ["example.com"],
    options: ["ndots:2", "timeout:1"]
  });

  const cleared = saveEdit(RICH_TOPOLOGY, "srl1", (data) => ({
    ...data,
    dnsServers: [],
    dnsSearch: [],
    dnsOptions: []
  }));
  assert.equal(nodeOf(cleared, "srl1").dns, undefined);
});

test("a dns server list written by older editor versions loads as servers", () => {
  const legacy = fixture(`topology:
  nodes:
    n1:
      kind: linux
      dns:
        - 9.9.9.9
`);
  const data = openEditor(legacy, "n1");
  assert.deepEqual(data.dnsServers, ["9.9.9.9"]);
  const out = saveEdit(legacy, "n1", (d) => ({ ...d, dnsSearch: ["lab"] }));
  assert.deepEqual(nodeOf(out, "n1").dns, { servers: ["9.9.9.9"], search: ["lab"] });
});

test("env, labels and sysctls keep scalar values and their types", () => {
  const out = saveEdit(RICH_TOPOLOGY, "srl1", (data) => ({
    ...data,
    // The key/value list hands edited values back as text
    env: { ...data.env, COUNT: "4", NEW: "1" },
    labels: { ...data.labels, rack: "13" },
    sysctls: { ...data.sysctls, "net.ipv4.ip_forward": "0" }
  }));
  const node = nodeOf(out, "srl1");
  assert.deepEqual(node.env, { PLAIN: "text", COUNT: 4, ENABLED: true, NEW: "1" });
  assert.deepEqual(node.labels, { team: "core", rack: 13 });
  assert.deepEqual(node.sysctls, {
    "net.ipv4.ip_forward": 0,
    "net.ipv6.conf.all.disable_ipv6": "0"
  });
});

test("rows without a key are not written", () => {
  const out = saveEdit(RICH_TOPOLOGY, "srl2", (data) => ({
    ...data,
    env: { "": "", FOO: "bar" }
  }));
  assert.deepEqual(nodeOf(out, "srl2").env, { FOO: "bar" });
});

test("explicit false and 0 overrides survive, and are written when chosen", () => {
  // Unchecking a box that was checked (inherited from defaults) writes false
  const out = saveEdit(RICH_TOPOLOGY, "srl2", (data) => {
    assert.equal(data.autoRemove, true);
    assert.equal(data.startupDelay, 5);
    return { ...data, autoRemove: false, enforceStartupConfig: false, startupDelay: 0 };
  });
  const node = nodeOf(out, "srl2");
  assert.equal(node["auto-remove"], false);
  assert.equal(node["enforce-startup-config"], false);
  assert.equal(node["startup-delay"], 0);

  // Checking and unchecking a box that was unset writes nothing
  const noop = saveEdit(RICH_TOPOLOGY, "srl2", (data) => ({
    ...data,
    suppressStartupConfig: false
  }));
  assert.equal(noop, RICH_TOPOLOGY);

  // Clearing the field removes the key so the node inherits again
  const cleared = saveEdit(RICH_TOPOLOGY, "srl1", (data) => ({ ...data, startupDelay: undefined }));
  assert.equal(nodeOf(cleared, "srl1")["startup-delay"], undefined);

  // Unchecking a flag that nothing else sets removes it (containerlab defaults it to false)
  const plain = fixture(`topology:
  nodes:
    n1:
      kind: linux
      auto-remove: true
`);
  const unchecked = saveEdit(plain, "n1", (data) => ({ ...data, autoRemove: false }));
  assert.equal(nodeOf(unchecked, "n1")["auto-remove"], undefined);
});

test("components are kept for SR Linux and vr-sros nodes when other fields change", () => {
  const srl = saveEdit(RICH_TOPOLOGY, "srl1", (data) => ({ ...data, image: "srlinux:25.3" }));
  assert.deepEqual(nodeOf(srl, "srl1").components, nodeOf(RICH_TOPOLOGY, "srl1").components);
  assert.equal(nodeOf(srl, "srl1")["custom-prompt"], false);

  const sros = saveEdit(SROS_TOPOLOGY, "vsros", (data) => ({ ...data, image: "sros:25.7" }));
  assert.deepEqual(nodeOf(sros, "vsros").components, nodeOf(SROS_TOPOLOGY, "vsros").components);
  assert.equal(nodeOf(sros, "vsros").sfm, "sfm2-s");
});

test("SR-SIM sfm is a node-level key and component env survives component edits", () => {
  const sfm = saveEdit(SROS_TOPOLOGY, "sim", (data) => {
    assert.equal(data.sfm, "m-sfm6-7/12");
    return { ...data, sfm: "m-sfm6-12e" };
  });
  assert.equal(nodeOf(sfm, "sim").sfm, "m-sfm6-12e");
  assert.deepEqual(nodeOf(sfm, "sim").components, nodeOf(SROS_TOPOLOGY, "sim").components);

  const comps = saveEdit(SROS_TOPOLOGY, "sim", (data) => ({
    ...data,
    components: (data.components ?? []).map((c) =>
      c.slot === 1 ? { ...c, mda: [{ slot: 1, type: "me12-100gb-qsfp28" }] } : c
    )
  }));
  assert.deepEqual(nodeOf(comps, "sim").components, [
    { slot: "A", type: "cpm2-s" },
    {
      slot: 1,
      type: "xcm2-7s",
      env: { NOKIA_SROS_LICENSE: "/opt/license.txt" },
      mda: [{ slot: 1, type: "me12-100gb-qsfp28" }]
    }
  ]);
  assert.equal(nodeOf(comps, "sim").sfm, "m-sfm6-7/12");
});

test("an sfm written into components by older editor versions moves to the node", () => {
  const legacy = fixture(`topology:
  nodes:
    sim:
      kind: nokia_srsim
      type: sr-7s
      components:
        - slot: A
          sfm: m-sfm6-7/12
`);
  const data = openEditor(legacy, "sim");
  assert.equal(data.sfm, "m-sfm6-7/12");
  const out = saveEdit(legacy, "sim", (d) => ({
    ...d,
    components: [...(d.components ?? []), { slot: "B" }]
  }));
  assert.deepEqual(nodeOf(out, "sim").components, [{ slot: "A" }, { slot: "B" }]);
});

test("dropdown values are written as containerlab expects", () => {
  const out = saveEdit(RICH_TOPOLOGY, "srl2", (data) => ({
    ...data,
    imagePullPolicy: "Always",
    runtime: "docker",
    restartPolicy: "unless-stopped",
    networkMode: "container:srl1"
  }));
  const node = nodeOf(out, "srl2");
  assert.equal(node["image-pull-policy"], "Always");
  assert.equal(node.runtime, "docker");
  assert.equal(node["restart-policy"], "unless-stopped");
  assert.equal(node["network-mode"], "container:srl1");
});

test("image pull policies load case-insensitively", () => {
  assert.equal(normalizeImagePullPolicy("IfNotPresent"), "IfNotPresent");
  assert.equal(normalizeImagePullPolicy("ifnotpresent"), "IfNotPresent");
  assert.equal(normalizeImagePullPolicy("if-not-present"), "IfNotPresent");
  assert.equal(normalizeImagePullPolicy("always"), "Always");
  assert.equal(normalizeImagePullPolicy("NEVER"), "Never");
  assert.equal(normalizeImagePullPolicy("sometimes"), "sometimes");
});

test("validity duration accepts Go durations only", () => {
  for (const value of ["720h", "1h30m", "8760h", "90m", "1.5h", "0"]) {
    assert.ok(isGoDuration(value), value);
  }
  for (const value of ["30d", "1y", "720", "h", "", "1 h"]) {
    assert.ok(!isGoDuration(value), value);
  }
});

test("new nodes from templates still leave out false and 0 defaults", () => {
  const yaml = convertEditorDataToYaml({
    kind: "linux",
    autoRemove: false,
    startupDelay: 0,
    healthCheck: { test: ["CMD", "true"] }
  });
  assert.equal(yaml["auto-remove"], null);
  assert.equal(yaml["startup-delay"], null);
  assert.deepEqual(yaml.healthcheck, { test: ["CMD", "true"] });
});

const MULTI_MGMT_TOPOLOGY = fixture(`name: multi
mgmt:
  - network: oob
  - network: lab
topology:
  kinds:
    linux:
      mgmt-net: lab
  nodes:
    r1:
      kind: linux
    r2:
      kind: linux
      mgmt-net: oob # pinned
  links: []
`);

test("mgmt-net loads the inherited value and its level", () => {
  const r1 = openEditor(MULTI_MGMT_TOPOLOGY, "r1");
  assert.equal(r1.mgmtNet, "lab");
  assert.equal(r1.inheritedFrom?.["mgmt-net"], "kind");
  assert.equal(openEditor(MULTI_MGMT_TOPOLOGY, "r2").mgmtNet, "oob");
});

test("mgmt-net is written on the node only when it differs from the inherited value", () => {
  const picked = saveEdit(MULTI_MGMT_TOPOLOGY, "r1", (data) => ({ ...data, mgmtNet: "oob" }));
  assert.equal(nodeOf(picked, "r1")["mgmt-net"], "oob");

  const back = saveEdit(MULTI_MGMT_TOPOLOGY, "r2", (data) => ({ ...data, mgmtNet: "lab" }));
  assert.equal(nodeOf(back, "r2")["mgmt-net"], undefined);

  assert.equal(saveEdit(MULTI_MGMT_TOPOLOGY, "r2"), MULTI_MGMT_TOPOLOGY);
});

const CREDENTIALS_TOPOLOGY = fixture(`name: creds

topology:
  kinds:
    nokia_srlinux:
      credentials:
        username: srl-admin
        password: srl-password
  nodes:
    srl1:
      kind: nokia_srlinux
    srl2:
      kind: nokia_srlinux
      credentials:
        username: ops # own login
        password: "1234"
  links: []
`);

test("credentials load as own or inherited", () => {
  const inherited = openEditor(CREDENTIALS_TOPOLOGY, "srl1");
  assert.equal(inherited.credentials, undefined);
  assert.deepEqual(inherited.inheritedCredentials, {
    username: "srl-admin",
    password: "srl-password",
    source: "kind"
  });

  const own = openEditor(CREDENTIALS_TOPOLOGY, "srl2");
  assert.deepEqual(own.credentials, { username: "ops", password: "1234" });
  assert.equal(own.inheritedCredentials?.source, "kind");
});

test("unchanged credentials leave the YAML as written", () => {
  assert.equal(saveEdit(CREDENTIALS_TOPOLOGY, "srl1"), CREDENTIALS_TOPOLOGY);
  assert.equal(saveEdit(CREDENTIALS_TOPOLOGY, "srl2"), CREDENTIALS_TOPOLOGY);
});

test("typing credentials writes them to the node only", () => {
  const yaml = saveEdit(CREDENTIALS_TOPOLOGY, "srl1", (data) => ({
    ...data,
    credentials: { username: " lab ", password: " secret ", identityFile: "keys/srl1" }
  }));
  assert.deepEqual(nodeOf(yaml, "srl1").credentials, {
    username: "lab",
    password: " secret ",
    "identity-file": "keys/srl1"
  });
  const parsed = YAML.parse(yaml) as ClabTopology;
  assert.deepEqual(parsed.topology?.kinds?.nokia_srlinux.credentials, {
    username: "srl-admin",
    password: "srl-password"
  });
});

test("clearing every credential field removes the node's credentials", () => {
  const yaml = saveEdit(CREDENTIALS_TOPOLOGY, "srl2", (data) => ({
    ...data,
    credentials: { username: "", password: "" }
  }));
  assert.equal(nodeOf(yaml, "srl2").credentials, undefined);
});

test("convertEditorDataToYaml writes the credentials map", () => {
  assert.deepEqual(
    convertEditorDataToYaml({ credentials: { username: "admin", identityFile: " ~/.ssh/k " } })
      .credentials,
    { username: "admin", "identity-file": "~/.ssh/k" }
  );
  assert.equal(convertEditorDataToYaml({ credentials: {} }).credentials, null);
});
