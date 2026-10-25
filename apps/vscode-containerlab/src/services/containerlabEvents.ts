import * as vscode from "vscode";
import type { LabBackend } from "@srl-labs/containerlab-lab-backend";

import type { ClabDetailedJSON } from "../treeView/common";
import type { ClabInterfaceSnapshot, ClabInterfaceSnapshotEntry } from "../types/containerlab";

interface ContainerlabEvent {
  timestamp?: string;
  type: string;
  action: string;
  actor_id: string;
  actor_name?: string;
  actor_full_id?: string;
  attributes?: Record<string, unknown>;
}

interface ContainerRecord {
  labName: string;
  topoFile?: string;
  data: ClabDetailedJSON;
}

interface InterfaceRecord {
  ifname: string;
  type: string;
  state: string;
  alias?: string;
  mac?: string;
  mtu?: number;
  ifindex?: number;
  rxBps?: number;
  rxPps?: number;
  rxBytes?: number;
  rxPackets?: number;
  txBps?: number;
  txPps?: number;
  txBytes?: number;
  txPackets?: number;
  statsIntervalSeconds?: number;
  netemDelay?: string;
  netemJitter?: string;
  netemLoss?: string;
  netemRate?: string;
  netemCorruption?: string;
}

const INTERFACE_KEYS: (keyof InterfaceRecord)[] = [
  "ifname",
  "type",
  "state",
  "alias",
  "mac",
  "mtu",
  "ifindex",
  "rxBps",
  "rxPps",
  "rxBytes",
  "rxPackets",
  "txBps",
  "txPps",
  "txBytes",
  "txPackets",
  "statsIntervalSeconds",
  "netemDelay",
  "netemJitter",
  "netemLoss",
  "netemRate",
  "netemCorruption"
];

type MutableInterfaceRecord = InterfaceRecord & { [key: string]: unknown };
type MutableSnapshotEntry = ClabInterfaceSnapshotEntry & { [key: string]: unknown };

const STRING_ATTRIBUTE_MAPPINGS: Array<[keyof InterfaceRecord, string]> = [
  ["type", "type"],
  ["state", "state"],
  ["alias", "alias"],
  ["mac", "mac"]
];

const NUMERIC_ATTRIBUTE_MAPPINGS: Array<[keyof InterfaceRecord, string]> = [
  ["mtu", "mtu"],
  ["ifindex", "index"],
  ["rxBps", "rx_bps"],
  ["txBps", "tx_bps"],
  ["rxPps", "rx_pps"],
  ["txPps", "tx_pps"],
  ["rxBytes", "rx_bytes"],
  ["txBytes", "tx_bytes"],
  ["rxPackets", "rx_packets"],
  ["txPackets", "tx_packets"],
  ["statsIntervalSeconds", "interval_seconds"]
];

const SNAPSHOT_FIELD_MAPPINGS: Array<[keyof ClabInterfaceSnapshotEntry, keyof InterfaceRecord]> = [
  ["rxBps", "rxBps"],
  ["rxPps", "rxPps"],
  ["rxBytes", "rxBytes"],
  ["rxPackets", "rxPackets"],
  ["txBps", "txBps"],
  ["txPps", "txPps"],
  ["txBytes", "txBytes"],
  ["txPackets", "txPackets"],
  ["statsIntervalSeconds", "statsIntervalSeconds"]
];

// Clab event doesn't pass default values.
// Explicitly set to default value when absent for merging.
const NETEM_FIELD_MAPPINGS: Array<[keyof InterfaceRecord, string, string]> = [
  ["netemDelay", "netem_delay", "0ms"],
  ["netemJitter", "netem_jitter", "0ms"],
  ["netemLoss", "netem_loss", "0%"],
  ["netemRate", "netem_rate", "0"],
  ["netemCorruption", "netem_corruption", "0"]
];

function parseNumericAttribute(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function interfaceRecordsEqual(a: InterfaceRecord | undefined, b: InterfaceRecord): boolean {
  if (!a) {
    return false;
  }

  return INTERFACE_KEYS.every((key) => a[key] === b[key]);
}

function assignStringAttributes(
  record: MutableInterfaceRecord,
  attributes: Record<string, unknown>,
  mappings: Array<[keyof InterfaceRecord, string]>
): void {
  for (const [targetKey, attributeKey] of mappings) {
    const value = attributes[attributeKey];
    if (typeof value === "string") {
      record[targetKey as string] = value;
    }
  }
}

function assignNumericAttributes(
  record: MutableInterfaceRecord,
  attributes: Record<string, unknown>,
  mappings: Array<[keyof InterfaceRecord, string]>
): void {
  for (const [targetKey, attributeKey] of mappings) {
    const parsed = parseNumericAttribute(attributes[attributeKey]);
    if (parsed !== undefined) {
      record[targetKey as string] = parsed;
    }
  }
}

function assignNetemAttributes(
  record: MutableInterfaceRecord,
  attributes: Record<string, unknown>,
  mappings: Array<[keyof InterfaceRecord, string, string]>
): void {
  for (const [targetKey, attributeKey, defaultValue] of mappings) {
    const value = attributes[attributeKey];
    if (value !== undefined && value !== null) {
      record[targetKey as string] = value;
    } else if (record[targetKey as string] === undefined) {
      record[targetKey as string] = defaultValue;
    }
  }
}

function buildUpdatedInterfaceRecord(
  ifaceName: string,
  attributes: Record<string, unknown>,
  existing: InterfaceRecord | undefined
): InterfaceRecord {
  const base: MutableInterfaceRecord = existing
    ? { ...existing }
    : {
        ifname: ifaceName,
        type: "",
        state: ""
      };

  base.ifname = ifaceName;

  assignStringAttributes(base, attributes, STRING_ATTRIBUTE_MAPPINGS);
  assignNumericAttributes(base, attributes, NUMERIC_ATTRIBUTE_MAPPINGS);
  assignNetemAttributes(base, attributes, NETEM_FIELD_MAPPINGS);

  if (typeof base.type !== "string" || !base.type) {
    base.type = "";
  }
  if (typeof base.state !== "string" || !base.state) {
    base.state = "";
  }

  return base;
}

function assignSnapshotFields(entry: MutableSnapshotEntry, iface: InterfaceRecord): void {
  for (const [entryKey, ifaceKey] of SNAPSHOT_FIELD_MAPPINGS) {
    const value = iface[ifaceKey];
    if (typeof value === "number") {
      entry[entryKey as string] = value;
    }
  }
}

function toInterfaceSnapshotEntry(iface: InterfaceRecord): ClabInterfaceSnapshotEntry {
  const entry: MutableSnapshotEntry = {
    name: iface.ifname,
    type: iface.type || "",
    state: iface.state || "",
    alias: iface.alias ?? "",
    mac: iface.mac ?? "",
    mtu: iface.mtu ?? 0,
    ifindex: iface.ifindex ?? 0,
    netemDelay: iface.netemDelay ?? "",
    netemJitter: iface.netemJitter ?? "",
    netemLoss: iface.netemLoss ?? "",
    netemRate: iface.netemRate ?? "",
    netemCorruption: iface.netemCorruption ?? ""
  };

  assignSnapshotFields(entry, iface);

  return entry;
}

interface NodeSnapshot {
  ipv4?: string;
  ipv4Prefix?: number;
  ipv6?: string;
  ipv6Prefix?: number;
  startedAt?: number;
}

interface LabRecord {
  topoFile?: string;
  containers: Map<string, ClabDetailedJSON>;
}

const INITIAL_IDLE_TIMEOUT_MS = 250;
const INITIAL_FALLBACK_TIMEOUT_MS = 2000;

type DataListener = () => void;
type ContainerStateChangedListener = (
  containerShortId: string,
  newState: string,
  connectionId: string
) => void;
type StreamLostListener = (connectionId: string, error: Error) => void;
type RejectInitialLoad = (error: Error) => void;
const dataListeners = new Set<DataListener>();
const containerStateChangedListeners = new Set<ContainerStateChangedListener>();
const streamLostListeners = new Set<StreamLostListener>();
const DATA_NOTIFY_DELAY_MS = 50;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isContainerlabEvent(value: unknown): value is ContainerlabEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type: unknown = Reflect.get(value, "type");
  const action: unknown = Reflect.get(value, "action");
  const actorId: unknown = Reflect.get(value, "actor_id");
  const actorName: unknown = Reflect.get(value, "actor_name");
  const actorFullId: unknown = Reflect.get(value, "actor_full_id");
  const timestamp: unknown = Reflect.get(value, "timestamp");
  const attributes: unknown = Reflect.get(value, "attributes");

  if (!isString(type) || !isString(action) || !isString(actorId)) {
    return false;
  }
  if (actorName !== undefined && !isString(actorName)) return false;
  if (actorFullId !== undefined && !isString(actorFullId)) return false;
  if (timestamp !== undefined && !isString(timestamp)) return false;
  if (attributes !== undefined && (typeof attributes !== "object" || attributes === null)) {
    return false;
  }
  return true;
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function parseCidr(value?: string): { address?: string; prefixLength?: number } {
  if (value === undefined || value === "") {
    return {};
  }
  const parts = value.split("/");
  if (parts.length === 2) {
    const prefix = Number(parts[1]);
    return {
      address: parts[0],
      prefixLength: Number.isFinite(prefix) ? prefix : undefined
    };
  }
  return { address: value };
}

function resolveLabName(attributes: Record<string, unknown>): string {
  const containerlab = isString(attributes.containerlab) ? attributes.containerlab : "";
  const lab = isString(attributes.lab) ? attributes.lab : "";
  return containerlab || lab || "unknown";
}

function resolveContainerIds(
  event: ContainerlabEvent,
  attributes: Record<string, unknown>
): { id: string; shortId: string } {
  const fullId = isString(attributes.id) ? attributes.id : (event.actor_full_id ?? "");
  const shortFromEvent = event.actor_id || "";
  const shortId = shortFromEvent || (fullId ? fullId.slice(0, 12) : "");
  const id = fullId || shortId;
  return { id, shortId };
}

function resolveNames(
  event: ContainerlabEvent,
  attributes: Record<string, unknown>
): { name: string; nodeName: string } {
  const nameAttr = isString(attributes.name) ? attributes.name : "";
  const longName = isString(attributes["clab-node-longname"])
    ? attributes["clab-node-longname"]
    : "";
  const name = (nameAttr || longName || event.actor_name) ?? "";
  const nodeName = isString(attributes["clab-node-name"]) ? attributes["clab-node-name"] : name;
  return { name, nodeName };
}

function resolveImage(attributes: Record<string, unknown>): string {
  const image = isString(attributes.image) ? attributes.image : "";
  const imageRef = isString(attributes["org.opencontainers.image.ref.name"])
    ? attributes["org.opencontainers.image.ref.name"]
    : "";
  return image || imageRef || "";
}

function buildLabels(
  attributes: Record<string, unknown>,
  labName: string,
  name: string,
  nodeName: string,
  topoFile?: string
): ClabDetailedJSON["Labels"] {
  const labels: ClabDetailedJSON["Labels"] = {
    "clab-node-kind": isString(attributes["clab-node-kind"]) ? attributes["clab-node-kind"] : "",
    "clab-node-lab-dir": isString(attributes["clab-node-lab-dir"])
      ? attributes["clab-node-lab-dir"]
      : "",
    "clab-node-longname": isString(attributes["clab-node-longname"])
      ? attributes["clab-node-longname"]
      : name,
    "clab-node-name": nodeName,
    "clab-owner": isString(attributes["clab-owner"]) ? attributes["clab-owner"] : "",
    "clab-topo-file": topoFile ?? "",
    containerlab: labName
  };

  if (isString(attributes["clab-node-type"])) {
    labels["clab-node-type"] = attributes["clab-node-type"];
  }
  if (isString(attributes["clab-node-group"])) {
    labels["clab-node-group"] = attributes["clab-node-group"];
  }
  if (isString(attributes["clab-root-node-name"])) {
    labels["clab-root-node-name"] = attributes["clab-root-node-name"];
  }
  return labels;
}

function buildNetworkSettings(
  attributes: Record<string, unknown>
): ClabDetailedJSON["NetworkSettings"] {
  const mgmtIpv4 = isString(attributes.mgmt_ipv4) ? attributes.mgmt_ipv4 : undefined;
  const mgmtIpv6 = isString(attributes.mgmt_ipv6) ? attributes.mgmt_ipv6 : undefined;
  const ipv4 = parseCidr(mgmtIpv4);
  const ipv6 = parseCidr(mgmtIpv6);
  return {
    IPv4addr: ipv4.address,
    IPv4pLen: ipv4.prefixLength,
    IPv6addr: ipv6.address,
    IPv6pLen: ipv6.prefixLength
  };
}

function resolveNetworkName(attributes: Record<string, unknown>): string | undefined {
  const network = isString(attributes.network) ? attributes.network : undefined;
  const bridge = isString(attributes["clab-mgmt-net-bridge"])
    ? attributes["clab-mgmt-net-bridge"]
    : undefined;
  return network ?? bridge;
}

// A published port as containerlab events report it: `<host-ip>:<host-port>[/<proto>][-><port>]`,
// where an IPv6 host IP is bracketed.
const PUBLISHED_PORT_PATTERN = /^(?:\[[^\]]*\]|[^:]*):(\d+)(?:\/([a-z]+))?$/i;

/** The host ports a container publishes, from the `ports` event attribute. */
function parsePublishedPorts(value: unknown): ClabDetailedJSON["Ports"] {
  if (!isString(value)) {
    return [];
  }
  const ports: ClabDetailedJSON["Ports"] = [];
  const seen = new Set<string>();
  for (const entry of value.split(";")) {
    const published = entry.trim().split("->")[0] ?? "";
    const match = PUBLISHED_PORT_PATTERN.exec(published);
    if (!match) {
      // Exposed but unpublished ports have no host port to open.
      continue;
    }
    const port = Number(match[1]);
    const protocol = (match[2] ?? "tcp").toLowerCase();
    const key = `${port}/${protocol}`;
    // IPv4 and IPv6 bindings of one host port open the same port.
    if (port <= 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    ports.push({ port, protocol });
  }
  return ports;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toClabDetailed(event: ContainerlabEvent): ContainerRecord | undefined {
  const attributes = event.attributes ?? {};

  const labName = resolveLabName(attributes);
  const topoFile: string | undefined = isString(attributes["clab-topo-file"])
    ? attributes["clab-topo-file"]
    : undefined;
  const { id, shortId } = resolveContainerIds(event, attributes);
  const { name, nodeName } = resolveNames(event, attributes);
  const image = resolveImage(attributes);
  const stateAttr = isString(attributes.state) ? attributes.state : "";
  const state = stateAttr || deriveStateFromAction(event.action);
  const status = isString(attributes.status) ? attributes.status : "";
  const labels = buildLabels(attributes, labName, name, nodeName, topoFile);
  const networkSettings = buildNetworkSettings(attributes);
  const networkName = resolveNetworkName(attributes);

  const detailed: ClabDetailedJSON = {
    Names: name ? [name] : [],
    ID: id,
    ShortID: shortId,
    Image: image,
    State: state,
    Status: status,
    Labels: labels,
    NetworkSettings: networkSettings,
    Mounts: [],
    Ports: parsePublishedPorts(attributes.ports),
    Pid: toOptionalNumber(attributes.pid),
    NetworkName: networkName
  };

  return { labName, topoFile, data: detailed };
}

function deriveStateFromAction(action: string): string {
  switch (action) {
    case "die":
    case "kill":
    case "destroy":
    case "stop":
      return "exited";
    case "pause":
      return "paused";
    case "unpause":
      return "running";
    case "start":
    case "restart":
    case "running":
      return "running";
    case "create":
    case "create: container":
      return "created";
    default:
      return action;
  }
}

function isExecAction(action: string | undefined): boolean {
  if (action === undefined || action === "") {
    return false;
  }
  return action.startsWith("exec");
}

function shouldRemoveContainer(action: string): boolean {
  // Keep containers in the tree when they stop or exit so users can still
  // interact with them until they are actually removed.
  return action === "destroy";
}

function mergeContainerRecord(
  existing: ContainerRecord | undefined,
  incoming: ContainerRecord,
  action: string
): ContainerRecord {
  if (!existing) {
    return incoming;
  }

  return {
    labName: resolveLabNameForMerge(existing, incoming),
    topoFile: resolveTopoFileForMerge(existing, incoming),
    data: mergeContainerData(existing, incoming, action)
  };
}

function resolveLabNameForMerge(existing: ContainerRecord, incoming: ContainerRecord): string {
  if ((incoming.labName === "" || incoming.labName === "unknown") && existing.labName !== "") {
    return existing.labName;
  }
  return incoming.labName;
}

function resolveTopoFileForMerge(
  existing: ContainerRecord,
  incoming: ContainerRecord
): string | undefined {
  return incoming.topoFile ?? existing.topoFile;
}

function mergeContainerData(
  existing: ContainerRecord,
  incoming: ContainerRecord,
  action: string
): ClabDetailedJSON {
  const previousData = existing.data;
  const nextData = incoming.data;

  const mergedNetwork = mergeNetworkSettings(
    previousData.NetworkSettings,
    nextData.NetworkSettings
  );

  const merged: ClabDetailedJSON = {
    ...nextData,
    Labels: { ...previousData.Labels, ...nextData.Labels },
    NetworkSettings: mergedNetwork,
    Status: resolveStatusValue(nextData.Status, previousData.Status, action),
    Image: pickNonEmpty(nextData.Image, previousData.Image),
    State: resolveStateValue(nextData.State, previousData.State, action)
  };

  // Keep the ports of a running container when an event did not resolve them.
  if (nextData.Ports.length === 0 && merged.State === "running") {
    merged.Ports = previousData.Ports;
  }

  if (nextData.StartedAt !== undefined || previousData.StartedAt !== undefined) {
    merged.StartedAt = nextData.StartedAt ?? previousData.StartedAt;
  }

  if (
    (merged.NetworkName === undefined || merged.NetworkName === "") &&
    previousData.NetworkName !== undefined &&
    previousData.NetworkName !== ""
  ) {
    merged.NetworkName = previousData.NetworkName;
  }

  return merged;
}

function mergeNetworkSettings(
  previous: ClabDetailedJSON["NetworkSettings"],
  next: ClabDetailedJSON["NetworkSettings"]
): ClabDetailedJSON["NetworkSettings"] {
  const merged = { ...next };

  if (
    (merged.IPv4addr === undefined || merged.IPv4addr === "") &&
    previous.IPv4addr !== undefined &&
    previous.IPv4addr !== ""
  ) {
    merged.IPv4addr = previous.IPv4addr;
    merged.IPv4pLen = previous.IPv4pLen;
  }
  if (
    (merged.IPv6addr === undefined || merged.IPv6addr === "") &&
    previous.IPv6addr !== undefined &&
    previous.IPv6addr !== ""
  ) {
    merged.IPv6addr = previous.IPv6addr;
    merged.IPv6pLen = previous.IPv6pLen;
  }

  return merged;
}

/**
 * Extract healthcheck suffix from health_status action.
 * Actions like "health_status: healthy" -> "(healthy)"
 */
function extractHealthSuffix(action: string): string | undefined {
  if (!action.startsWith("health_status:")) {
    return undefined;
  }
  const status = action.slice("health_status:".length).trim();
  if (status === "") {
    return undefined;
  }
  // Map to display format
  if (status === "healthy") return "(healthy)";
  if (status === "unhealthy") return "(unhealthy)";
  return `(health: ${status})`; // e.g., "(health: starting)"
}

/**
 * Update status string with new healthcheck suffix.
 * Replaces any existing healthcheck suffix or appends if none.
 */
function updateStatusWithHealthSuffix(status: string, healthSuffix: string): string {
  if (status === "") {
    return status;
  }
  // Remove any existing healthcheck suffix
  const trimmed = status.trim();
  const openIdx = trimmed.lastIndexOf("(");
  if (openIdx !== -1 && trimmed.endsWith(")")) {
    const baseStatus = trimmed.slice(0, openIdx).trimEnd();
    return `${baseStatus} ${healthSuffix}`;
  }
  // No existing suffix, append new one
  return `${trimmed} ${healthSuffix}`;
}

function resolveStatusValue(current: string, fallback: string | undefined, action: string): string {
  // For termination events (stop/die/kill), reset status - don't preserve old "Up X" for stopped containers
  if (action === "stop" || action === "die" || action === "kill") {
    return current;
  }

  // For health_status events, update the status with healthcheck suffix
  const healthSuffix = extractHealthSuffix(action);
  if (healthSuffix !== undefined && fallback !== undefined && fallback !== "") {
    return updateStatusWithHealthSuffix(fallback, healthSuffix);
  }

  // For other events (including "running"), preserve status if current is empty
  // This ensures healthcheck suffix like "(healthy)" is not lost when events have empty status
  return pickNonEmpty(current, fallback);
}

function shouldResetLifecycleStatus(action: string): boolean {
  switch (action) {
    case "create":
    case "start":
    case "running":
    case "restart":
    case "pause":
    case "unpause":
    case "stop":
    case "kill":
    case "die":
      return true;
    default:
      return false;
  }
}

function pickNonEmpty(current: string, fallback?: string): string {
  if (current.trim().length > 0) {
    return current;
  }
  return fallback ?? current;
}

function resolveStateValue(current: string, fallback: string | undefined, action: string): string {
  if ((current === "" || current === action) && fallback !== undefined && fallback !== "") {
    return fallback;
  }
  return current;
}

function makeNodeSnapshotKey(record: ContainerRecord): string | undefined {
  const labels = record.data.Labels;
  const nodeName = labels["clab-node-name"] || labels["clab-node-longname"] || record.data.Names[0];
  if (nodeName === "") {
    return undefined;
  }
  const labCandidate = pickNonEmpty(record.labName, labels.containerlab);
  const lab = labCandidate === "" ? "unknown" : labCandidate;
  return `${lab}::${nodeName}`.toLowerCase();
}

function estimateStartedAtFromStatus(
  status: string | undefined,
  eventTimestamp?: number
): number | undefined {
  if (status === undefined || status === "") {
    return undefined;
  }

  const trimmed = status.trim();
  if (!trimmed.toLowerCase().startsWith("up ")) {
    return undefined;
  }

  let withoutSuffix = trimmed;
  const lastOpen = trimmed.lastIndexOf("(");
  const hasClosing = trimmed.endsWith(")");
  if (lastOpen !== -1 && hasClosing) {
    withoutSuffix = trimmed.slice(0, lastOpen).trimEnd();
  }

  const durationText = withoutSuffix.slice(2).trim();

  const tokens = durationText.split(" ").filter(Boolean);
  let totalSeconds = 0;
  let matched = false;

  let index = 0;
  while (index < tokens.length - 1) {
    const value = Number(tokens[index]);
    if (!Number.isFinite(value)) {
      index += 1;
      continue;
    }
    const unitToken = tokens[index + 1];
    if (!unitToken) {
      break;
    }
    const unitSeconds = toDurationSeconds(unitToken);
    if (unitSeconds === 0) {
      index += 1;
      continue;
    }
    totalSeconds += value * unitSeconds;
    matched = true;
    index += 2;
  }

  if (!matched || totalSeconds <= 0) {
    return undefined;
  }

  const reference = eventTimestamp ?? Date.now();
  const estimated = reference - totalSeconds * 1000;
  return estimated > 0 ? estimated : 0;
}

function toDurationSeconds(unit: string): number {
  let normalized = unit.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.endsWith("s")) {
    normalized = normalized.slice(0, -1);
  }
  switch (normalized) {
    case "second":
    case "sec":
      return 1;
    case "minute":
    case "min":
      return 60;
    case "hour":
    case "hr":
      return 3600;
    case "day":
      return 86400;
    case "week":
    case "wk":
      return 7 * 86400;
    case "month":
    case "mo":
      // Docker status uses humanized durations; treat month/year as coarse units.
      return 30 * 86400;
    case "year":
    case "yr":
      return 365 * 86400;
    default:
      return 0;
  }
}

function parseEventTimestamp(timestamp?: string): number | undefined {
  if (timestamp === undefined || timestamp === "") {
    return undefined;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function resolveStartTimestamp(eventTimestamp?: number, current?: number): number {
  if (typeof eventTimestamp === "number" && !Number.isNaN(eventTimestamp)) {
    return eventTimestamp;
  }
  if (typeof current === "number" && !Number.isNaN(current)) {
    return current;
  }
  return Date.now();
}

function hasNonEmptyStatus(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function formatStateLabel(state: string | undefined): string {
  if (state === undefined || state === "") {
    return "Unknown";
  }
  const normalized = state.replace(/[_-]+/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function shouldMarkInterfacesDown(state: string | undefined): boolean {
  if (state === undefined || state === "") {
    return true;
  }

  const normalized = state.toLowerCase();
  return normalized !== "running" && normalized !== "paused";
}

function removeInterfaceRecordsWithSameIndex(
  ifaceMap: Map<string, InterfaceRecord>,
  incomingName: string,
  incomingIfindex: number | undefined
): boolean {
  if (incomingIfindex === undefined) {
    return false;
  }

  let removed = false;
  for (const [existingName, existingRecord] of ifaceMap.entries()) {
    if (existingName === incomingName) {
      continue;
    }
    if (existingRecord.ifindex === incomingIfindex) {
      ifaceMap.delete(existingName);
      removed = true;
    }
  }

  return removed;
}

/**
 * The labs of one connection, kept current from its `containerlab events`
 * stream: containers, interfaces and their statistics.
 */
export class LabEventStream {
  private currentStreamKey: string | undefined;
  private receivedInitialEvent = false;
  private streamController: AbortController | null = null;
  private initialLoadComplete = false;
  private initialLoadPromise: Promise<void> | null = null;
  private resolveInitialLoad: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private rejectInitialLoad: RejectInitialLoad | null = null;
  private readonly containersById = new Map<string, ContainerRecord>();
  private readonly labsByName = new Map<string, LabRecord>();
  private readonly interfacesByContainer = new Map<string, Map<string, InterfaceRecord>>();
  private readonly interfaceVersions = new Map<string, number>();
  private readonly nodeSnapshots = new Map<string, NodeSnapshot>();
  private dataChangedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly connectionId: string) {}

  private applyContainerEvent(event: ContainerlabEvent): void {
    const action = event.action;

    if (isExecAction(action)) {
      return;
    }

    if (shouldRemoveContainer(action)) {
      this.removeContainer(event.actor_id);
      this.scheduleInitialResolution();
      return;
    }

    const record = toClabDetailed(event);
    if (!record) {
      return;
    }

    const eventTimestamp = parseEventTimestamp(event.timestamp);
    const existing = this.containersById.get(record.data.ShortID);
    const oldState = existing?.data.State;
    const mergedRecord = mergeContainerRecord(existing, record, action);
    this.updateNodeSnapshot(mergedRecord, eventTimestamp, action);
    const enrichedRecord = this.applyNodeSnapshot(mergedRecord);
    const newState = enrichedRecord.data.State;

    this.containersById.set(enrichedRecord.data.ShortID, enrichedRecord);
    this.updateLabMappings(existing, enrichedRecord);

    if (oldState !== undefined && oldState !== "" && oldState !== newState) {
      this.notifyContainerStateChanged(enrichedRecord.data.ShortID, newState);
    }

    if (shouldMarkInterfacesDown(enrichedRecord.data.State)) {
      if (this.markInterfacesDown(enrichedRecord.data.ShortID)) {
        this.scheduleInitialResolution();
        this.scheduleDataChanged();
        return;
      }
    }

    this.scheduleInitialResolution();
    this.scheduleDataChanged();
  }

  private applyInterfaceEvent(event: ContainerlabEvent): void {
    const attributes = event.attributes ?? {};
    const containerId = event.actor_id;
    if (!containerId) {
      return;
    }

    const ifaceName = attributes.ifname;
    if (typeof ifaceName !== "string" || ifaceName === "") {
      return;
    }

    if (event.action === "delete") {
      if (this.removeInterfaceRecord(containerId, ifaceName)) {
        this.bumpInterfaceVersion(containerId);
        this.scheduleInitialResolution();
        this.scheduleDataChanged();
      }
      return;
    }

    // allow the veth-stitch interfaces to live
    if (ifaceName.startsWith("clab-") && !ifaceName.startsWith("clab-s-")) {
      this.removeInterfaceRecord(containerId, ifaceName);
      return;
    }

    let ifaceMap = this.interfacesByContainer.get(containerId);
    if (!ifaceMap) {
      ifaceMap = new Map();
      this.interfacesByContainer.set(containerId, ifaceMap);
    }
    const existing = ifaceMap.get(ifaceName);
    const updated = buildUpdatedInterfaceRecord(ifaceName, attributes, existing);
    const removedRenamedEntries = removeInterfaceRecordsWithSameIndex(
      ifaceMap,
      ifaceName,
      updated.ifindex
    );

    const changed = removedRenamedEntries || !interfaceRecordsEqual(existing, updated);

    // Check if this event contains traffic stats - we always want to notify
    // for stats updates to ensure real-time traffic monitoring works
    const hasStats = attributes.rx_bps !== undefined || attributes.tx_bps !== undefined;

    // No changes and no stats - nothing to do
    if (!changed && !hasStats) {
      return;
    }

    // Always update the record if we have new data
    ifaceMap.set(ifaceName, updated);

    // For structural changes, bump version
    if (changed) {
      this.bumpInterfaceVersion(containerId);
    }

    // Always notify for stats updates (real-time traffic monitoring)
    // or when structural data changed
    this.scheduleInitialResolution();
    this.scheduleDataChanged();
  }

  private applyNodeSnapshot(record: ContainerRecord): ContainerRecord {
    const key = makeNodeSnapshotKey(record);
    if (key === undefined || key === "") {
      return record;
    }
    const snapshot = this.nodeSnapshots.get(key);
    if (!snapshot) {
      return record;
    }

    const settings = record.data.NetworkSettings;
    if (
      (settings.IPv4addr === undefined || settings.IPv4addr === "") &&
      snapshot.ipv4 !== undefined &&
      snapshot.ipv4 !== ""
    ) {
      settings.IPv4addr = snapshot.ipv4;
      settings.IPv4pLen = snapshot.ipv4Prefix;
    }
    if (
      (settings.IPv6addr === undefined || settings.IPv6addr === "") &&
      snapshot.ipv6 !== undefined &&
      snapshot.ipv6 !== ""
    ) {
      settings.IPv6addr = snapshot.ipv6;
      settings.IPv6pLen = snapshot.ipv6Prefix;
    }

    if (record.data.State === "running") {
      record.data.StartedAt = snapshot.startedAt;
      if (!hasNonEmptyStatus(record.data.Status)) {
        record.data.Status = "Running";
      }
    } else {
      record.data.StartedAt = undefined;
      if (!hasNonEmptyStatus(record.data.Status)) {
        record.data.Status = formatStateLabel(record.data.State);
      }
    }

    return record;
  }

  private bumpInterfaceVersion(containerId: string): void {
    const next = (this.interfaceVersions.get(containerId) ?? 0) + 1;
    this.interfaceVersions.set(containerId, next);
  }

  private clearNodeSnapshot(record: ContainerRecord): void {
    const key = makeNodeSnapshotKey(record);
    if (key === undefined || key === "") {
      return;
    }
    this.nodeSnapshots.delete(key);
  }

  /**
   * Starts streaming lab events from the backend, or keeps the running stream
   * when `streamKey` (backend and runtime) is unchanged.
   */
  async ensure(backend: LabBackend, streamKey: string): Promise<void> {
    if (this.streamController !== null && this.currentStreamKey === streamKey) {
      if (this.initialLoadComplete) {
        return;
      }
      if (this.initialLoadPromise) {
        return this.initialLoadPromise;
      }
    }

    this.stopProcess();
    this.reset();
    this.startProcess(backend, streamKey);

    if (!this.initialLoadPromise) {
      throw new Error("Failed to initialize containerlab events stream");
    }
    return this.initialLoadPromise;
  }

  private finalizeInitialLoad(error?: Error): void {
    if (this.initialLoadComplete) {
      return;
    }

    this.initialLoadComplete = true;

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }

    if (error) {
      if (this.rejectInitialLoad) {
        this.rejectInitialLoad(error);
      }
      return;
    }

    if (this.resolveInitialLoad) {
      this.resolveInitialLoad();
    }
  }

  getGroupedContainers(): Record<string, ClabDetailedJSON[]> {
    const result: Record<string, ClabDetailedJSON[]> = {};

    for (const [labName, lab] of this.labsByName.entries()) {
      const containers = Array.from(lab.containers.values()).map((container) => ({
        ...container,
        Names: [...container.Names],
        Labels: { ...container.Labels },
        NetworkSettings: { ...container.NetworkSettings },
        Mounts: container.Mounts.map((mount) => ({ ...mount })),
        Ports: container.Ports.map((port) => ({ ...port }))
      }));

      if (isNonEmptyString(lab.topoFile)) {
        Reflect.set(containers, "topo-file", lab.topoFile);
      }
      result[labName] = containers;
    }

    return result;
  }

  getInterfaceSnapshot(containerShortId: string, containerName: string): ClabInterfaceSnapshot[] {
    const ifaceMap = this.interfacesByContainer.get(containerShortId);
    if (!ifaceMap || ifaceMap.size === 0) {
      return [];
    }

    const interfaces = Array.from(ifaceMap.values()).map(toInterfaceSnapshotEntry);

    interfaces.sort((a, b) => a.name.localeCompare(b.name));

    return [
      {
        name: containerName,
        interfaces
      }
    ];
  }

  private handleEvent(parsed: unknown): void {
    if (!isContainerlabEvent(parsed)) {
      return;
    }
    if (parsed.type === "container") {
      this.applyContainerEvent(parsed);
    } else if (parsed.type === "interface") {
      this.applyInterfaceEvent(parsed);
    }
  }

  handleEventLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      this.handleEvent(JSON.parse(trimmed));
    } catch (err) {
      console.error(
        `[containerlabEvents]: Failed to parse event line: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private markInterfacesDown(containerId: string): boolean {
    const ifaceMap = this.interfacesByContainer.get(containerId);
    if (!ifaceMap || ifaceMap.size === 0) {
      return false;
    }

    // When a container goes down, clear all interfaces
    this.interfacesByContainer.delete(containerId);
    this.bumpInterfaceVersion(containerId);

    return true;
  }

  private notifyContainerStateChanged(containerShortId: string, newState: string): void {
    if (containerStateChangedListeners.size === 0) {
      return;
    }
    for (const listener of Array.from(containerStateChangedListeners)) {
      try {
        listener(containerShortId, newState, this.connectionId);
      } catch (err) {
        console.error(
          `[containerlabEvents]: Failed to notify state change listener: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  private removeContainer(containerShortId: string): void {
    const record = this.containersById.get(containerShortId);
    if (!record) {
      return;
    }

    const lab = this.labsByName.get(record.labName);
    if (lab) {
      lab.containers.delete(containerShortId);
      if (lab.containers.size === 0) {
        this.labsByName.delete(record.labName);
      }
    }

    this.clearNodeSnapshot(record);
    this.containersById.delete(containerShortId);
    this.interfacesByContainer.delete(containerShortId);
    this.interfaceVersions.delete(containerShortId);
    this.scheduleDataChanged();
  }

  private removeInterfaceRecord(containerId: string, ifaceName: string): boolean {
    const ifaceMap = this.interfacesByContainer.get(containerId);
    if (!ifaceMap) {
      return false;
    }

    const removed = ifaceMap.delete(ifaceName);
    if (ifaceMap.size === 0) {
      this.interfacesByContainer.delete(containerId);
    }
    return removed;
  }

  /** Forgets every lab, e.g. before streaming from another backend. */
  reset(): void {
    this.containersById.clear();
    this.labsByName.clear();
    this.interfacesByContainer.clear();
    this.interfaceVersions.clear();
    this.nodeSnapshots.clear();
    this.scheduleDataChanged();
  }

  private scheduleDataChanged(): void {
    if (dataListeners.size === 0) {
      return;
    }
    if (this.dataChangedTimer) {
      return;
    }
    this.dataChangedTimer = setTimeout(() => {
      this.dataChangedTimer = null;
      for (const listener of Array.from(dataListeners)) {
        try {
          listener();
        } catch (err) {
          console.error(
            `[containerlabEvents]: Failed to notify listener: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }, DATA_NOTIFY_DELAY_MS);
  }

  private scheduleInitialResolution(): void {
    if (this.initialLoadComplete) {
      return;
    }

    // Once we receive the first event, cancel the fallback timer.
    // We'll rely on the idle timer to finalize after events stop arriving.
    if (!this.receivedInitialEvent) {
      this.receivedInitialEvent = true;
      if (this.fallbackTimer) {
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }
    }

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => this.finalizeInitialLoad(), INITIAL_IDLE_TIMEOUT_MS);
  }

  private startProcess(backend: LabBackend, streamKey: string): void {
    this.currentStreamKey = streamKey;
    this.initialLoadComplete = false;

    this.initialLoadPromise = new Promise<void>((resolve, reject) => {
      this.resolveInitialLoad = resolve;
      this.rejectInitialLoad = reject;
    });

    const config = vscode.workspace.getConfiguration("containerlab");
    const enableInterfaceStats = config.get<boolean>("enableInterfaceStats", true);

    const controller = new AbortController();
    this.streamController = controller;
    void (async () => {
      try {
        const events = await backend.events(
          {
            initialState: true,
            ...(enableInterfaceStats ? { interfaceStats: true, interfaceStatsInterval: "1s" } : {})
          },
          controller.signal
        );
        for await (const event of events) {
          if (controller.signal.aborted) {
            break;
          }
          try {
            this.handleEvent(event);
          } catch (err) {
            console.error(
              `[containerlabEvents]: Failed to apply event: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        if (!controller.signal.aborted) {
          this.endStream(new Error("containerlab events ended prematurely"));
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          this.endStream(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (this.streamController === controller) {
          this.stopProcess();
        }
      }
    })();

    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
    }
    this.fallbackTimer = setTimeout(() => this.finalizeInitialLoad(), INITIAL_FALLBACK_TIMEOUT_MS);
  }

  /**
   * The stream stopped on its own: before the first load the load fails,
   * after it the labs are stale and the listeners hear about it.
   */
  private endStream(error: Error): void {
    if (!this.initialLoadComplete) {
      this.finalizeInitialLoad(error);
      return;
    }
    for (const listener of Array.from(streamLostListeners)) {
      listener(this.connectionId, error);
    }
  }

  stop(): void {
    this.stopProcess();
  }

  private stopProcess(): void {
    if (this.streamController) {
      this.streamController.abort();
      this.streamController = null;
    }

    this.initialLoadComplete = false;
    this.initialLoadPromise = null;
    this.resolveInitialLoad = null;
    this.rejectInitialLoad = null;
    this.receivedInitialEvent = false;

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private updateLabMappings(previous: ContainerRecord | undefined, next: ContainerRecord): void {
    if (previous && previous.labName !== next.labName) {
      const previousLab = this.labsByName.get(previous.labName);
      if (previousLab) {
        previousLab.containers.delete(next.data.ShortID);
        if (previousLab.containers.size === 0) {
          this.labsByName.delete(previous.labName);
        }
      }
    }

    let lab = this.labsByName.get(next.labName);
    if (!lab) {
      lab = { topoFile: next.topoFile, containers: new Map() };
      this.labsByName.set(next.labName, lab);
    }
    if (isNonEmptyString(next.topoFile)) {
      lab.topoFile = next.topoFile;
    }
    lab.containers.set(next.data.ShortID, next.data);
  }

  private updateNodeSnapshot(
    record: ContainerRecord,
    eventTimestamp?: number,
    action?: string
  ): void {
    const key = makeNodeSnapshotKey(record);
    if (key === undefined || key === "") {
      return;
    }

    const settings = record.data.NetworkSettings;
    const snapshot = this.nodeSnapshots.get(key) ?? {};

    if (settings.IPv4addr !== undefined && settings.IPv4addr !== "") {
      snapshot.ipv4 = settings.IPv4addr;
      snapshot.ipv4Prefix = settings.IPv4pLen;
    }

    if (settings.IPv6addr !== undefined && settings.IPv6addr !== "") {
      snapshot.ipv6 = settings.IPv6addr;
      snapshot.ipv6Prefix = settings.IPv6pLen;
    }

    if (record.data.State === "running") {
      const estimatedStart = estimateStartedAtFromStatus(record.data.Status, eventTimestamp);
      if (estimatedStart !== undefined) {
        snapshot.startedAt = estimatedStart;
      } else if (shouldResetLifecycleStatus(action ?? "") || snapshot.startedAt === undefined) {
        snapshot.startedAt = resolveStartTimestamp(eventTimestamp, snapshot.startedAt);
      }
    } else {
      snapshot.startedAt = undefined;
    }

    this.nodeSnapshots.set(key, snapshot);
  }
}

const streams = new Map<string, LabEventStream>();

/** The event stream of a connection; it starts with `ensure`. */
export function eventStreamFor(connectionId: string): LabEventStream {
  let stream = streams.get(connectionId);
  if (!stream) {
    stream = new LabEventStream(connectionId);
    streams.set(connectionId, stream);
  }
  return stream;
}

/** Stops the event stream of a connection and forgets its labs; all streams without an id. */
export function stopEventStreams(connectionId?: string): void {
  for (const [id, stream] of streams) {
    if (connectionId !== undefined && id !== connectionId) continue;
    stream.stop();
    stream.reset();
    streams.delete(id);
  }
}

export function resetForTests(): void {
  stopEventStreams();
}

export function handleEventLineForTests(line: string, connectionId = "local"): void {
  eventStreamFor(connectionId).handleEventLine(line);
}

export function estimateStartedAtFromStatusForTests(
  status: string | undefined,
  eventTimestamp?: number
): number | undefined {
  return estimateStartedAtFromStatus(status, eventTimestamp);
}

export function onDataChanged(listener: DataListener): () => void {
  dataListeners.add(listener);
  return () => {
    dataListeners.delete(listener);
  };
}

/** Fires when a running event stream stops, e.g. because the lab host went away. */
export function onStreamLost(listener: StreamLostListener): () => void {
  streamLostListeners.add(listener);
  return () => {
    streamLostListeners.delete(listener);
  };
}

export function onContainerStateChanged(listener: ContainerStateChangedListener): () => void {
  containerStateChangedListeners.add(listener);
  return () => {
    containerStateChangedListeners.delete(listener);
  };
}
