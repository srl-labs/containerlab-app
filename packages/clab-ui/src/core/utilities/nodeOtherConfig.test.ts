import assert from "node:assert/strict";
import test from "node:test";

import * as YAML from "yaml";

import { addNodeToDoc, editNodeInDoc } from "../io/NodePersistenceIO";
import { extractNodeYamlSources } from "../io/NodeYamlClone";
import { applyInheritanceSectionUpdate } from "../host/inheritanceSectionYaml";
import { TopologyParser } from "../parsing/TopologyParser";
import type { ClabTopology } from "../types/topology";
import type { NodeEditorData } from "../types/editors";

import {
  convertEditorChangesToYaml,
  convertEditorDataToNodeSaveData,
  convertEditorDataToYaml,
  convertToEditorData
} from "./nodeEditorConversions";
import {
  convertEditorDataToSaveData,
  convertTemplateToEditorData
} from "./customNodeConversions";
import { computeNodeInheritance, rebaseInheritedValues } from "./nodeInheritance";
import {
  OTHER_CONFIG_KEYS,
  formatYamlValue,
  parseYamlValue,
  serializeOtherConfig,
  writeConfigPath
} from "./nodeOtherConfig";

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

const TOPOLOGY = `name: other

topology:
  defaults:
    tmpfs:
      /run: rw,nosuid
    config:
      vars:
        site: dc1
        bgp:
          asn: 65000
  kinds:
    linux:
      privileged: false
      security-opts:
        - seccomp=unconfined
      volumes:
        - logs:/var/log
  groups:
    edge:
      hostname: edge-host
      link-apply-mode: restart
  nodes:
    host1:
      kind: linux
      hostname: web-01 # shown in the shell prompt
      cgroup-parent: /lab/leaves
      cgroupns-mode: host
      pid-mode: host
      tmpfs:
        /tmp: rw,size=64m
      volumes:
        - data:/srv/data:ro
        - /var/cache/app
      config:
        vars:
          ifaces: [ 2, 4 ]
          bgp:
            router-id: 10.0.0.1
    host2:
      kind: linux
      group: edge
    srl1:
      kind: nokia_srlinux
      privileged: false
  links: []
`;

test("the fixture survives a plain parse and stringify", () => {
  assert.equal(YAML.parseDocument(TOPOLOGY).toString(), TOPOLOGY);
});

test("the Other tab covers the node keys that had no form", () => {
  assert.deepEqual([...OTHER_CONFIG_KEYS].sort(), [
    "cgroup-parent",
    "cgroupns-mode",
    "config",
    "hostname",
    "link-apply-mode",
    "pid-mode",
    "privileged",
    "security-opts",
    "tmpfs",
    "volumes"
  ]);
});

test("Other tab keys load with their effective values", () => {
  assert.deepEqual(openEditor(TOPOLOGY, "host1").otherConfig, {
    hostname: "web-01",
    "cgroup-parent": "/lab/leaves",
    "cgroupns-mode": "host",
    "pid-mode": "host",
    privileged: false,
    "security-opts": ["seccomp=unconfined"],
    tmpfs: { "/run": "rw,nosuid", "/tmp": "rw,size=64m" },
    volumes: ["logs:/var/log", "data:/srv/data:ro", "/var/cache/app"],
    config: { vars: { site: "dc1", bgp: { asn: 65000, "router-id": "10.0.0.1" }, ifaces: [2, 4] } }
  });
  const host2 = openEditor(TOPOLOGY, "host2").otherConfig ?? {};
  assert.equal(host2.hostname, "edge-host");
  assert.equal(host2["link-apply-mode"], "restart");
});

test("saving without changes leaves the YAML as written", () => {
  for (const node of ["host1", "host2", "srl1"]) {
    assert.equal(saveEdit(TOPOLOGY, node), TOPOLOGY);
  }
});

test("edited values are written and cleared ones removed", () => {
  const yaml = saveEdit(TOPOLOGY, "host1", (data) => {
    let config = writeConfigPath(data.otherConfig, ["hostname"], "web-02");
    config = writeConfigPath(config, ["link-apply-mode"], "live");
    config = writeConfigPath(config, ["cgroup-parent"], undefined);
    config = writeConfigPath(config, ["pid-mode"], "  ");
    return { ...data, otherConfig: config };
  });
  const node = nodeOf(yaml, "host1");
  assert.equal(node.hostname, "web-02");
  assert.equal(node["link-apply-mode"], "live");
  assert.equal("cgroup-parent" in node, false);
  assert.equal("pid-mode" in node, false);
  assert.equal(node["cgroupns-mode"], "host");
});

test("privileged false is written, since most kinds run privileged", () => {
  const unset = TOPOLOGY.replace("      privileged: false\n  links", "  links");
  assert.equal("privileged" in nodeOf(unset, "srl1"), false);
  const yaml = saveEdit(unset, "srl1", (data) => ({
    ...data,
    otherConfig: writeConfigPath(data.otherConfig, ["privileged"], false)
  }));
  assert.equal(nodeOf(yaml, "srl1").privileged, false);

  // Inherited from the kind, the node does not repeat it
  const same = saveEdit(TOPOLOGY, "host2", (data) => ({
    ...data,
    otherConfig: writeConfigPath(data.otherConfig, ["hostname"], "edge-2")
  }));
  assert.deepEqual(nodeOf(same, "host2"), { kind: "linux", group: "edge", hostname: "edge-2" });
});

test("merged maps and lists write only the entries the node adds", () => {
  const yaml = saveEdit(TOPOLOGY, "host2", (data) => {
    const effective = data.otherConfig ?? {};
    let config = writeConfigPath(effective, ["tmpfs"], {
      ...(effective.tmpfs as Record<string, unknown>),
      "/scratch": " rw "
    });
    config = writeConfigPath(config, ["volumes"], [
      ...(effective.volumes as string[]),
      "cache:/cache",
      " "
    ]);
    config = writeConfigPath(config, ["security-opts"], [
      ...(effective["security-opts"] as string[]),
      "no-new-privileges"
    ]);
    return { ...data, otherConfig: config };
  });
  assert.deepEqual(nodeOf(yaml, "host2"), {
    kind: "linux",
    group: "edge",
    tmpfs: { "/scratch": "rw" },
    volumes: ["cache:/cache"],
    "security-opts": ["no-new-privileges"]
  });
});

test("config.vars merge deeply, so only the node's own variables are written", () => {
  const yaml = saveEdit(TOPOLOGY, "host2", (data) => ({
    ...data,
    otherConfig: writeConfigPath(data.otherConfig, ["config", "vars"], {
      site: "dc1",
      bgp: { asn: 65001 },
      ifaces: [1]
    })
  }));
  assert.deepEqual(nodeOf(yaml, "host2").config, { vars: { bgp: { asn: 65001 }, ifaces: [1] } });

  const cleared = saveEdit(TOPOLOGY, "host1", (data) => ({
    ...data,
    otherConfig: writeConfigPath(data.otherConfig, ["config", "vars"], {
      site: "dc1",
      bgp: { asn: 65000 }
    })
  }));
  assert.equal("config" in nodeOf(cleared, "host1"), false);
});

test("serializing trims text and drops blank rows and keys", () => {
  assert.deepEqual(
    serializeOtherConfig({
      hostname: " web ",
      volumes: ["", " a:/a "],
      tmpfs: { "": "x", " /run ": " rw " },
      config: { vars: { "": 1 } }
    }),
    {
      volumes: ["a:/a"],
      hostname: "web",
      "link-apply-mode": null,
      config: null,
      privileged: null,
      "cgroupns-mode": null,
      "cgroup-parent": null,
      "pid-mode": null,
      tmpfs: { "/run": "rw" },
      "security-opts": null
    }
  );
});

test("config keys no field covers are kept", () => {
  assert.deepEqual(serializeOtherConfig({ config: { vars: { a: 1 }, other: true } }).config, {
    vars: { a: 1 },
    other: true
  });
});

test("YAML values are shown on one line and read back with their type", () => {
  const values: unknown[] = [65001, "65001", "hello world", [2, 4], { asn: 1 }, true, "a\nb"];
  for (const value of values) {
    const text = formatYamlValue(value);
    assert.equal(text.includes("\n"), false, text);
    assert.deepEqual(parseYamlValue(text), value);
  }
  assert.equal(formatYamlValue([2, 4]), "[2, 4]");
  assert.equal(parseYamlValue("[2,"), "[2,");
  assert.equal(parseYamlValue(""), "");
});

test("inheritance gives the level of each value, entry and item", () => {
  const parsed = YAML.parse(TOPOLOGY) as ClabTopology;
  const inheritance = computeNodeInheritance(parsed, "linux", "edge");
  assert.deepEqual(inheritance.pathSource(["hostname"]), { level: "group", name: "edge" });
  assert.deepEqual(inheritance.pathSource(["privileged"]), { level: "kind", name: "linux" });
  assert.deepEqual(inheritance.pathEntries(["tmpfs"]), { "/run": { level: "defaults" } });
  assert.deepEqual(inheritance.pathEntries(["config", "vars"]), {
    site: { level: "defaults" },
    bgp: { level: "defaults" }
  });
  assert.deepEqual(
    [...inheritance.keyItems("volumes")],
    [["logs:/var/log", { level: "kind", name: "linux" }]]
  );
});

test("changing the kind swaps inherited Other tab values and keeps the node's own", () => {
  const parsed = YAML.parse(TOPOLOGY) as ClabTopology;
  const before = computeNodeInheritance(parsed, "linux", "edge").values;
  const after = computeNodeInheritance(parsed, "nokia_srlinux", "edge").values;
  const data = openEditor(TOPOLOGY, "host2");
  const updates = rebaseInheritedValues(
    {
      ...data,
      kind: "nokia_srlinux",
      otherConfig: {
        ...data.otherConfig,
        volumes: ["logs:/var/log", "own:/own"],
        tmpfs: { "/run": "rw,nosuid", "/own": "rw" }
      }
    },
    before,
    after
  );
  assert.deepEqual(updates.otherConfig, {
    hostname: "edge-host",
    "link-apply-mode": "restart",
    tmpfs: { "/run": "rw,nosuid", "/own": "rw" },
    config: { vars: { site: "dc1", bgp: { asn: 65000 } } },
    volumes: ["own:/own"]
  });
});

test("custom node templates keep the Other tab keys", () => {
  const otherConfig = { hostname: "tpl", tmpfs: { "/run": "rw" }, config: { vars: { a: 1 } } };
  const saved = convertEditorDataToSaveData({ id: "t", name: "", kind: "linux", otherConfig });
  assert.deepEqual(saved.otherConfig, otherConfig);
  assert.deepEqual(
    convertTemplateToEditorData({ ...saved, kind: "linux" }).otherConfig,
    otherConfig
  );

  // A node created from the template gets the keys in its YAML
  const yamlData = Object.fromEntries(
    Object.entries(convertEditorDataToYaml({ otherConfig })).filter(([, value]) => value !== null)
  );
  const doc = YAML.parseDocument("name: t\ntopology:\n  nodes: {}\n  links: []\n");
  assert.deepEqual(
    addNodeToDoc(doc, { id: "n1", name: "n1", extraData: { kind: "linux", ...yamlData } }),
    { success: true }
  );
  assert.deepEqual(nodeOf(doc.toString(), "n1"), { kind: "linux", ...otherConfig });
});

test("copy and paste keep the Other tab keys as written", () => {
  const source = extractNodeYamlSources(TOPOLOGY, ["host1"]).get("host1");
  assert.ok(source);
  const doc = YAML.parseDocument(TOPOLOGY);
  assert.deepEqual(
    addNodeToDoc(doc, { id: "host9", name: "host9", extraData: {}, yamlSource: source }),
    { success: true }
  );
  const { hostname: _hostname, ...pasted } = nodeOf(doc.toString(), "host9");
  const { hostname: _original, ...original } = nodeOf(TOPOLOGY, "host1");
  assert.deepEqual(pasted, original);
});

test("defaults, kinds and groups are edited with the same keys", () => {
  const baseline = convertToEditorData({
    id: "linux",
    name: "linux",
    extraData: { privileged: false, volumes: ["logs:/var/log"] }
  });
  assert.ok(baseline);
  const changes = convertEditorChangesToYaml(
    {
      ...baseline,
      otherConfig: { ...baseline.otherConfig, privileged: true, "pid-mode": "host" }
    },
    baseline
  );
  assert.deepEqual(changes, { privileged: true, "pid-mode": "host" });
  const doc = YAML.parseDocument(TOPOLOGY);
  applyInheritanceSectionUpdate(doc, { level: "kind", name: "linux", changes });
  assert.deepEqual((doc.toJS() as ClabTopology).topology?.kinds?.linux, {
    privileged: true,
    "security-opts": ["seccomp=unconfined"],
    volumes: ["logs:/var/log"],
    "pid-mode": "host"
  });
});
