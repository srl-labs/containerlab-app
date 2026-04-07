import type {
  HostRuntimeContainer,
  HostRuntimeInterface,
  HostRuntimeInterfaceStats
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
    mac: iface.mac,
    mtu: toFiniteNumber(iface.mtu) ?? 0,
    state: iface.state,
    type: iface.type,
    ifIndex: toFiniteNumber(iface.ifIndex),
    stats: toRuntimeInterfaceStats(iface)
  };
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

export function runtimeContainersEqual(
  previous: HostRuntimeContainer[],
  next: HostRuntimeContainer[]
): boolean {
  if (previous.length !== next.length) {
    return false;
  }

  const byName = new Map(next.map((container) => [container.name, container]));
  for (const container of previous) {
    const candidate = byName.get(container.name);
    if (!candidate) {
      return false;
    }
    if (
      candidate.nodeName !== container.nodeName ||
      candidate.labName !== container.labName ||
      candidate.state !== container.state ||
      candidate.kind !== container.kind ||
      candidate.image !== container.image ||
      candidate.ipv4Address !== container.ipv4Address ||
      candidate.ipv6Address !== container.ipv6Address
    ) {
      return false;
    }

    const prevInterfaces = [...(container.interfaces ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const nextInterfaces = [...(candidate.interfaces ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    if (prevInterfaces.length !== nextInterfaces.length) {
      return false;
    }

    for (let i = 0; i < prevInterfaces.length; i += 1) {
      const prevIface = prevInterfaces[i];
      const nextIface = nextInterfaces[i];
      if (
        prevIface.name !== nextIface.name ||
        prevIface.alias !== nextIface.alias ||
        prevIface.state !== nextIface.state ||
        prevIface.type !== nextIface.type ||
        prevIface.mac !== nextIface.mac ||
        prevIface.mtu !== nextIface.mtu ||
        prevIface.ifIndex !== nextIface.ifIndex ||
        !runtimeInterfaceStatsEqual(prevIface.stats, nextIface.stats)
      ) {
        return false;
      }
    }
  }

  return true;
}
