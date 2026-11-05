/** What the engine's HTTP API answers, as far as the Fabric view reads it. */

export type FabricSeverity = "error" | "warning" | "info";

export type FabricFindingCounts = Partial<Record<FabricSeverity, number>>;

interface FabricNodeStatus {
  name: string;
  address?: string;
  labels?: Record<string, string>;
  /** `connecting`, `syncing`, `live` or `down`. */
  status: string;
  /** Why it is down. */
  error?: string;
  since?: number;
  heard?: number;
}

export interface FabricStatus {
  fabric: string;
  started?: number;
  nodes: FabricNodeStatus[];
  streamed?: string[];
}

export interface FabricFinding {
  node: string;
  check: string;
  severity: FabricSeverity;
  subject: string;
  detail: string;
  raised?: number;
}

export interface FabricIncident {
  id: string;
  severity: FabricSeverity;
  kind: string;
  title: string;
  nodes: string[];
  explanation?: string;
  first_seen?: number;
  root: FabricFinding;
  related: FabricFinding[];
  acknowledged?: boolean;
  ack?: { at?: number; note?: string } | null;
}

export interface FabricTopologyNode {
  name: string;
  tier: string;
  type?: string;
  ipv4?: string;
  ipv6?: string;
  asn?: number | null;
  /** Why it cannot be reached; empty while it can. */
  unreachable?: string;
  findings?: FabricFindingCounts;
  health?: string;
  services?: string[];
}

interface FabricCable {
  a_port: string;
  b_port: string;
  /** `up`, `down`, `mixed` or `lost`: seen in the history, but no longer by LLDP. */
  state: string;
  a_out_bps?: number | null;
  b_out_bps?: number | null;
}

export interface FabricLink {
  a: string;
  b: string;
  cables: FabricCable[];
  count: number;
  state: string;
  findings?: FabricFindingCounts;
}

interface FabricAttachment {
  node: string;
  port: string;
  subinterface: string;
  service: string;
  kind?: string;
  vlan?: number | null;
  addresses?: string[];
  esi?: string;
  out_bps?: number | null;
  in_bps?: number | null;
}

/** A host hanging off the fabric. */
export interface FabricAttachedClient {
  id: string;
  name?: string;
  label: string;
  esi?: string;
  nodes: string[];
  attachments: FabricAttachment[];
}

interface FabricSegment {
  esi: string;
  names: string[];
  mode?: string;
  type?: string;
  nodes: Array<{ node: string; interfaces: string[]; oper?: string }>;
  next_hops?: string[];
}

export interface FabricTopology {
  nodes: FabricTopologyNode[];
  links: FabricLink[];
  clients: FabricAttachedClient[];
  segments: FabricSegment[];
  outside?: Array<{ name: string; nodes: string[] }>;
  components: Array<{ name: string; nodes: string[] }>;
}

interface FabricCommitRef {
  node: string;
  id?: number;
  seen?: number;
  at?: number;
}

export type FabricRecord = Record<string, unknown>;

/** One change the engine kept. */
export interface FabricChange {
  seq: number;
  ts: number;
  node: string;
  report: string;
  /** JSON of the record's key. */
  key: string;
  op: string;
  before: FabricRecord | null;
  after: FabricRecord | null;
  cause?: string;
  origin?: string;
  commit?: FabricCommitRef;
  /** What the server makes of a finding's change: raised, cleared, escalated, eased or updated. */
  finding?: string;
}

export interface FabricBaseline {
  name: string;
  ts: number;
  comment?: string;
}

export interface FabricParam {
  name: string;
  help: string;
  default?: string | null;
  choices?: string[];
}

/** A report as the navigation and its form need it: the catalog's schemas are left behind. */
export interface FabricReportSpec {
  name: string;
  help: string;
  streamed?: boolean;
  hidden?: boolean;
  eventful?: boolean;
  params: FabricParam[];
  needs_query?: boolean;
  rib_keys?: string[];
  rib_evpn?: boolean;
}

/** A rendered cell: text, or an object the view draws itself. */
export type FabricCell = unknown;

export interface FabricTableAnswer<TRecord = FabricRecord> {
  report?: string;
  source?: string;
  records?: TRecord[];
  /** Nodes that could not answer, and why. */
  errors?: Record<string, string>;
  message?: string;
  truncated?: boolean;
  columns?: string[];
  rows?: FabricCell[][];
}

export interface FabricPathHop {
  node: string;
  hop: number;
  lookup?: number;
  ni: string;
  address: string;
  outcome: string;
  prefix?: string;
  route_type?: string;
  next_hop?: string;
  egress?: string;
  peer?: string;
  peer_port?: string;
  tunnel?: string;
  endpoint?: string;
  vni?: number | null;
  resumes_in?: string;
  mac?: string;
  gateway?: string;
  esi?: string;
  segment?: string;
}

export interface FabricSighting {
  node: string;
  kind: string;
  ni?: string;
  interface?: string;
  origin?: string;
}

export interface FabricServicePort {
  name: string;
  kind: string;
  oper?: string;
  vlan?: number | null;
  addresses?: string[];
  segment?: string;
  esi?: string;
  peer_ni?: string;
}

export interface FabricServiceRecord {
  node: string;
  name: string;
  type: string;
  oper?: string;
  site?: string;
  group?: string;
  dci?: string;
  vnis?: number[];
  evis?: string[];
  vpn?: Array<{ id?: number; rd?: string; import_rts?: string[]; export_rts?: string[] }>;
  wan?: number[];
  gateway?: boolean;
  subnets?: string[];
  ports?: FabricServicePort[];
  linked?: string[];
  macs_local?: number;
  macs_remote?: number;
  issues?: string[];
}

export interface FabricDiffLine {
  n: number;
  text: string;
}

export interface FabricDiffRow {
  /** `same`, `added`, `removed`, `changed` or `skip`. */
  kind: string;
  count?: number;
  left?: FabricDiffLine | null;
  right?: FabricDiffLine | null;
}

export interface FabricKeptConfig {
  ts: number;
  commit_id?: number | null;
}

export interface FabricConfigDiff {
  node: string;
  at?: number | null;
  before?: FabricKeptConfig | null;
  after: FabricKeptConfig;
  commits: Array<{ id: number; username?: string; comment?: string }>;
  added: number;
  removed: number;
  changed: number;
  rows?: FabricDiffRow[];
}
