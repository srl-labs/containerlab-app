import assert from "node:assert/strict";
import test from "node:test";

import * as YAML from "yaml";

import { TopologyParser } from "../parsing/TopologyParser";
import type { LinkEditorData, NetworkEditorData } from "../types/editors";
import type { TopoEdge } from "../types/graph";
import {
  buildNetworkLinkEditExtraData,
  convertToNetworkEditorData
} from "../utilities/networkEditorConversions";
import {
  convertEditorDataToLinkSaveData,
  convertToLinkEditorData
} from "../../utils/linkEditorConversions";
import { toLinkSaveData } from "../../services/linkSaveData";

import { deleteLinkFromDoc, editLinkInDoc } from "./LinkPersistenceIO";

const NODES = `name: lab
topology:
  nodes:
    srl1:
      kind: linux
    srl2:
      kind: linux
  links:
`;

function parseGraph(yaml: string) {
  return TopologyParser.parseToReactFlow(yaml).topology;
}

function findEdge(yaml: string, source: string, sourceEndpoint: string): TopoEdge {
  const edge = parseGraph(yaml).edges.find(
    (e) => e.source === source && e.data?.sourceEndpoint === sourceEndpoint
  );
  assert.ok(edge, `edge ${source}:${sourceEndpoint} not found`);
  return edge;
}

/** Opens the link editor on a link, applies `changes`, and saves like the panel does. */
function saveLinkEditor(
  yaml: string,
  source: string,
  sourceEndpoint: string,
  changes: Partial<LinkEditorData> = {}
): string {
  const edge = findEdge(yaml, source, sourceEndpoint);
  const loaded = convertToLinkEditorData({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...edge.data
  });
  assert.ok(loaded);
  const doc = YAML.parseDocument(yaml);
  const result = editLinkInDoc(doc, convertEditorDataToLinkSaveData({ ...loaded, ...changes }));
  assert.deepEqual(result, { success: true });
  return doc.toString();
}

function loadNetworkEditor(yaml: string, nodeId: string): NetworkEditorData {
  const node = parseGraph(yaml).nodes.find((n) => n.id === nodeId);
  assert.ok(node, `network node ${nodeId} not found`);
  const data = convertToNetworkEditorData({ id: node.id, ...node.data });
  assert.ok(data);
  return data;
}

/** Opens the network editor on a network node, applies `changes`, and saves its links. */
function saveNetworkEditor(
  yaml: string,
  nodeId: string,
  changes: Partial<NetworkEditorData> = {}
): string {
  const before = loadNetworkEditor(yaml, nodeId);
  const data = { ...before, ...changes };
  const newNodeId = ["host", "mgmt-net", "macvlan"].includes(data.networkType)
    ? `${data.networkType}:${data.interfaceName}`
    : nodeId;
  const extraData = buildNetworkLinkEditExtraData(data, before);
  const doc = YAML.parseDocument(yaml);
  const edges = parseGraph(yaml).edges.filter((e) => e.source === nodeId || e.target === nodeId);
  assert.ok(edges.length > 0);
  for (const edge of edges) {
    const sourceEndpoint = edge.data?.sourceEndpoint;
    const targetEndpoint = edge.data?.targetEndpoint;
    const result = editLinkInDoc(doc, {
      id: edge.id,
      source: edge.source === nodeId ? newNodeId : edge.source,
      target: edge.target === nodeId ? newNodeId : edge.target,
      sourceEndpoint,
      targetEndpoint,
      extraData,
      originalSource: edge.source,
      originalTarget: edge.target,
      originalSourceEndpoint: sourceEndpoint,
      originalTargetEndpoint: targetEndpoint
    });
    assert.deepEqual(result, { success: true });
  }
  return doc.toString();
}

function replaceOnce(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `expected to find ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

// ----------------------------------------------------------------------------
// veth links
// ----------------------------------------------------------------------------

const VETH_BRIEF = `${NODES}    # spine uplink
    - endpoints: [ "srl1:e1-1", "srl2:e1-1" ] # keep me
      mtu: 9000
      ipv4: [ "10.0.0.0/31", "10.0.0.1/31" ]
      vars:
        cost: 10
        enabled: true
        role: uplink
        bgp:
          asn: 65001
          peers: [ a, b ]
      labels:
        tier: spine
    - endpoints: [ 'srl1:e1-2', 'srl2:e1-2' ]
`;

test("brief veth link is unchanged when saved without edits", () => {
  assert.equal(saveLinkEditor(VETH_BRIEF, "srl1", "e1-1"), VETH_BRIEF);
  assert.equal(saveLinkEditor(VETH_BRIEF, "srl1", "e1-2"), VETH_BRIEF);
});

test("brief veth link edits only touch the edited field", () => {
  assert.equal(
    saveLinkEditor(VETH_BRIEF, "srl1", "e1-1", { targetEndpoint: "e1-9" }),
    replaceOnce(VETH_BRIEF, `"srl2:e1-1"`, `"srl2:e1-9"`)
  );
  assert.equal(
    saveLinkEditor(VETH_BRIEF, "srl1", "e1-2", { sourceEndpoint: "e1-7" }),
    replaceOnce(VETH_BRIEF, `'srl1:e1-2'`, `'srl1:e1-7'`)
  );
  assert.equal(
    saveLinkEditor(VETH_BRIEF, "srl1", "e1-1", { mtu: 1500 }),
    replaceOnce(VETH_BRIEF, "mtu: 9000", "mtu: 1500")
  );
  assert.equal(
    saveLinkEditor(VETH_BRIEF, "srl1", "e1-1", { targetIpv4: "10.0.0.3/31" }),
    replaceOnce(VETH_BRIEF, `"10.0.0.1/31"`, `"10.0.0.3/31"`)
  );
});

test("brief veth link keeps the brief form for addresses", () => {
  const out = saveLinkEditor(VETH_BRIEF, "srl1", "e1-2", {
    sourceIpv4: "10.0.1.0/31",
    targetIpv4: "10.0.1.1/31"
  });
  assert.equal(
    out,
    replaceOnce(
      VETH_BRIEF,
      `    - endpoints: [ 'srl1:e1-2', 'srl2:e1-2' ]\n`,
      `    - endpoints: [ 'srl1:e1-2', 'srl2:e1-2' ]\n      ipv4: [ "10.0.1.0/31", "10.0.1.1/31" ]\n`
    )
  );
  // Clearing the only address of the list removes it again
  assert.equal(
    saveLinkEditor(out, "srl1", "e1-2", { sourceIpv4: "", targetIpv4: "" }),
    VETH_BRIEF
  );
});

test("link vars keep their YAML types and entries the editor cannot show", () => {
  const loaded = convertToLinkEditorData({
    ...findEdge(VETH_BRIEF, "srl1", "e1-1"),
    ...findEdge(VETH_BRIEF, "srl1", "e1-1").data
  });
  assert.deepEqual(loaded?.vars, { cost: "10", enabled: "true", role: "uplink" });

  const edited = saveLinkEditor(VETH_BRIEF, "srl1", "e1-1", {
    vars: { cost: "20", enabled: "true", role: "core", "": "" }
  });
  assert.equal(
    edited,
    replaceOnce(replaceOnce(VETH_BRIEF, "cost: 10", "cost: 20"), "role: uplink", "role: core")
  );

  const removed = saveLinkEditor(VETH_BRIEF, "srl1", "e1-1", { vars: { cost: "10" } });
  assert.equal(
    removed,
    replaceOnce(VETH_BRIEF, "        enabled: true\n        role: uplink\n", "")
  );

  // Removing every editable var keeps the nested ones
  const cleared = saveLinkEditor(VETH_BRIEF, "srl1", "e1-1", { vars: {}, labels: {} });
  assert.equal(
    cleared,
    replaceOnce(
      VETH_BRIEF,
      `      vars:
        cost: 10
        enabled: true
        role: uplink
        bgp:
          asn: 65001
          peers: [ a, b ]
      labels:
        tier: spine
`,
      `      vars:
        bgp:
          asn: 65001
          peers: [ a, b ]
`
    )
  );
});

test("brief veth link converts to the extended form only when a MAC is set", () => {
  const out = saveLinkEditor(VETH_BRIEF, "srl1", "e1-1", { sourceMac: "02:00:00:00:00:01" });
  assert.equal(
    out,
    `${NODES}    # spine uplink
    - type: veth
      endpoints:
        - node: "srl1"
          interface: "e1-1"
          ipv4: 10.0.0.0/31
          mac: 02:00:00:00:00:01
        - node: "srl2"
          interface: "e1-1"
          ipv4: 10.0.0.1/31
        # keep me
      mtu: 9000
      vars:
        cost: 10
        enabled: true
        role: uplink
        bgp:
          asn: 65001
          peers: [ a, b ]
      labels:
        tier: spine
    - endpoints: [ 'srl1:e1-2', 'srl2:e1-2' ]
`
  );
  // The converted link round-trips unchanged
  assert.equal(saveLinkEditor(out, "srl1", "e1-1"), out);
});

const VETH_EXTENDED = `${NODES}    - type: veth
      # endpoint comment
      endpoints:
        - node: srl1
          interface: e1-1
          mac: 02:00:00:00:00:01 # fixed mac
          ipv4: 10.0.0.0/31
          vars:
            port-role: uplink
            speed: 100
        - node: srl2
          interface: e1-1
          ipv4: 10.0.0.1/31
          ipv6: 2001:db8::1/127
          vars:
            nested:
              key: value
      mtu: 9000
      vars:
        weight: 3
        flags: [ x, y ]
`;

test("extended veth link is unchanged when saved without edits", () => {
  assert.equal(saveLinkEditor(VETH_EXTENDED, "srl1", "e1-1"), VETH_EXTENDED);
});

test("extended veth link edits keep endpoint vars and other fields", () => {
  assert.equal(
    saveLinkEditor(VETH_EXTENDED, "srl1", "e1-1", { sourceMac: "02:00:00:00:00:aa" }),
    replaceOnce(VETH_EXTENDED, "02:00:00:00:00:01", "02:00:00:00:00:aa")
  );
  assert.equal(
    saveLinkEditor(VETH_EXTENDED, "srl1", "e1-1", { targetIpv6: "" }),
    replaceOnce(VETH_EXTENDED, "          ipv6: 2001:db8::1/127\n", "")
  );
  assert.equal(
    saveLinkEditor(VETH_EXTENDED, "srl1", "e1-1", { mtu: undefined }),
    replaceOnce(VETH_EXTENDED, "      mtu: 9000\n", "")
  );
  assert.equal(
    saveLinkEditor(VETH_EXTENDED, "srl1", "e1-1", { sourceEndpoint: "e1-5" }),
    replaceOnce(VETH_EXTENDED, "interface: e1-1\n          mac", "interface: e1-5\n          mac")
  );
  assert.equal(
    saveLinkEditor(VETH_EXTENDED, "srl1", "e1-1", { vars: { weight: "4" } }),
    replaceOnce(VETH_EXTENDED, "weight: 3", "weight: 4")
  );
});

test("renaming a node keeps the endpoint entries", () => {
  assert.equal(
    saveLinkEditor(VETH_EXTENDED, "srl1", "e1-1", { target: "srl3" }),
    replaceOnce(VETH_EXTENDED, "node: srl2", "node: srl3")
  );
});

// ----------------------------------------------------------------------------
// veth-stitch links
// ----------------------------------------------------------------------------

const VETH_STITCH = `${NODES}    - type: veth-stitch # capture on the host
      endpoints:
        - node: srl1
          interface: e1-1
          mac: 02:00:00:00:00:01
        - node: srl2
          interface: e1-1
      mtu: 1500
      labels:
        role: core
`;

test("veth-stitch links load into the link editor with their fields", () => {
  const edge = findEdge(VETH_STITCH, "srl1", "e1-1");
  const data = convertToLinkEditorData({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...edge.data
  });
  assert.ok(data);
  assert.equal(data.type, "veth-stitch");
  assert.equal(data.sourceMac, "02:00:00:00:00:01");
  assert.equal(data.mtu, 1500);
  assert.deepEqual(data.labels, { role: "core" });
  assert.deepEqual(edge.data?.extraData?.extValidationErrors, undefined);
});

test("veth-stitch link is unchanged when saved without edits", () => {
  assert.equal(saveLinkEditor(VETH_STITCH, "srl1", "e1-1"), VETH_STITCH);
});

test("veth-stitch link edits keep the link type", () => {
  assert.equal(
    saveLinkEditor(VETH_STITCH, "srl1", "e1-1", { mtu: 9000, targetIpv4: "10.0.0.1/31" }),
    replaceOnce(
      replaceOnce(VETH_STITCH, "mtu: 1500", "mtu: 9000"),
      "        - node: srl2\n          interface: e1-1\n",
      "        - node: srl2\n          interface: e1-1\n          ipv4: 10.0.0.1/31\n"
    )
  );
});

test("a brief veth link switches to veth-stitch and back", () => {
  const stitched = saveLinkEditor(VETH_BRIEF, "srl1", "e1-2", { type: "veth-stitch" });
  assert.equal(
    stitched,
    replaceOnce(
      VETH_BRIEF,
      "    - endpoints: [ 'srl1:e1-2', 'srl2:e1-2' ]\n",
      `    - type: veth-stitch
      endpoints:
        - node: "srl1"
          interface: "e1-2"
        - node: "srl2"
          interface: "e1-2"
`
    )
  );
  assert.equal(findEdge(stitched, "srl1", "e1-2").data?.extraData?.extType, "veth-stitch");

  const back = saveLinkEditor(stitched, "srl1", "e1-2", { type: "veth" });
  assert.equal(back, stitched.replace("type: veth-stitch", "type: veth"));
});

// ----------------------------------------------------------------------------
// Network node links (host, mgmt-net, macvlan, vxlan, vxlan-stitch, dummy)
// ----------------------------------------------------------------------------

const NETWORK_LINKS = `${NODES}    - type: host
      endpoint:
        node: srl1
        interface: e1-1
        mac: 02:00:00:00:01:01
        vars:
          role: edge
      host-interface: veth-h1 # host side
      vars:
        cost: 5
    - type: mgmt-net
      endpoint:
        node: srl1
        interface: e1-2
        mac: 02:00:00:00:01:02
      host-interface: mgmt1
    - type: macvlan
      endpoint:
        node: srl1
        interface: e1-3
        mac: 02:00:00:00:01:03
      host-interface: enp0s3
      mode: passthru
    - type: vxlan
      endpoint:
        node: srl2
        interface: e1-4
        mac: 02:00:00:00:01:04
      remote: 192.0.2.10
      vni: 100
      udp-port: 14789
      parent-interface: eth9
    - type: vxlan-stitch
      endpoint:
        node: srl2
        interface: e1-5
        mac: 02:00:00:00:01:05
      remote: 192.0.2.11
      vni: 101
      dst-port: 4789
      src-port: 0
    - type: dummy
      endpoint:
        node: srl2
        interface: e1-6
        mac: 02:00:00:00:01:06
      mtu: 1400
`;

const NETWORK_NODES: Array<{ id: string; mac: string; endpoint: [string, string] }> = [
  { id: "host:veth-h1", mac: "02:00:00:00:01:01", endpoint: ["srl1", "e1-1"] },
  { id: "mgmt-net:mgmt1", mac: "02:00:00:00:01:02", endpoint: ["srl1", "e1-2"] },
  { id: "macvlan:enp0s3", mac: "02:00:00:00:01:03", endpoint: ["srl1", "e1-3"] },
  { id: "vxlan:vxlan0", mac: "02:00:00:00:01:04", endpoint: ["srl2", "e1-4"] },
  { id: "vxlan-stitch:vxlan0", mac: "02:00:00:00:01:05", endpoint: ["srl2", "e1-5"] },
  { id: "dummy0", mac: "02:00:00:00:01:06", endpoint: ["srl2", "e1-6"] }
];

for (const { id, mac, endpoint } of NETWORK_NODES) {
  test(`${id}: network editor loads, keeps and saves the endpoint MAC`, () => {
    assert.equal(loadNetworkEditor(NETWORK_LINKS, id).mac, mac);

    // No changes: identical YAML
    assert.equal(saveNetworkEditor(NETWORK_LINKS, id), NETWORK_LINKS);

    // Editing another field keeps the MAC
    const withMtu = saveNetworkEditor(NETWORK_LINKS, id, { mtu: "9100" });
    assert.ok(withMtu.includes(`mac: ${mac}`));
    assert.equal(YAML.parse(withMtu).topology.links.length, 6);

    // Editing the MAC changes only that line
    assert.equal(
      saveNetworkEditor(NETWORK_LINKS, id, { mac: "02:aa:bb:cc:dd:ee" }),
      replaceOnce(NETWORK_LINKS, `mac: ${mac}`, "mac: 02:aa:bb:cc:dd:ee")
    );

    // Clearing the MAC removes it
    assert.equal(
      saveNetworkEditor(NETWORK_LINKS, id, { mac: "" }),
      replaceOnce(NETWORK_LINKS, `        mac: ${mac}\n`, "")
    );

    // The link editor on the same link keeps everything as well
    assert.equal(saveLinkEditor(NETWORK_LINKS, endpoint[0], endpoint[1]), NETWORK_LINKS);
  });
}

test("vxlan edits keep parent-interface and the deprecated udp-port", () => {
  assert.equal(loadNetworkEditor(NETWORK_LINKS, "vxlan:vxlan0").vxlanDstPort, "14789");
  assert.equal(
    saveNetworkEditor(NETWORK_LINKS, "vxlan:vxlan0", { vxlanVni: "200" }),
    replaceOnce(NETWORK_LINKS, "vni: 100", "vni: 200")
  );
  assert.equal(
    saveNetworkEditor(NETWORK_LINKS, "vxlan:vxlan0", { vxlanDstPort: "4790" }),
    replaceOnce(NETWORK_LINKS, "udp-port: 14789", "udp-port: 4790")
  );
  assert.equal(
    saveNetworkEditor(NETWORK_LINKS, "vxlan-stitch:vxlan0", { vxlanSrcPort: "" }),
    replaceOnce(NETWORK_LINKS, "      src-port: 0\n", "")
  );
});

test("host link edits keep endpoint vars, link vars and comments", () => {
  assert.equal(
    saveNetworkEditor(NETWORK_LINKS, "host:veth-h1", { interfaceName: "veth-h2" }),
    replaceOnce(NETWORK_LINKS, "host-interface: veth-h1", "host-interface: veth-h2")
  );
  assert.equal(
    saveLinkEditor(NETWORK_LINKS, "srl1", "e1-1", { sourceEndpoint: "e1-9" }),
    replaceOnce(NETWORK_LINKS, "interface: e1-1", "interface: e1-9")
  );
});

test("network editor var edits keep number types", () => {
  assert.deepEqual(loadNetworkEditor(NETWORK_LINKS, "host:veth-h1").vars, { cost: "5" });
  assert.equal(
    saveNetworkEditor(NETWORK_LINKS, "host:veth-h1", { vars: { cost: "6" } }),
    replaceOnce(NETWORK_LINKS, "cost: 5", "cost: 6")
  );
});

test("changing a host link to vxlan fills the required vxlan keys", () => {
  const out = saveNetworkEditor(NETWORK_LINKS, "dummy0", {
    networkType: "vxlan",
    vxlanRemote: "192.0.2.20",
    vxlanVni: "300"
  });
  const dummyLink = `    - type: dummy
      endpoint:
        node: srl2
        interface: e1-6
        mac: 02:00:00:00:01:06
      mtu: 1400
`;
  assert.equal(
    out,
    replaceOnce(
      NETWORK_LINKS,
      dummyLink,
      `    - type: vxlan
      endpoint:
        node: srl2
        interface: e1-6
        mac: 02:00:00:00:01:06
      mtu: 1400
      remote: 192.0.2.20
      vni: 300
      dst-port: 4789
`
    )
  );
});

test("changing the network type drops keys the new type does not accept", () => {
  const out = saveNetworkEditor(NETWORK_LINKS, "macvlan:enp0s3", { networkType: "host" });
  assert.equal(
    out,
    replaceOnce(
      NETWORK_LINKS,
      `    - type: macvlan
      endpoint:
        node: srl1
        interface: e1-3
        mac: 02:00:00:00:01:03
      host-interface: enp0s3
      mode: passthru
`,
      `    - type: host
      endpoint:
        node: srl1
        interface: e1-3
        mac: 02:00:00:00:01:03
      host-interface: enp0s3
`
    )
  );
});

const BRIEF_HOST = `${NODES}    - endpoints: [ "srl1:e1-1", "host:veth-h1" ]
      mtu: 1500
    - endpoints: [ "macvlan:enp0s3", "srl2:e1-1" ]
`;

test("brief host and macvlan links stay brief when nothing requires the extended form", () => {
  assert.equal(saveLinkEditor(BRIEF_HOST, "srl1", "e1-1"), BRIEF_HOST);
  assert.equal(saveNetworkEditor(BRIEF_HOST, "host:veth-h1"), BRIEF_HOST);
  assert.equal(saveNetworkEditor(BRIEF_HOST, "macvlan:enp0s3"), BRIEF_HOST);
  assert.equal(
    saveNetworkEditor(BRIEF_HOST, "host:veth-h1", { interfaceName: "veth-h2" }),
    replaceOnce(BRIEF_HOST, "host:veth-h1", "host:veth-h2")
  );
  assert.equal(
    saveLinkEditor(BRIEF_HOST, "srl1", "e1-1", { sourceEndpoint: "e1-2" }),
    replaceOnce(BRIEF_HOST, "srl1:e1-1", "srl1:e1-2")
  );
});

test("setting a MAC on a brief host link converts it and carries everything over", () => {
  assert.equal(
    saveNetworkEditor(BRIEF_HOST, "host:veth-h1", { mac: "02:00:00:00:00:01" }),
    replaceOnce(
      BRIEF_HOST,
      `    - endpoints: [ "srl1:e1-1", "host:veth-h1" ]\n`,
      `    - type: host
      endpoint:
        node: "srl1"
        interface: "e1-1"
        mac: 02:00:00:00:00:01
      host-interface: veth-h1
`
    )
  );
  assert.equal(
    saveNetworkEditor(BRIEF_HOST, "macvlan:enp0s3", { macvlanMode: "vepa" }),
    replaceOnce(
      BRIEF_HOST,
      `    - endpoints: [ "macvlan:enp0s3", "srl2:e1-1" ]\n`,
      `    - type: macvlan
      endpoint:
        node: "srl2"
        interface: "e1-1"
      host-interface: enp0s3
      mode: vepa
`
    )
  );
});

test("brief host links can be deleted", () => {
  const doc = YAML.parseDocument(BRIEF_HOST);
  const edge = findEdge(BRIEF_HOST, "srl1", "e1-1");
  assert.deepEqual(deleteLinkFromDoc(doc, toLinkSaveData(edge)), { success: true });
  assert.equal(
    doc.toString(),
    replaceOnce(BRIEF_HOST, `    - endpoints: [ "srl1:e1-1", "host:veth-h1" ]\n      mtu: 1500\n`, "")
  );
});
