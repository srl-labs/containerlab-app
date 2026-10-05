import {
  normalizeRuntimeContainer,
  type HostRuntimeContainer,
  type RuntimeInterfaceInput
} from "@containerlab/clab-ui/host";
import type { TopologyRef } from "@containerlab/clab-ui/session";
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

function toRuntimeInterfaceInput(iface: InterfaceState): RuntimeInterfaceInput {
  return {
    name: iface.name,
    alias: iface.alias,
    label: iface.label,
    mac: iface.mac,
    mtu: iface.mtu,
    state: iface.state,
    type: iface.type,
    ifIndex: iface.ifIndex,
    stats: {
      rxBps: iface.rxBps,
      txBps: iface.txBps,
      rxPps: iface.rxPps,
      txPps: iface.txPps,
      rxBytes: iface.rxBytes,
      txBytes: iface.txBytes,
      rxPackets: iface.rxPackets,
      txPackets: iface.txPackets,
      statsIntervalSeconds: iface.statsIntervalSeconds
    },
    netemState: {
      delay: iface.netemDelay,
      jitter: iface.netemJitter,
      loss: iface.netemLoss,
      rate: iface.netemRate,
      corruption: iface.netemCorruption
    }
  };
}

function getRuntimeContainers(lab: LabState | undefined): HostRuntimeContainer[] {
  if (!lab) {
    return [];
  }

  return [...lab.containers.values()].map((container) =>
    normalizeRuntimeContainer({
      ...container,
      interfaces: [...container.interfaces.values()].map(toRuntimeInterfaceInput)
    })
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
    Partial<Pick<TopologyRef, "labName" | "topologyId" | "absoluteYamlPath">>
  ) | undefined,
  labs: Map<string, LabState>
): HostRuntimeContainer[] {
  return getRuntimeContainers(findLabStateForTopology(topologyRef, labs));
}
