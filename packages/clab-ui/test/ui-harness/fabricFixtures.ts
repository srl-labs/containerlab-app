/**
 * A pretend fcling engine for the Fabric view, shaped like what a real engine
 * answered on an SR Linux lab: two spines over four leaves, with a cable that
 * went down. `state` picks how the engine behaves when the view opens.
 */
import type {
  FabricClient,
  FabricEventHandlers,
  FclingApiRequest,
  FclingEngineStatus,
  FclingEvent
} from "../../src/fabric/engine";
import { FabricApiError } from "../../src/fabric/engine";
import type {
  FabricBaseline,
  FabricChange,
  FabricConfigDiff,
  FabricIncident,
  FabricTableAnswer,
  FabricTopology
} from "../../src/webviews/fabric/fabricTypes";

import { FABRIC_CATALOG } from "./fabricCatalog";

const now = () => Date.now() / 1000;
/** One clock reading for what must line up: an incident and the changes just before it. */
const loadedAt = now();
const started = loadedAt - 3 * 3600;

const LEAVES = ["leaf1", "leaf2", "leaf3", "leaf4"];
const NODE_NAMES = ["spine1", "spine2", ...LEAVES];

function statusAnswer() {
  return {
    fabric: "fabrictest",
    source: "engine",
    started,
    nodes: NODE_NAMES.map((name) => ({
      name,
      address: `clab-fabrictest-${name}`,
      labels: { role: name.startsWith("spine") ? "spine" : "leaf" },
      status: name === "leaf4" ? "down" : "live",
      error: name === "leaf4" ? "connection refused" : "",
      since: now() - (name === "leaf4" ? 420 : 3 * 3590),
      heard: name === "leaf4" ? now() - 420 : now() - 4
    })),
    streamed: ["bgp-peers", "ifstats", "lldp", "subif", "sys-info", "config-commits"],
    incidents: { errors: 1, warnings: 1, info: 1, acknowledged: 0 }
  };
}

const TOPOLOGY: FabricTopology = {
  nodes: [
    { name: "spine1", tier: "spine", type: "7220 IXR-D3L", ipv4: "10.0.0.1", ipv6: "", asn: 65000, unreachable: "", findings: { error: 2 }, health: "error", services: [] },
    { name: "spine2", tier: "spine", type: "7220 IXR-D3L", ipv4: "10.0.0.2", ipv6: "", asn: 65000, unreachable: "", findings: {}, health: "ok", services: [] },
    { name: "leaf1", tier: "leaf", type: "7220 IXR-D2L", ipv4: "10.0.1.1", ipv6: "", asn: 65001, unreachable: "", findings: { error: 2 }, health: "error", services: ["macvrf-100", "ipvrf-1"] },
    { name: "leaf2", tier: "leaf", type: "7220 IXR-D2L", ipv4: "10.0.1.2", ipv6: "", asn: 65002, unreachable: "", findings: {}, health: "ok", services: ["macvrf-100", "ipvrf-1"] },
    { name: "leaf3", tier: "leaf", type: "7220 IXR-D2L", ipv4: "10.0.1.3", ipv6: "", asn: 65003, unreachable: "", findings: { warning: 1, info: 1 }, health: "warning", services: ["macvrf-200"] },
    { name: "leaf4", tier: "leaf", type: "7220 IXR-D2L", ipv4: "10.0.1.4", ipv6: "", asn: 65004, unreachable: "connection refused", findings: {}, health: "unreachable", services: ["macvrf-200"] }
  ],
  links: [
    { a: "leaf1", b: "spine1", count: 1, state: "lost", findings: { error: 2 }, cables: [{ a_port: "ethernet-1/49", b_port: "ethernet-1/1", state: "lost", a_out_bps: null, b_out_bps: null }] },
    { a: "leaf1", b: "spine2", count: 1, state: "up", findings: {}, cables: [{ a_port: "ethernet-1/50", b_port: "ethernet-1/1", state: "up", a_out_bps: 1_200_000, b_out_bps: 450_000 }] },
    { a: "leaf2", b: "spine1", count: 1, state: "up", findings: {}, cables: [{ a_port: "ethernet-1/49", b_port: "ethernet-1/2", state: "up", a_out_bps: 3_400_000, b_out_bps: 6_200_000 }] },
    {
      a: "leaf2",
      b: "spine2",
      count: 2,
      state: "mixed",
      findings: { warning: 1 },
      cables: [
        { a_port: "ethernet-1/50", b_port: "ethernet-1/2", state: "up", a_out_bps: 8_900_000, b_out_bps: 200 },
        { a_port: "ethernet-1/51", b_port: "ethernet-1/3", state: "down", a_out_bps: 0, b_out_bps: 0 }
      ]
    },
    { a: "leaf3", b: "spine1", count: 1, state: "up", findings: {}, cables: [{ a_port: "ethernet-1/49", b_port: "ethernet-1/3", state: "up", a_out_bps: 300, b_out_bps: 200 }] },
    { a: "leaf3", b: "spine2", count: 1, state: "up", findings: {}, cables: [{ a_port: "ethernet-1/50", b_port: "ethernet-1/4", state: "up", a_out_bps: 300, b_out_bps: 200 }] },
    { a: "leaf4", b: "spine1", count: 1, state: "down", findings: {}, cables: [{ a_port: "ethernet-1/49", b_port: "ethernet-1/4", state: "down", a_out_bps: null, b_out_bps: null }] },
    { a: "leaf4", b: "spine2", count: 1, state: "down", findings: {}, cables: [{ a_port: "ethernet-1/50", b_port: "ethernet-1/5", state: "down", a_out_bps: null, b_out_bps: null }] }
  ],
  clients: [
    {
      id: "lldp:host1",
      name: "host1",
      label: "host1",
      esi: "",
      nodes: ["leaf1"],
      attachments: [{ node: "leaf1", port: "ethernet-1/1", subinterface: "ethernet-1/1.0", service: "macvrf-100", kind: "bridged", vlan: 100, addresses: [], esi: "", out_bps: 100_000, in_bps: 240_000 }]
    },
    {
      id: "es:00:01",
      name: "",
      label: "es-host2",
      esi: "00:01:00:00:00:00:00:00:00:01",
      nodes: ["leaf1", "leaf2"],
      attachments: [
        { node: "leaf1", port: "lag1", subinterface: "lag1.0", service: "macvrf-100", kind: "bridged", vlan: 100, addresses: [], esi: "00:01:00:00:00:00:00:00:00:01", out_bps: 2_000, in_bps: 1_000 },
        { node: "leaf2", port: "lag1", subinterface: "lag1.0", service: "macvrf-100", kind: "bridged", vlan: 100, addresses: [], esi: "00:01:00:00:00:00:00:00:00:01", out_bps: 3_000, in_bps: 2_000 }
      ]
    },
    {
      id: "lldp:host3",
      name: "host3",
      label: "host3",
      esi: "",
      nodes: ["leaf3"],
      attachments: [{ node: "leaf3", port: "ethernet-1/1", subinterface: "ethernet-1/1.0", service: "macvrf-200", kind: "bridged", vlan: 200, addresses: [], esi: "", out_bps: null, in_bps: null }]
    }
  ],
  segments: [
    {
      esi: "00:01:00:00:00:00:00:00:00:01",
      names: ["es-host2"],
      mode: "all-active",
      type: "lag",
      nodes: [
        { node: "leaf1", interfaces: ["lag1"], oper: "up" },
        { node: "leaf2", interfaces: ["lag1"], oper: "up" }
      ],
      next_hops: ["10.0.1.1", "10.0.1.2"]
    }
  ],
  outside: [],
  components: [{ name: "fabrictest", nodes: NODE_NAMES }]
};

const EMPTY_TOPOLOGY: FabricTopology = { nodes: [], links: [], clients: [], segments: [], outside: [], components: [] };

function initialIncidents(): FabricIncident[] {
  const firstSeen = loadedAt - 24 * 60;
  return [
    {
      id: "link|leaf1:ethernet-1/49+spine1:ethernet-1/1",
      severity: "error",
      kind: "link",
      title: "leaf1 e1/49 <-> spine1 e1/1: interface down",
      nodes: ["leaf1", "spine1"],
      explanation: "admin enabled but oper down: port-admin-disabled. It accounts for 1 interface down, 2 BGP sessions down.",
      first_seen: firstSeen,
      root: { node: "leaf1", check: "itf_down", severity: "error", subject: "ethernet-1/49.0", detail: "admin enabled but oper down: port-admin-disabled" },
      related: [
        { node: "spine1", check: "itf_down", severity: "error", subject: "ethernet-1/1.0", detail: "admin enabled but oper down: lower-layer-down" },
        { node: "leaf1", check: "bgp_down", severity: "error", subject: "default/192.168.1.0", detail: "session is active, peer-group ebgp, AS 65000" },
        { node: "spine1", check: "bgp_down", severity: "error", subject: "default/192.168.1.1", detail: "session is active, peer-group ebgp, AS 65001" }
      ],
      acknowledged: false,
      ack: null
    },
    {
      id: "node|leaf3:bgp-flap",
      severity: "warning",
      kind: "node",
      title: "leaf3: BGP session flapping",
      nodes: ["leaf3"],
      explanation: "The session to spine2 went down and came back 3 times in 10 minutes.",
      first_seen: now() - 50 * 60,
      root: { node: "leaf3", check: "bgp_flap", severity: "warning", subject: "default/192.168.3.0", detail: "3 transitions in 10 minutes" },
      related: [],
      acknowledged: false,
      ack: null
    },
    {
      id: "link|leaf2:ethernet-1/49+spine1:ethernet-1/2",
      severity: "info",
      kind: "link",
      title: "leaf2 e1/49 <-> spine1 e1/2: BGP family without routes",
      nodes: ["leaf2", "spine1"],
      explanation: "ipv4-unicast is up but has received no routes.",
      first_seen: started + 5,
      root: { node: "leaf2", check: "bgp_no_routes", severity: "info", subject: "default/192.168.1.2", detail: "ipv4-unicast is up but has received no routes" },
      related: [],
      acknowledged: false,
      ack: null
    }
  ];
}

const FINDINGS = [
  { node: "leaf1", check: "itf_down", severity: "error", subject: "ethernet-1/49.0", detail: "admin enabled but oper down: port-admin-disabled", raised: now() - 1440 },
  { node: "leaf1", check: "bgp_down", severity: "error", subject: "default/192.168.1.0", detail: "session is active, peer-group ebgp, AS 65000", raised: now() - 1440 },
  { node: "spine1", check: "itf_down", severity: "error", subject: "ethernet-1/1.0", detail: "admin enabled but oper down: lower-layer-down", raised: now() - 1440 },
  { node: "spine1", check: "bgp_down", severity: "error", subject: "default/192.168.1.1", detail: "session is active, peer-group ebgp, AS 65001", raised: now() - 1440 },
  { node: "leaf3", check: "bgp_flap", severity: "warning", subject: "default/192.168.3.0", detail: "3 transitions in 10 minutes", raised: now() - 3000 },
  { node: "leaf3", check: "bgp_no_routes", severity: "info", subject: "default/192.168.3.0", detail: "ipv4-unicast is up but has received no routes", raised: now() - 3000 }
];

function commitRef(node: string, id: number, minutesAgo: number) {
  return { node, id, seen: now() - minutesAgo * 60, at: now() - minutesAgo * 60 - 2 };
}

function historyChanges(): FabricChange[] {
  let seq = 100;
  const change = (minutesAgo: number, fields: Partial<FabricChange> & Pick<FabricChange, "node" | "report" | "key" | "op">): FabricChange => ({
    seq: (seq += 1),
    ts: loadedAt - minutesAgo * 60,
    before: null,
    after: null,
    ...fields
  });
  const commit = commitRef("leaf1", 3, 24);
  const fromCommit = { cause: "commit 3 by root", origin: "config", commit };
  const changes: FabricChange[] = [
    change(55, { node: "leaf3", report: "bgp-peers", key: '["default","192.168.3.0"]', op: "change", before: { node: "leaf3", state: "established" }, after: { node: "leaf3", state: "active" }, origin: "unplanned" }),
    change(52, { node: "leaf3", report: "checks", key: '["bgp_flap","default/192.168.3.0"]', op: "add", finding: "raised", after: { node: "leaf3", check: "bgp_flap", severity: "warning", subject: "default/192.168.3.0", detail: "3 transitions in 10 minutes" }, origin: "unplanned" }),
    change(51, { node: "leaf3", report: "bgp-peers", key: '["default","192.168.3.0"]', op: "change", before: { node: "leaf3", state: "active" }, after: { node: "leaf3", state: "established" }, origin: "unplanned" }),
    change(40, { node: "leaf2", report: "lldp", key: '["ethernet-1/51","1A:96:02:FF:00:00"]', op: "remove", before: { node: "leaf2", interface: "ethernet-1/51", system_name: "spine2", port_id: "ethernet-1/3" }, origin: "unplanned" }),
    change(24, { node: "leaf1", report: "config-commits", key: "[3]", op: "add", after: { node: "leaf1", id: 3, status: "complete", username: "root", comment: "take e1-49 out of service", type: "shared", session: "default" }, origin: "config", cause: "", commit }),
    change(24, { node: "leaf1", report: "subif", key: '["ethernet-1/49.0"]', op: "change", before: { node: "leaf1", interface: "ethernet-1/49", name: "ethernet-1/49.0", oper: "up", down_reason: "", ipv4: ["192.168.1.1/31"] }, after: { node: "leaf1", interface: "ethernet-1/49", name: "ethernet-1/49.0", oper: "down", down_reason: "port-admin-disabled", ipv4: ["192.168.1.1/31"] }, ...fromCommit }),
    change(24, { node: "leaf1", report: "lldp", key: '["ethernet-1/49","1A:96:02:FF:00:00"]', op: "remove", before: { node: "leaf1", interface: "ethernet-1/49", chassis_id: "1A:96:02:FF:00:00", system_name: "spine1", port_id: "ethernet-1/1" }, ...fromCommit }),
    change(24, { node: "leaf1", report: "checks", key: '["itf_down","ethernet-1/49.0"]', op: "add", finding: "raised", after: { node: "leaf1", check: "itf_down", severity: "error", subject: "ethernet-1/49.0", detail: "admin enabled but oper down: port-admin-disabled" }, ...fromCommit }),
    change(24, { node: "spine1", report: "bgp-peers", key: '["default","192.168.1.1"]', op: "change", before: { node: "spine1", state: "established", import_policies: ["all"] }, after: { node: "spine1", state: "active", import_policies: ["all"] }, cause: "commit 3 on leaf1 by root", origin: "config", commit }),
    change(24, { node: "spine1", report: "checks", key: '["bgp_no_routes","default/192.168.1.1"]', op: "remove", finding: "cleared", before: { node: "spine1", check: "bgp_no_routes", severity: "info", subject: "default/192.168.1.1", detail: "ipv4-unicast is up but has received no routes" }, cause: "commit 3 on leaf1 by root", origin: "config", commit }),
    change(7, { node: "leaf4", report: "subif", key: '["ethernet-1/49.0"]', op: "change", before: { node: "leaf4", name: "ethernet-1/49.0", oper: "up" }, after: { node: "leaf4", name: "ethernet-1/49.0", oper: "down" }, origin: "unplanned" })
  ];
  return changes;
}

function configDiff(): FabricConfigDiff {
  const line = (n: number, text: string) => ({ n, text });
  return {
    node: "leaf1",
    at: null,
    before: { ts: now() - 26 * 60, commit_id: 2 },
    after: { ts: now() - 24 * 60, commit_id: 3 },
    commits: [{ id: 3, username: "root", comment: "take e1-49 out of service" }],
    added: 1,
    removed: 0,
    changed: 1,
    rows: [
      { kind: "skip", count: 536 },
      { kind: "same", left: line(537, "set / acl policers system-cpu-policer icmp peak-rate-pps 1000"), right: line(537, "set / acl policers system-cpu-policer icmp peak-rate-pps 1000") },
      { kind: "changed", left: line(538, "set / interface ethernet-1/49 admin-state enable"), right: line(538, "set / interface ethernet-1/49 admin-state disable") },
      { kind: "same", left: line(539, "set / interface ethernet-1/49 subinterface 0 admin-state enable"), right: line(539, "set / interface ethernet-1/49 subinterface 0 admin-state enable") },
      { kind: "added", left: null, right: line(540, "set / interface ethernet-1/49 description \"out of service\"") },
      { kind: "skip", count: 126 }
    ]
  };
}

const BGP_COLUMNS = ["Node", "NI", "peer", "state", "local-as", "peer-as", "local-address", "evpn\nRx/Act/Tx", "ipv4-unicast\nRx/Act/Tx", "export-policy", "flags", "group"];

function bgpRow(node: string, peer: string, state: string, localAs: string, peerAs: string, local: string, rx: number): unknown[] {
  return [
    node, "default", peer, state, localAs, peerAs, local, "disabled",
    state === "up" ? { kind: "bgp-rx-act-tx", family: "ipv4-unicast", node, ni: "default", peer, rx, act: rx - 1, tx: 2 } : "down",
    "all", "--F", "ebgp"
  ];
}

const BGP_ROWS = [
  bgpRow("leaf1", "192.168.1.0", "active", "65001", "65000", "", 0),
  bgpRow("leaf2", "192.168.1.2", "up", "65002", "65000", "192.168.1.3", 4),
  bgpRow("leaf3", "192.168.3.0", "up", "65003", "65000", "192.168.3.1", 12),
  bgpRow("spine1", "192.168.1.1", "active", "65000", "65001", "", 0),
  bgpRow("spine1", "192.168.1.3", "up", "65000", "65002", "192.168.1.2", 3),
  bgpRow("spine2", "192.168.2.3", "up", "65000", "65002", "192.168.2.2", 3)
];

function ifstatsRows(count: number): unknown[][] {
  return Array.from({ length: count }, (_, index) => {
    const node = NODE_NAMES[index % NODE_NAMES.length] ?? "leaf1";
    const port = Math.floor(index / NODE_NAMES.length) + 1;
    const up = index % 7 !== 3;
    return [
      node, `ethernet-1/${port}`, up ? "up" : "down", up ? "" : "port-admin-disabled",
      up ? (index * 13.7).toFixed(1) : "0.0", up ? (index * 7.3).toFixed(1) : "0.0", String(index * 2), String(index), "0", "0", String(index * 1000)
    ];
  });
}

const REPORT_TABLES: Readonly<Record<string, FabricTableAnswer>> = {
  "bgp-peers": { source: "live", errors: {}, columns: BGP_COLUMNS, rows: BGP_ROWS },
  ifstats: {
    source: "live",
    errors: {},
    columns: ["Node", "interface", "oper-state", "down-reason", "in-Kbps", "out-Kbps", "in-pps", "out-pps", "in-err", "out-err", "in-octets"],
    rows: ifstatsRows(420)
  },
  "sys-info": {
    source: "live",
    errors: {},
    columns: ["Node", "type", "serial-number", "part-number", "hw-mac-address", "last-booted", "software-version", "mgmt", "status"],
    rows: NODE_NAMES.map((node) => [node, "7220 IXR-D2L", "Sim Serial No.", "Sim Part No.", "1A:51:00:FF:00:00", "2026-11-05T14:09:21.360Z", "26.7.2", `clab-fabrictest-${node}`, "up"])
  },
  "config-commits": {
    source: "live",
    errors: {},
    columns: ["Node", "id", "status", "user", "comment", "session", "type", "started", "ended"],
    rows: [
      ["leaf1", "2", "complete", "root", "", "default", "shared", "2026-11-05T14:09:51.933Z", "2026-11-05T14:09:55.767Z"],
      ["leaf1", "3", "complete", "root", "take e1-49 out of service", "default", "shared", "2026-11-05T14:10:49.059Z", "2026-11-05T14:10:49.060Z"],
      ["spine1", "2", "complete", "root", "", "default", "shared", "2026-11-05T14:09:52.203Z", "2026-11-05T14:09:55.983Z"]
    ]
  },
  lag: {
    source: "live",
    errors: { leaf4: "connection refused" },
    columns: ["Node", "lag", "oper-state", "members"],
    rows: [["leaf1", "lag1", "up", "ethernet-1/20\nethernet-1/21"]]
  }
};

function sysInfoRecord(node: string) {
  return {
    node,
    type: "7220 IXR-D2L",
    serial_number: "Sim Serial No.",
    part_number: "Sim Part No.",
    hw_mac_address: "1A:51:00:FF:00:00",
    last_booted: "2026-11-05T14:09:21.360Z",
    software_version: "26.7.2",
    address: `clab-fabrictest-${node}`,
    status: node === "leaf4" ? "down" : "up",
    last_seen: node === "leaf4" ? "7 minutes ago" : ""
  };
}

const PATH_HOP = { lookup: 1, ni: "default", address: "10.0.1.3", prefix: "10.0.1.3/32", route_type: "bgp", tunnel: "", endpoint: "", vni: null, resumes_in: "", mac: "", gateway: "", esi: "", segment: "" };

const PATH_ARRIVES = [
  { ...PATH_HOP, node: "leaf1", hop: 0, outcome: "forwarded", next_hop: "192.168.2.0", egress: "ethernet-1/50.0", peer: "spine2", peer_port: "ethernet-1/1" },
  { ...PATH_HOP, node: "spine2", hop: 1, outcome: "forwarded", next_hop: "192.168.4.1", egress: "ethernet-1/4.0", peer: "leaf3", peer_port: "ethernet-1/50" },
  { ...PATH_HOP, node: "leaf3", hop: 2, outcome: "delivered", route_type: "host", next_hop: "", egress: "system0.0", peer: "", peer_port: "", mac: "" }
];

const PATH_FAILS = [
  { ...PATH_HOP, node: "leaf1", hop: 0, address: "10.9.9.9", outcome: "forwarded", prefix: "0.0.0.0/0", next_hop: "192.168.2.0", egress: "ethernet-1/50.0", peer: "spine2", peer_port: "ethernet-1/1" },
  { ...PATH_HOP, node: "spine2", hop: 1, address: "10.9.9.9", outcome: "no-route", prefix: "", route_type: "", next_hop: "", egress: "", peer: "", peer_port: "" }
];

const PATH_COLUMNS = ["Node", "hop", "lookup", "NI", "address", "outcome", "route", "owner", "next-hop", "via", "then", "ES"];

function serviceRecord(node: string, name: string, type: string, extra: object = {}) {
  return {
    node,
    name,
    type,
    oper: "up",
    site: "",
    group: `svc:${name}`,
    dci: "",
    vnis: type === "mac-vrf" ? [100] : [1000],
    evis: ["100"],
    vpn: [{ id: 1, rd: `10.0.1.1:100`, import_rts: ["target:65000:100"], export_rts: ["target:65000:100"] }],
    wan: [],
    gateway: false,
    subnets: type === "ip-vrf" ? ["10.1.1.0/24"] : [],
    ports: type === "mac-vrf"
      ? [{ name: "ethernet-1/1.0", kind: "bridged", oper: "up", vlan: 100 }, { name: "irb0.100", kind: "irb", oper: "up", peer_ni: "ipvrf-1" }]
      : [{ name: "irb0.100", kind: "irb", oper: "up", peer_ni: "macvrf-100", addresses: ["10.1.1.1/24"] }],
    linked: [],
    macs_local: type === "mac-vrf" ? 3 : 0,
    macs_remote: type === "mac-vrf" ? 5 : 0,
    issues: [],
    ...extra
  };
}

const SERVICES = [
  serviceRecord("leaf1", "macvrf-100", "mac-vrf"),
  serviceRecord("leaf2", "macvrf-100", "mac-vrf", {
    vpn: [{ id: 1, rd: "10.0.1.2:100", import_rts: ["target:65000:100", "target:65000:999"], export_rts: ["target:65000:100"] }]
  }),
  serviceRecord("leaf3", "macvrf-200", "mac-vrf", { group: "svc:macvrf-200", vnis: [200], oper: "down", issues: ["VNI 200 has no remote VTEP"] }),
  serviceRecord("leaf4", "macvrf-200", "mac-vrf", { group: "svc:macvrf-200", vnis: [200] }),
  serviceRecord("leaf1", "ipvrf-1", "ip-vrf"),
  serviceRecord("leaf2", "ipvrf-1", "ip-vrf")
];

function lensAnswer(name: string, query: FclingApiRequest["query"]): FabricTableAnswer<unknown> {
  switch (name) {
    case "where":
      return whereAnswer(String(query?.address ?? ""));
    case "path":
      return {
        records: String(query?.destination) === "10.9.9.9" ? PATH_FAILS : PATH_ARRIVES,
        columns: PATH_COLUMNS,
        rows: []
      };
    case "service":
      return { records: SERVICES, columns: [], rows: [] };
    case "endpoints":
      return {
        records: [],
        columns: ["Node", "IP", "MAC", "type", "role", "subinterface", "MAC-VRF", "learned"],
        rows: [
          ["leaf1", "10.1.1.11", "AA:C1:AB:73:4C:27", "host", "client", "ethernet-1/1.0", "macvrf-100", "local"],
          ["leaf2", "10.1.1.12", "AA:C1:AB:73:4C:28", "host", "client", "lag1.0", "macvrf-100", "local"]
        ]
      };
    default:
      throw new FabricApiError(404, `no lens ${name}`);
  }
}

function whereAnswer(address: string): FabricTableAnswer<unknown> {
  const columns = ["Node", "kind", "NI", "interface", "IP", "MAC", "origin", "where"];
  if (address === "10.8.8.8") {
    return { records: [{ node: "-", kind: "not-found" }], columns, rows: [["-", "not-found", "", "", "10.8.8.8", "", "", ""]] };
  }
  if (address === "10.1.1.99") {
    return {
      records: [{ node: "leaf1", kind: "duplicate" }, { node: "leaf3", kind: "duplicate" }],
      columns,
      rows: [
        ["leaf1", "duplicate", "ipvrf-1", "irb0.100", "10.1.1.99", "AA:00:00:00:00:01", "dynamic", ""],
        ["leaf3", "duplicate", "ipvrf-1", "irb0.100", "10.1.1.99", "AA:00:00:00:00:02", "dynamic", ""]
      ]
    };
  }
  return {
    records: [{ node: "leaf1", kind: "configured" }, { node: "leaf2", kind: "route" }],
    columns,
    rows: [
      ["leaf1", "configured", "default", "ethernet-1/49.0", address, "", "", "192.168.1.1/31"],
      ["leaf2", "route", "default", "ethernet-1/49.0", address, "", "", "via 192.168.1.2 (ethernet-1/49.0)"]
    ]
  };
}

export interface FabricHarnessControls {
  /** Everything the view asked, for specs to read. */
  calls: string[];
  /** Sends an event through the open streams. */
  emit: (event: FclingEvent) => void;
  /** Ends the open streams, as an engine going away does. */
  closeStreams: () => void;
  /** Changes what the topology answers from now on. */
  setNodeHealth: (node: string, health: string) => void;
  /** Whether the engine runs, from now on. */
  setEngineState: (state: FclingEngineStatus["state"]) => void;
}

function initialEngineState(state: string): FclingEngineStatus["state"] {
  if (state === "fresh" || state === "pulling") return "stopped";
  return state === "failed" ? "failed" : "ready";
}

function reportSource(query: FclingApiRequest["query"]): string {
  if (query?.at) return "history";
  return query?.address ? "collected" : "live";
}

/** A repeatable parameter as a query string has it: an empty one is not sent. */
function listOf(value: string | string[] | undefined): string[] {
  return ([] as string[]).concat(value ?? []).filter(Boolean);
}

function matchPath(path: string, prefix: string): string | undefined {
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

/**
 * `ready`, or how the engine is found: `fresh` (stopped, and starts), `pulling`
 * (its start never answers), `failed`, `empty` (no SR Linux nodes).
 */
export function createFixtureFabricClient(state: string): { client: FabricClient; controls: FabricHarnessControls } {
  const calls: string[] = [];
  const streams = new Set<FabricEventHandlers>();
  let engineState = initialEngineState(state);
  let polls = 0;
  let incidents = initialIncidents();
  const baselines: FabricBaseline[] = [];
  const topology: FabricTopology = state === "empty" ? EMPTY_TOPOLOGY : structuredClone(TOPOLOGY);
  const history = historyChanges();

  const engineStatus = (): FclingEngineStatus => {
    if (engineState === "failed") {
      return {
        state: "failed",
        image: "ghcr.io/srl-labs/fcling:latest",
        error: "Error: lab.clab.yml lists no SR Linux nodes\nthe engine exited with status 2"
      };
    }
    return { state: engineState, image: "ghcr.io/srl-labs/fcling:latest", containerName: "clab-fabrictest-fcling" };
  };

  function answer(request: FclingApiRequest): unknown {
    const { method, path, query, body } = request;
    if (query?.at && Number(query.at) < started) {
      throw new FabricApiError(400, "The history starts 3 hours ago: there is nothing kept before that.");
    }
    if (path === "status") return state === "empty" ? { ...statusAnswer(), nodes: [] } : statusAnswer();
    if (path === "topology") return topology;
    if (path === "reports") return FABRIC_CATALOG;
    if (path === "checks") {
      const nodes = listOf(query?.node);
      return nodes.length > 0 ? FINDINGS.filter((finding) => nodes.includes(finding.node)) : FINDINGS;
    }
    if (path === "incidents") return state === "empty" ? [] : incidents;
    if (path === "acks") {
      const id = method === "DELETE" ? String(query?.incident) : String((body as { incident?: string }).incident);
      incidents = incidents.map((incident) => (incident.id === id
        ? { ...incident, acknowledged: method !== "DELETE", ack: method === "DELETE" ? null : { at: now(), note: "" } }
        : incident));
      return { ok: true };
    }
    if (path === "baselines") {
      if (method === "POST") baselines.push({ name: String((body as { name?: string }).name), ts: now(), comment: "" });
      return baselines;
    }
    if (path === "history") return historyAnswer(query);
    if (path === "configs/diff") return configDiff();
    const lens = matchPath(path, "lenses/");
    if (lens) return lensAnswer(lens, query);
    const report = matchPath(path, "reports/");
    if (report) return reportAnswer(report, query);
    throw new FabricApiError(404, `no route ${path}`);
  }

  function historyAnswer(query: FclingApiRequest["query"]): FabricChange[] {
    const reports = listOf(query?.report);
    const nodes = listOf(query?.node);
    const text = String(query?.q ?? "").toLowerCase();
    const until = Number(query?.until ?? Infinity);
    return history.filter((change) =>
      (reports.length === 0 || reports.includes(change.report)) &&
      (nodes.length === 0 || nodes.includes(change.node)) &&
      change.ts <= until &&
      (!text || JSON.stringify(change).toLowerCase().includes(text))
    );
  }

  function reportAnswer(name: string, query: FclingApiRequest["query"]): FabricTableAnswer {
    if (name === "sys-info" && query?.node) {
      const node = String(query.node);
      return { source: "live", errors: {}, records: [sysInfoRecord(node)] };
    }
    if (name.startsWith("bgp-rib-")) {
      return {
        source: "collected",
        errors: {},
        columns: ["Node", "NI", "st", "Prefix", "as-path", "communities", "lpref", "med", "neighbor", "next-hop"],
        rows: [["leaf2", "default", "u*>", "10.0.1.1/32", "65000 65001", "", "", "", "192.168.1.2", "192.168.1.2"]]
      };
    }
    const source = reportSource(query);
    const table = REPORT_TABLES[name];
    return table ? { ...table, source } : { source, errors: {}, columns: ["Node", "name"], rows: [] };
  }

  const client: FabricClient = {
    async engineStatus() {
      calls.push("engine-status");
      if (engineState === "starting") {
        polls += 1;
        if (polls >= 2) engineState = "ready";
      }
      return engineStatus();
    },
    async startEngine() {
      calls.push("engine-start");
      if (state === "pulling") await new Promise(() => undefined);
      engineState = "starting";
      return engineStatus();
    },
    async stopEngine() {
      calls.push("engine-stop");
      engineState = "stopped";
      for (const stream of streams) {
        streams.delete(stream);
        stream.onClose?.();
      }
    },
    async api<T>(request: FclingApiRequest): Promise<T> {
      const search = Object.entries(request.query ?? {})
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => `${key}=${String(value)}`)
        .join("&");
      calls.push(`${request.method} ${request.path}${search ? `?${search}` : ""}`);
      if (engineState !== "ready") throw new FabricApiError(502, "The engine is not running.");
      return answer(request) as T;
    },
    openEvents(handlers, options) {
      calls.push(`events${options?.after === undefined ? "" : `?after=${options.after}`}`);
      if (engineState !== "ready") {
        setTimeout(() => handlers.onClose?.(new Error("The engine is not running.")), 0);
        return () => undefined;
      }
      streams.add(handlers);
      setTimeout(() => {
        if (streams.has(handlers)) handlers.onOpen?.();
      }, 0);
      return () => {
        streams.delete(handlers);
      };
    }
  };

  const controls: FabricHarnessControls = {
    calls,
    emit(event) {
      for (const stream of streams) stream.onEvent(event);
    },
    closeStreams() {
      for (const stream of streams) {
        streams.delete(stream);
        stream.onClose?.(new Error("gone"));
      }
    },
    setNodeHealth(name, health) {
      const node = topology.nodes.find((item) => item.name === name);
      if (node) node.health = health;
    },
    setEngineState(next) {
      engineState = next;
    }
  };
  return { client, controls };
}
