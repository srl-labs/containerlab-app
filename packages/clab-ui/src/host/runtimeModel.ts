import type {
  HostRuntimeContainer,
  HostRuntimeInterface,
  HostRuntimeInterfaceStats,
  HostRuntimeNetemState
} from "./contracts";

type NumericInput = number | string | undefined;

/** Loosely typed interface data as hosts receive it: numbers may arrive as strings. */
export interface RuntimeInterfaceInput {
  name?: string;
  alias?: string;
  label?: string;
  mac?: string;
  mtu?: NumericInput;
  state?: string;
  type?: string;
  ifIndex?: NumericInput;
  stats?: { [Key in keyof HostRuntimeInterfaceStats]?: NumericInput };
  netemState?: HostRuntimeNetemState;
}

/** Loosely typed container data as hosts receive it. */
export interface RuntimeContainerInput {
  name?: string;
  nodeName?: string;
  labName?: string;
  state?: string;
  kind?: string;
  image?: string;
  ipv4Address?: string;
  ipv6Address?: string;
  interfaces?: RuntimeInterfaceInput[];
}

export interface RuntimeContainerCompareOptions {
  includeInterfaceStats?: boolean;
}

const STATS_KEYS = [
  "rxBps",
  "txBps",
  "rxPps",
  "txPps",
  "rxBytes",
  "txBytes",
  "rxPackets",
  "txPackets",
  "statsIntervalSeconds"
] as const satisfies ReadonlyArray<keyof HostRuntimeInterfaceStats>;

const NETEM_KEYS = [
  "delay",
  "jitter",
  "loss",
  "rate",
  "corruption"
] as const satisfies ReadonlyArray<keyof HostRuntimeNetemState>;

export function toFiniteNumber(value: NumericInput): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeStats(
  stats: RuntimeInterfaceInput["stats"]
): HostRuntimeInterfaceStats | undefined {
  if (!stats) {
    return undefined;
  }
  const normalized: HostRuntimeInterfaceStats = {};
  for (const key of STATS_KEYS) {
    const value = toFiniteNumber(stats[key]);
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeNetemState(
  netem: HostRuntimeNetemState | undefined
): HostRuntimeNetemState | undefined {
  if (!netem) {
    return undefined;
  }
  const normalized: HostRuntimeNetemState = {};
  for (const key of NETEM_KEYS) {
    if (netem[key] !== undefined) {
      normalized[key] = netem[key];
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeRuntimeInterface(input: RuntimeInterfaceInput): HostRuntimeInterface {
  return {
    name: input.name ?? "",
    alias: input.alias ?? "",
    label: input.label,
    mac: input.mac ?? "",
    mtu: toFiniteNumber(input.mtu) ?? 0,
    state: input.state ?? "",
    type: input.type ?? "",
    ifIndex: toFiniteNumber(input.ifIndex),
    stats: normalizeStats(input.stats),
    netemState: normalizeNetemState(input.netemState)
  };
}

function compareByName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name);
}

/** Normalizes one container; its interfaces come back sorted by name. */
export function normalizeRuntimeContainer(input: RuntimeContainerInput): HostRuntimeContainer {
  return {
    name: input.name ?? "",
    nodeName: input.nodeName ?? "",
    labName: input.labName ?? "",
    state: input.state ?? "",
    kind: input.kind ?? "",
    image: input.image ?? "",
    ipv4Address: input.ipv4Address ?? "",
    ipv6Address: input.ipv6Address ?? "",
    interfaces: (input.interfaces ?? []).map(normalizeRuntimeInterface).sort(compareByName)
  };
}

export function sortRuntimeContainers(containers: HostRuntimeContainer[]): HostRuntimeContainer[] {
  return [...containers].sort(compareByName);
}

function runtimeInterfaceStatsEqual(
  previous: HostRuntimeInterfaceStats | undefined,
  next: HostRuntimeInterfaceStats | undefined
): boolean {
  return STATS_KEYS.every((key) => previous?.[key] === next?.[key]);
}

function runtimeInterfaceNetemEqual(
  previous: HostRuntimeNetemState | undefined,
  next: HostRuntimeNetemState | undefined
): boolean {
  return NETEM_KEYS.every((key) => previous?.[key] === next?.[key]);
}

function runtimeContainerMetadataEqual(
  previous: HostRuntimeContainer,
  next: HostRuntimeContainer
): boolean {
  return (
    previous.nodeName === next.nodeName &&
    previous.labName === next.labName &&
    previous.state === next.state &&
    previous.kind === next.kind &&
    previous.image === next.image &&
    previous.ipv4Address === next.ipv4Address &&
    previous.ipv6Address === next.ipv6Address
  );
}

function sortedRuntimeInterfaces(container: HostRuntimeContainer): HostRuntimeInterface[] {
  return [...(container.interfaces ?? [])].sort(compareByName);
}

function runtimeInterfaceEqual(
  previous: HostRuntimeInterface,
  next: HostRuntimeInterface,
  includeStats: boolean
): boolean {
  const metadataEqual =
    previous.name === next.name &&
    previous.alias === next.alias &&
    previous.label === next.label &&
    previous.state === next.state &&
    previous.type === next.type &&
    previous.mac === next.mac &&
    previous.mtu === next.mtu &&
    previous.ifIndex === next.ifIndex &&
    runtimeInterfaceNetemEqual(previous.netemState, next.netemState);
  return metadataEqual && (!includeStats || runtimeInterfaceStatsEqual(previous.stats, next.stats));
}

function runtimeInterfacesEqual(
  previous: HostRuntimeContainer,
  next: HostRuntimeContainer,
  includeStats: boolean
): boolean {
  const previousInterfaces = sortedRuntimeInterfaces(previous);
  const nextInterfaces = sortedRuntimeInterfaces(next);
  if (previousInterfaces.length !== nextInterfaces.length) {
    return false;
  }

  return previousInterfaces.every((previousInterface, index) =>
    runtimeInterfaceEqual(previousInterface, nextInterfaces[index], includeStats)
  );
}

export function runtimeContainersEqual(
  previous: HostRuntimeContainer[],
  next: HostRuntimeContainer[],
  options: RuntimeContainerCompareOptions = {}
): boolean {
  const includeInterfaceStats = options.includeInterfaceStats ?? true;

  if (previous.length !== next.length) {
    return false;
  }

  const byName = new Map(next.map((container) => [container.name, container]));
  for (const container of previous) {
    const candidate = byName.get(container.name);
    if (!candidate || !runtimeContainerMetadataEqual(container, candidate)) {
      return false;
    }
    if (!runtimeInterfacesEqual(container, candidate, includeInterfaceStats)) {
      return false;
    }
  }

  return true;
}

/** Compares everything that shapes the topology but ignores live interface counters. */
export function runtimeContainersTopologyEqual(
  previous: HostRuntimeContainer[],
  next: HostRuntimeContainer[]
): boolean {
  return runtimeContainersEqual(previous, next, { includeInterfaceStats: false });
}
