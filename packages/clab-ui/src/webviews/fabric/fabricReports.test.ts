import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesReportFind,
  paramLabel,
  paramPlaceholder,
  reportGroups,
  reportNavTitle,
  reportParams,
  reportTitle,
  ribFormQuery,
  ribQueryReady,
  trimCatalog
} from "./fabricReports";
import type { FabricReportSpec } from "./fabricTypes";

function spec(name: string, extra: Partial<FabricReportSpec> = {}): FabricReportSpec {
  return { name, help: "", params: [], ...extra };
}

test("reports are grouped, with the BGP RIB family as a group and hidden ones left out", () => {
  const groups = reportGroups([
    spec("bgp-peers"),
    spec("sys-info"),
    spec("mac"),
    spec("services"),
    spec("brand-new"),
    spec("bgp-rib-evpn-2", { hidden: true }),
    spec("bgp-rib-evpn-10", { hidden: true }),
    spec("secret", { hidden: true })
  ]);
  assert.deepEqual(
    groups.map((group) => [group.title, group.reports.map((report) => report.name)]),
    [
      ["Platform", ["sys-info"]],
      ["Routing", ["bgp-peers"]],
      ["BGP RIB", ["bgp-rib-evpn-2", "bgp-rib-evpn-10"]],
      ["Services", ["mac"]],
      ["Other", ["brand-new"]]
    ]
  );
});

test("a report is called by its title, with its family outside its group", () => {
  assert.equal(reportTitle("bgp-peers"), "BGP Peers");
  assert.equal(reportTitle("bgp-rib-evpn-2"), "BGP RIB EVPN Type 2: MAC/IP");
  assert.equal(reportNavTitle("bgp-rib-evpn-2"), "EVPN Type 2: MAC/IP");
  assert.equal(reportTitle("unknown"), "unknown");
});

test("the find box looks at names and titles", () => {
  assert.equal(matchesReportFind(spec("subif"), "SUBINT"), true);
  assert.equal(matchesReportFind(spec("subif"), "subif"), true);
  assert.equal(matchesReportFind(spec("subif"), "bgp"), false);
  assert.equal(matchesReportFind(spec("subif"), " "), true);
});

test("the catalog keeps what the view uses, not the schemas", () => {
  const full = { ...spec("mac"), schema: { huge: true }, columns: ["a"] } as FabricReportSpec;
  const [trimmed] = trimCatalog([full]);
  assert.ok(trimmed);
  assert.equal("schema" in trimmed, false);
  assert.equal("columns" in trimmed, false);
  assert.equal(trimmed.name, "mac");
});

test("a BGP RIB is only read once it is narrowed", () => {
  const rib = spec("bgp-rib-ipv4-unicast", { needs_query: true, rib_keys: ["prefix"], rib_evpn: false });
  assert.equal(ribQueryReady(rib, {}), false);
  assert.equal(ribQueryReady(rib, { prefix: " " }), false);
  assert.equal(ribQueryReady(rib, { prefix: "10.0.0.0/8" }), true);
  assert.equal(ribQueryReady(rib, { neighbor: "10.0.0.1" }), true);
  assert.equal(ribQueryReady(rib, { ni: "default" }), true);
  assert.equal(ribQueryReady(rib, { list_all: "all" }), true);
  const evpn = spec("bgp-rib-evpn", { needs_query: true, rib_keys: ["mac_address"], rib_evpn: true });
  assert.equal(ribQueryReady(evpn, { ni: "default" }), false);
  assert.equal(ribQueryReady(spec("mac"), {}), true);
});

test("a report's parameters come out of its route", () => {
  const report = spec("ipv4-rib", { params: [{ name: "address", help: "" }] });
  assert.deepEqual(reportParams(report, { address: "10.0.0.1", node: "leaf1" }), { address: "10.0.0.1" });
  assert.deepEqual(reportParams(report, {}), { address: "" });
});

test("a BGP peer's count fills in the RIB form", () => {
  assert.deepEqual(ribFormQuery({ family: "ipv4-unicast", node: "leaf1", ni: "default", peer: "10.0.0.1" }, "tx"), {
    report: "bgp-rib-ipv4-unicast",
    query: { node: "leaf1", neighbor: "10.0.0.1", direction: "advertised", paths: "used", ni: "default" }
  });
  assert.equal(ribFormQuery({ family: "evpn", node: "leaf1", ni: "default", peer: "10.0.0.1" }, "rx").query.ni, undefined);
});

test("a parameter's label and the hint in its field", () => {
  assert.equal(paramLabel("ni"), "Network instance");
  assert.equal(paramLabel("origin_protocol"), "Origin protocol");
  assert.equal(paramPlaceholder({ help: "prefix, e.g. 10.0.0.0/8" }), "10.0.0.0/8");
  assert.equal(paramPlaceholder({ help: "e.g. bgp" }), "bgp");
  assert.equal(paramPlaceholder({ help: "MAC; gNMI key match, * allowed" }), "MAC");
  assert.equal(paramPlaceholder({ help: "network-instance to read (empty: every instance)" }), "network-instance to read");
  assert.equal(paramPlaceholder({ help: "a help text that is far too long to fit in a field" }), "");
});
