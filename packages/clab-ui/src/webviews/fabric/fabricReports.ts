/** The report catalog as the navigation and the report view use it. */
import { natural } from "./fabricFormat";
import type { FabricParam, FabricReportSpec } from "./fabricTypes";

const REPORT_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Platform", ["sys-info", "config-commits", "components", "resources", "transceivers"]],
  ["Interfaces", ["subif", "lag", "ifstats", "lldp"]],
  ["Routing", ["bgp-peers", "ipv4-rib", "ipv6-rib", "static-routes", "routing-pol", "bfd", "isis", "ospf", "tunnel-table"]],
  ["Services", ["ni", "irb", "mac", "arp", "nd", "es", "es-dest", "vxlan"]]
];

/** Left out of the navigation: the Services lens shows them end to end. */
const UNLISTED = new Set(["services", "bridge-domains", "routers"]);

const REPORT_TITLES: Readonly<Record<string, string>> = {
  "sys-info": "System Information",
  "config-commits": "Configuration Commits",
  components: "Components",
  resources: "Resource Utilization",
  transceivers: "Transceivers",
  subif: "Subinterfaces",
  lag: "LAGs",
  ifstats: "Interface Rates",
  lldp: "LLDP Neighbors",
  "bgp-peers": "BGP Peers",
  "ipv4-rib": "IPv4 Route Table",
  "ipv6-rib": "IPv6 Route Table",
  "static-routes": "Static Routes",
  "routing-pol": "Routing Policies",
  bfd: "BFD Sessions",
  isis: "IS-IS",
  ospf: "OSPF",
  "tunnel-table": "Tunnel Table",
  "bgp-rib-evpn": "EVPN, all route types",
  "bgp-rib-evpn-1": "EVPN Type 1: A-D",
  "bgp-rib-evpn-2": "EVPN Type 2: MAC/IP",
  "bgp-rib-evpn-3": "EVPN Type 3: IMET",
  "bgp-rib-evpn-4": "EVPN Type 4: ES",
  "bgp-rib-evpn-5": "EVPN Type 5: IP Prefix",
  "bgp-rib-ipv4-unicast": "IPv4 Unicast",
  "bgp-rib-ipv6-unicast": "IPv6 Unicast",
  "bgp-rib-l3vpn-ipv4-unicast": "L3VPN IPv4",
  "bgp-rib-l3vpn-ipv6-unicast": "L3VPN IPv6",
  ni: "Network Instances",
  irb: "IRB Interfaces",
  mac: "MAC Table",
  arp: "ARP Table",
  nd: "IPv6 Neighbors",
  es: "Ethernet Segments",
  "es-dest": "Segment Destinations",
  vxlan: "VXLAN Interfaces"
};

export function reportTitle(name: string): string {
  const title = REPORT_TITLES[name] ?? name;
  return name.startsWith("bgp-rib-") ? `BGP RIB ${title}` : title;
}

/** What a report is called in its group, where the group already says the rest. */
export function reportNavTitle(name: string): string {
  return REPORT_TITLES[name] ?? name;
}

/** Only what the view uses of the catalog: its schemas are most of its 235 KB. */
export function trimCatalog(catalog: readonly FabricReportSpec[]): FabricReportSpec[] {
  return catalog.map((spec) => ({
    name: spec.name,
    help: spec.help,
    streamed: spec.streamed,
    hidden: spec.hidden,
    eventful: spec.eventful,
    params: spec.params,
    needs_query: spec.needs_query,
    rib_keys: spec.rib_keys,
    rib_evpn: spec.rib_evpn
  }));
}

export interface FabricReportGroup {
  title: string;
  reports: FabricReportSpec[];
}

/** The reports by group; a BGP RIB family is a group, and anything new lands in Other. */
export function reportGroups(catalog: readonly FabricReportSpec[]): FabricReportGroup[] {
  const byName = new Map(catalog.map((spec) => [spec.name, spec]));
  const listed = (names: readonly string[]) =>
    names.flatMap((name) => {
      const spec = byName.get(name);
      return spec && !spec.hidden ? [spec] : [];
    });
  const known = new Set(REPORT_GROUPS.flatMap(([, names]) => names));
  const groups = REPORT_GROUPS.map(([title, names]) => ({ title, reports: listed(names) }));
  const rib = catalog
    .filter((spec) => spec.hidden && spec.name.startsWith("bgp-rib-"))
    .sort((a, b) => natural(a.name, b.name));
  if (rib.length > 0) groups.splice(3, 0, { title: "BGP RIB", reports: rib });
  const other = catalog
    .filter((spec) => !spec.hidden && !known.has(spec.name) && !UNLISTED.has(spec.name))
    .sort((a, b) => natural(a.name, b.name));
  if (other.length > 0) groups.push({ title: "Other", reports: other });
  return groups.filter((group) => group.reports.length > 0);
}

export function matchesReportFind(spec: FabricReportSpec, find: string): boolean {
  const term = find.trim().toLowerCase();
  return !term || spec.name.includes(term) || reportTitle(spec.name).toLowerCase().includes(term);
}

/** Whether a BGP RIB is narrowed enough to read: it can hold tens of thousands of routes. */
export function ribQueryReady(spec: FabricReportSpec, params: Readonly<Record<string, string>>): boolean {
  if (!spec.needs_query) return true;
  if (params.list_all === "all") return true;
  if ((params.neighbor ?? "").trim()) return true;
  if (!spec.rib_evpn && (params.ni ?? "").trim()) return true;
  return (spec.rib_keys ?? []).some((key) => (params[key] ?? "").trim());
}

/** The report's own parameters out of a route's arguments. */
export function reportParams(spec: FabricReportSpec, query: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(spec.params.map((param) => [param.name, query[param.name] ?? ""]));
}

const PARAM_LABELS: Readonly<Record<string, string>> = {
  ni: "Network instance",
  esi: "ESI",
  ip_address: "IP address",
  mac_address: "MAC address",
  route_distinguisher: "Route distinguisher",
  ethernet_tag_id: "Ethernet tag"
};

/** What a report's parameter is called in its form. */
export function paramLabel(name: string): string {
  const label = PARAM_LABELS[name] ?? name.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const PARAM_PLACEHOLDER_LENGTH = 24;

/** A hint that fits in a parameter's field: its example where its help gives one, or its help up to the first stop. */
export function paramPlaceholder(param: Pick<FabricParam, "help">): string {
  const example = /e\.g\.\s*(.+)$/.exec(param.help)?.[1];
  const text = (example ?? param.help.split(/[;:(,]/)[0] ?? "").trim();
  if (text.length <= PARAM_PLACEHOLDER_LENGTH) return text;
  return "";
}

const RIB_DIRECTION: Readonly<Record<string, string>> = { rx: "received", act: "active", tx: "advertised" };

/** The BGP RIB form filled in for one count of a BGP peer: received, active or advertised routes. */
export function ribFormQuery(
  count: { family: string; node: string; ni?: string; peer: string },
  which: "rx" | "act" | "tx"
): { report: string; query: Record<string, string> } {
  return {
    report: `bgp-rib-${count.family}`,
    query: {
      node: count.node,
      neighbor: count.peer,
      direction: RIB_DIRECTION[which] ?? "received",
      paths: "used",
      ...(count.family !== "evpn" && count.ni ? { ni: count.ni } : {})
    }
  };
}
