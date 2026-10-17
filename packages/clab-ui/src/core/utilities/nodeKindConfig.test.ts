import assert from "node:assert/strict";
import test from "node:test";

import * as YAML from "yaml";

import { addNodeToDoc, editNodeInDoc } from "../io/NodePersistenceIO";
import { TopologyParser } from "../parsing/TopologyParser";
import type { ClabTopology } from "../types/topology";
import type { NodeEditorData } from "../types/editors";

import {
  convertEditorDataToNodeSaveData,
  convertEditorDataToYaml,
  convertToEditorData
} from "./nodeEditorConversions";
import { computeNodeInheritance, rebaseInheritedValues } from "./nodeInheritance";
import {
  cleanKindConfigValue,
  kindConfigFormFields,
  parseKindConfig,
  pruneKindConfig
} from "./nodeKindConfig";

function openEditor(yaml: string, nodeId: string): NodeEditorData {
  const { topology } = TopologyParser.parseToReactFlow(yaml);
  const node = topology.nodes.find((entry) => entry.id === nodeId);
  assert.ok(node, `node ${nodeId} not found`);
  const editorData = convertToEditorData({ id: node.id, ...node.data });
  assert.ok(editorData);
  return editorData;
}

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

const KIND_TOPOLOGY = `name: kinds

topology:
  kinds:
    nokia_srlinux:
      custom-prompt: false
  nodes:
    srl1:
      kind: nokia_srlinux
      eda-default-grpc-server: true
    cvx:
      kind: nvidia_cumulusvx
      port-count: 32
      breakouts:
        - port: 1..4
          channels: 4
        - port: 10
          channels: 2
    frr1:
      kind: frr
      daemons: [ bgpd, ospfd ] # routing only
    iol:
      kind: cisco_iol
      pid-offset: 10
      mgmt-intf: Ethernet0/0
    ceos:
      kind: arista_ceos
      copy-to-flash:
        - startup.cfg
  links: []
`;

test("the fixture survives a plain parse and stringify", () => {
  assert.equal(YAML.parseDocument(KIND_TOPOLOGY).toString(), KIND_TOPOLOGY);
});

test("kind-specific keys load into kindConfig with their YAML values", () => {
  assert.deepEqual(openEditor(KIND_TOPOLOGY, "cvx").kindConfig, {
    "port-count": 32,
    breakouts: [
      { port: "1..4", channels: 4 },
      { port: 10, channels: 2 }
    ]
  });
  assert.deepEqual(openEditor(KIND_TOPOLOGY, "frr1").kindConfig, { daemons: ["bgpd", "ospfd"] });
  // The kind's custom-prompt is inherited into the effective values
  assert.deepEqual(openEditor(KIND_TOPOLOGY, "srl1").kindConfig, {
    "custom-prompt": false,
    "eda-default-grpc-server": true
  });
});

test("saving without changes leaves kind-specific keys and comments as written", () => {
  for (const node of ["srl1", "cvx", "frr1", "iol", "ceos"]) {
    assert.equal(saveEdit(KIND_TOPOLOGY, node), KIND_TOPOLOGY);
  }
});

test("edited kind-specific keys are written, cleared ones removed", () => {
  const yaml = saveEdit(KIND_TOPOLOGY, "cvx", (data) => ({
    ...data,
    kindConfig: {
      ...data.kindConfig,
      "port-count": 48,
      breakouts: [{ port: 5, channels: 8 }, {}]
    }
  }));
  assert.deepEqual(nodeOf(yaml, "cvx"), {
    kind: "nvidia_cumulusvx",
    "port-count": 48,
    breakouts: [{ port: 5, channels: 8 }]
  });

  const cleared = saveEdit(KIND_TOPOLOGY, "iol", (data) => ({
    ...data,
    kindConfig: { "pid-offset": 10 }
  }));
  assert.deepEqual(nodeOf(cleared, "iol"), { kind: "cisco_iol", "pid-offset": 10 });
});

test("false is written for kind-specific flags that default to true", () => {
  const yaml = saveEdit(KIND_TOPOLOGY, "srl1", (data) => ({
    ...data,
    kindConfig: { ...data.kindConfig, "eda-default-grpc-server": false }
  }));
  assert.equal(nodeOf(yaml, "srl1")["eda-default-grpc-server"], false);

  const plain = `name: kinds
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
`;
  const off = saveEdit(plain, "srl1", (data) => ({
    ...data,
    kindConfig: { "custom-prompt": false }
  }));
  assert.equal(nodeOf(off, "srl1")["custom-prompt"], false);
});

test("a node only writes kind-specific values it does not inherit", () => {
  // Matching the kind's value drops the node's own copy
  const same = saveEdit(KIND_TOPOLOGY, "srl1", (data) => ({
    ...data,
    kindConfig: { "custom-prompt": false }
  }));
  assert.deepEqual(nodeOf(same, "srl1"), { kind: "nokia_srlinux" });

  // A different value overrides it
  const override = saveEdit(KIND_TOPOLOGY, "srl1", (data) => ({
    ...data,
    kindConfig: { ...data.kindConfig, "custom-prompt": true }
  }));
  assert.equal(nodeOf(override, "srl1")["custom-prompt"], true);
});

test("new nodes and pasted fallbacks keep kind-specific keys", () => {
  const doc = YAML.parseDocument("name: kinds\ntopology:\n  nodes: {}\n");
  const data: NodeEditorData = {
    id: "frr2",
    name: "frr2",
    kind: "frr",
    kindConfig: { daemons: ["bgpd"] }
  };
  const result = addNodeToDoc(doc, convertEditorDataToNodeSaveData(data));
  assert.equal(result.success, true);
  assert.deepEqual(nodeOf(doc.toString(), "frr2"), { kind: "frr", daemons: ["bgpd"] });
});

test("values are cleaned before they are written", () => {
  assert.equal(cleanKindConfigValue("  "), null);
  assert.equal(cleanKindConfigValue(" Ethernet0/1 "), "Ethernet0/1");
  assert.equal(cleanKindConfigValue(false), false);
  assert.equal(cleanKindConfigValue(0), 0);
  assert.deepEqual(cleanKindConfigValue(["a", " ", "b"]), ["a", "b"]);
  assert.equal(cleanKindConfigValue([""]), null);
  assert.deepEqual(cleanKindConfigValue([{ port: 1, channels: "" }, {}]), [{ port: 1 }]);
  const yaml = convertEditorDataToYaml({ kindConfig: { wait: "2m" } });
  assert.equal(yaml.wait, "2m");
  assert.equal(yaml.kubeconfig, null);
  assert.equal("components" in yaml, false);
});

test("parseKindConfig ignores keys that are not kind-specific", () => {
  assert.equal(parseKindConfig({ image: "x", env: {} }), undefined);
  assert.deepEqual(parseKindConfig({ wait: "0s", components: [], sfm: "x" }), { wait: "0s" });
});

test("a kind change drops keys the new kind does not accept", () => {
  assert.deepEqual(pruneKindConfig({ daemons: ["bgpd"], wait: "1m" }, "frrouting"), {
    daemons: ["bgpd"]
  });
  assert.equal(pruneKindConfig({ daemons: ["bgpd"] }, "linux"), undefined);
  const keep = { daemons: ["bgpd"] };
  assert.equal(pruneKindConfig(keep, undefined), keep);
});

test("the Kind tab leaves SR OS components and SFM to the Components tab", () => {
  assert.deepEqual(
    kindConfigFormFields("nokia_srsim").map((field) => field.key),
    ["config-mode", "gen-component-config"]
  );
  assert.deepEqual(
    kindConfigFormFields("nokia_srlinux").map((field) => field.key),
    ["components", "custom-prompt", "eda-default-grpc-server"]
  );
  assert.deepEqual(kindConfigFormFields("linux"), []);
  // Without a kind, everything some kind accepts that a form can edit
  assert.ok(kindConfigFormFields(undefined).some((field) => field.key === "sfm"));
  assert.ok(!kindConfigFormFields(undefined).some((field) => field.key === "components"));
});

test("inheritance reports where a kind-specific value comes from and rebases it", () => {
  const parsed = YAML.parse(`name: inh
topology:
  defaults:
    wait: 1m
  kinds:
    nokia_srlinux:
      custom-prompt: false
    frr:
      daemons: [bgpd]
  groups:
    edge:
      custom-prompt: true
  nodes: {}
`) as ClabTopology;
  const srl = computeNodeInheritance(parsed, "nokia_srlinux", undefined);
  assert.deepEqual(srl.kindConfigSource("custom-prompt"), { level: "kind", name: "nokia_srlinux" });
  assert.deepEqual(srl.kindConfigSource("wait"), { level: "defaults" });
  const edge = computeNodeInheritance(parsed, "nokia_srlinux", "edge");
  assert.deepEqual(edge.kindConfigSource("custom-prompt"), { level: "group", name: "edge" });
  assert.equal(edge.values.kindConfig?.["custom-prompt"], true);

  // Switching to frr swaps the inherited keys and keeps the node's own
  const frr = computeNodeInheritance(parsed, "frr", undefined);
  const data: NodeEditorData = {
    id: "n",
    name: "n",
    kind: "frr",
    kindConfig: { "custom-prompt": false, wait: "1m", "eda-default-grpc-server": true }
  };
  const updates = rebaseInheritedValues(data, srl.values, frr.values);
  assert.deepEqual(updates.kindConfig, {
    wait: "1m",
    daemons: ["bgpd"],
    "eda-default-grpc-server": true
  });
});
