import type {
  HostRuntimeContainer,
  HostRuntimeInterface,
  HostRuntimeInterfaceStats,
  HostRuntimeNetemState
} from "@srl-labs/clab-ui/host";
import type { TopologyRef } from "@srl-labs/clab-ui/session";
import type { InterfaceState, LabState } from "./stores/labStore";
import { findLabStateForTopology } from "./standaloneHostShared";

function findLabState(
  labName: string | undefined,
  labs: Map<string, LabState>
): LabState | undefined {
  if (!labName || labName.trim().length === 0) {
    return undefined;
  }

  const target = labName.trim().toLowerCase();
  for (const lab of labs.values()) {
    if (lab.name.trim().toLowerCase() === target) {
      return lab;
    }
  }
  return undefined;
}

function getRuntimeContainers(lab: LabState | undefined): HostRuntimeContainer[] {
  if (!lab) {
    return [];
  }

  return [...lab.containers.values()].map((container) => {
    const interfaces = [...container.interfaces.values()]
      .map((iface) => toRuntimeInterface(iface))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      name: container.name,
      nodeName: container.nodeName,
      labName: container.labName,
      state: container.state,
      kind: container.kind,
      image: container.image,
      ipv4Address: container.ipv4Address,
      ipv6Address: container.ipv6Address,
      interfaces
    };
  });
}

function toFiniteNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toRuntimeInterfaceStats(iface: InterfaceState): HostRuntimeInterfaceStats | undefined {
  const stats: HostRuntimeInterfaceStats = {};
  const assign = (key: keyof HostRuntimeInterfaceStats, value: string | number | undefined): void => {
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined) {
      stats[key] = parsed;
    }
  };

  assign("rxBps", iface.rxBps);
  assign("txBps", iface.txBps);
  assign("rxPps", iface.rxPps);
  assign("txPps", iface.txPps);
  assign("rxBytes", iface.rxBytes);
  assign("txBytes", iface.txBytes);
  assign("rxPackets", iface.rxPackets);
  assign("txPackets", iface.txPackets);
  assign("statsIntervalSeconds", iface.statsIntervalSeconds);

  return Object.keys(stats).length > 0 ? stats : undefined;
}

function toRuntimeInterface(iface: InterfaceState): HostRuntimeInterface {
  return {
    name: iface.name,
    alias: iface.alias,
    label: iface.label,
    mac: iface.mac,
    mtu: toFiniteNumber(iface.mtu) ?? 0,
    state: iface.state,
    type: iface.type,
    ifIndex: toFiniteNumber(iface.ifIndex),
    stats: toRuntimeInterfaceStats(iface),
    netemState: toRuntimeInterfaceNetemState(iface)
  };
}

function toRuntimeInterfaceNetemState(iface: InterfaceState): HostRuntimeNetemState | undefined {
  const netemState: HostRuntimeNetemState = {};
  if (iface.netemDelay !== undefined) netemState.delay = iface.netemDelay;
  if (iface.netemJitter !== undefined) netemState.jitter = iface.netemJitter;
  if (iface.netemLoss !== undefined) netemState.loss = iface.netemLoss;
  if (iface.netemRate !== undefined) netemState.rate = iface.netemRate;
  if (iface.netemCorruption !== undefined) netemState.corruption = iface.netemCorruption;
  return Object.keys(netemState).length > 0 ? netemState : undefined;
}

function runtimeInterfaceStatsEqual(
  previous: HostRuntimeInterfaceStats | undefined,
  next: HostRuntimeInterfaceStats | undefined
): boolean {
  const keys: Array<keyof HostRuntimeInterfaceStats> = [
    "rxBps",
    "txBps",
    "rxPps",
    "txPps",
    "rxBytes",
    "txBytes",
    "rxPackets",
    "txPackets",
    "statsIntervalSeconds"
  ];

  for (const key of keys) {
    if (previous?.[key] !== next?.[key]) {
      return false;
    }
  }

  return true;
}

function runtimeInterfaceNetemEqual(
  previous: HostRuntimeNetemState | undefined,
  next: HostRuntimeNetemState | undefined
): boolean {
  return (
    previous?.delay === next?.delay &&
    previous?.jitter === next?.jitter &&
    previous?.loss === next?.loss &&
    previous?.rate === next?.rate &&
    previous?.corruption === next?.corruption
  );
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
  return [...(container.interfaces ?? [])].sort((a, b) => a.name.localeCompare(b.name));
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
  const prevInterfaces = sortedRuntimeInterfaces(previous);
  const nextInterfaces = sortedRuntimeInterfaces(next);
  if (prevInterfaces.length !== nextInterfaces.length) {
    return false;
  }

  return prevInterfaces.every((prevIface, index) =>
    runtimeInterfaceEqual(prevIface, nextInterfaces[index], includeStats)
  );
}

export function getRuntimeContainersForLab(
  labName: string | undefined,
  labs: Map<string, LabState>
): HostRuntimeContainer[] {
  return getRuntimeContainers(findLabState(labName, labs));
}

export function getRuntimeContainersForTopology(
  topologyRef: (
    Pick<TopologyRef, "yamlPath"> &
    Partial<Pick<TopologyRef, "labName" | "topologyId">>
  ) | undefined,
  labs: Map<string, LabState>
): HostRuntimeContainer[] {
  return getRuntimeContainers(findLabStateForTopology(topologyRef, labs));
}

export interface RuntimeContainerCompareOptions {
  includeInterfaceStats?: boolean;
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
