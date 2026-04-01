import { create } from "zustand";

type EventAttributeValue = string | number;

export interface ContainerState {
  name: string;
  containerId: string;
  labName: string;
  labPath: string;
  owner: string;
  nodeName: string;
  kind: string;
  image: string;
  state: string;
  status: string;
  ipv4Address: string;
  ipv6Address: string;
  interfaces: Map<string, InterfaceState>;
}

export interface InterfaceState {
  name: string;
  alias: string;
  state: string;
  type: string;
  mac: string;
  mtu: string;
  ifIndex?: string;
  rxBps?: string;
  txBps?: string;
  rxPps?: string;
  txPps?: string;
  rxBytes?: string;
  txBytes?: string;
  rxPackets?: string;
  txPackets?: string;
  statsIntervalSeconds?: string;
  netemDelay?: string;
  netemJitter?: string;
  netemLoss?: string;
  netemRate?: string;
  netemCorruption?: string;
}

export interface LabState {
  name: string;
  owner: string;
  topologyPath: string;
  containers: Map<string, ContainerState>;
}

interface LabStoreState {
  labs: Map<string, LabState>;
  connected: boolean;
  setConnected: (connected: boolean) => void;
  processEvent: (event: EventData) => void;
  clear: () => void;
}

export interface EventData {
  time?: number;
  type: string;
  action: string;
  attributes: Record<string, EventAttributeValue>;
}

function getAttrString(
  attrs: Record<string, EventAttributeValue>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function getEventString(event: EventData, ...keys: string[]): string | undefined {
  const source = event as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function normalizeLabStorePath(pathValue: string | undefined): string {
  return (pathValue ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "");
}

function normalizeLabStoreName(labName: string | undefined): string {
  return (labName ?? "").trim().toLowerCase();
}

function resolveLabStoreKey(labPath: string | undefined): string | null {
  const normalizedPath = normalizeLabStorePath(labPath);
  return normalizedPath ? `path:${normalizedPath}` : null;
}

function findExistingLabEntry(
  labs: Map<string, LabState>,
  labPath: string | undefined
): { key: string; lab: LabState } | null {
  const preferredKey = resolveLabStoreKey(labPath);
  if (preferredKey) {
    const exact = labs.get(preferredKey);
    if (exact) {
      return { key: preferredKey, lab: exact };
    }
  }

  const normalizedPath = normalizeLabStorePath(labPath);
  if (normalizedPath) {
    for (const [key, lab] of labs.entries()) {
      if (normalizeLabStorePath(lab.topologyPath) === normalizedPath) {
        return { key, lab };
      }
      for (const container of lab.containers.values()) {
        if (normalizeLabStorePath(container.labPath) === normalizedPath) {
          return { key, lab };
        }
      }
    }
  }

  return null;
}

function findLabEntryByContainerName(
  labs: Map<string, LabState>,
  containerName: string | undefined
): { key: string; lab: LabState } | null {
  if (!containerName || containerName.trim().length === 0) {
    return null;
  }
  const target = containerName.trim();
  for (const [key, lab] of labs.entries()) {
    if (lab.containers.has(target)) {
      return { key, lab };
    }
  }
  return null;
}

function findLabEntryByName(
  labs: Map<string, LabState>,
  labName: string | undefined
): { key: string; lab: LabState } | null {
  const target = normalizeLabStoreName(labName);
  if (!target) {
    return null;
  }
  const matches: Array<{ key: string; lab: LabState }> = [];
  for (const [key, lab] of labs.entries()) {
    if (normalizeLabStoreName(lab.name) === target) {
      matches.push({ key, lab });
      if (matches.length > 1) {
        return null;
      }
    }
  }
  return matches[0] ?? null;
}

function extractContainerState(attrs: Record<string, EventAttributeValue>): ContainerState {
  return {
    name: getAttrString(attrs, "name") ?? "",
    containerId: getAttrString(attrs, "container-id", "id", "name") ?? "",
    labName: getAttrString(attrs, "lab", "containerlab") ?? "",
    labPath: getAttrString(attrs, "lab-path", "clab-topo-file") ?? "",
    owner: getAttrString(attrs, "clab-owner", "owner") ?? "",
    nodeName: getAttrString(attrs, "clab-node-name") ?? "",
    kind: getAttrString(attrs, "clab-node-kind") ?? "",
    image: getAttrString(attrs, "image") ?? "",
    state: getAttrString(attrs, "state") ?? "running",
    status: getAttrString(attrs, "status") ?? "",
    ipv4Address: getAttrString(attrs, "ipv4-address", "mgmt_ipv4") ?? "N/A",
    ipv6Address: getAttrString(attrs, "ipv6-address", "mgmt_ipv6") ?? "N/A",
    interfaces: new Map()
  };
}

function upsertInterface(
  container: ContainerState,
  attrs: Record<string, EventAttributeValue>,
  action: string
): void {
  const interfaceName = getAttrString(attrs, "ifname", "interface") ?? "";
  if (!interfaceName) return;
  if (interfaceName.startsWith("clab-")) {
    container.interfaces.delete(interfaceName);
    return;
  }
  if (action === "delete") {
    container.interfaces.delete(interfaceName);
    return;
  }

  const existing = container.interfaces.get(interfaceName);
  const next: InterfaceState = {
    name: interfaceName,
    alias: getAttrString(attrs, "alias") ?? existing?.alias ?? "",
    state: getAttrString(attrs, "state") ?? existing?.state ?? "",
    type: getAttrString(attrs, "type") ?? existing?.type ?? "",
    mac: getAttrString(attrs, "mac") ?? existing?.mac ?? "",
    mtu: getAttrString(attrs, "mtu") ?? existing?.mtu ?? "",
    ifIndex: getAttrString(attrs, "index") ?? existing?.ifIndex,
    rxBps: getAttrString(attrs, "rx_bps") ?? existing?.rxBps,
    txBps: getAttrString(attrs, "tx_bps") ?? existing?.txBps,
    rxPps: getAttrString(attrs, "rx_pps") ?? existing?.rxPps,
    txPps: getAttrString(attrs, "tx_pps") ?? existing?.txPps,
    rxBytes: getAttrString(attrs, "rx_bytes") ?? existing?.rxBytes,
    txBytes: getAttrString(attrs, "tx_bytes") ?? existing?.txBytes,
    rxPackets: getAttrString(attrs, "rx_packets") ?? existing?.rxPackets,
    txPackets: getAttrString(attrs, "tx_packets") ?? existing?.txPackets,
    statsIntervalSeconds: getAttrString(attrs, "interval_seconds") ?? existing?.statsIntervalSeconds,
    netemDelay: getAttrString(attrs, "netem_delay") ?? existing?.netemDelay,
    netemJitter: getAttrString(attrs, "netem_jitter") ?? existing?.netemJitter,
    netemLoss: getAttrString(attrs, "netem_loss") ?? existing?.netemLoss,
    netemRate: getAttrString(attrs, "netem_rate") ?? existing?.netemRate,
    netemCorruption: getAttrString(attrs, "netem_corruption") ?? existing?.netemCorruption
  };

  if (action === "stats") {
    next.alias = existing?.alias ?? next.alias;
    next.type = existing?.type ?? next.type;
    next.mac = existing?.mac ?? next.mac;
    next.mtu = existing?.mtu ?? next.mtu;
  }

  container.interfaces.set(interfaceName, next);
}

export const useLabStore = create<LabStoreState>((set, get) => ({
  labs: new Map(),
  connected: false,

  setConnected: (connected) => set({ connected }),

  processEvent: (event) => {
    const attrs = event.attributes;
    const labName = getAttrString(attrs, "lab", "containerlab") ?? "";
    const labPath = getAttrString(attrs, "lab-path", "clab-topo-file") ?? "";
    const preferredLabKey = resolveLabStoreKey(labPath);
    const containerName =
      getAttrString(attrs, "name", "container-name", "container") ??
      getEventString(event, "actor_name", "actorName") ??
      "";

    const previousLabs = get().labs;
    const labs = new Map(previousLabs);
    let existingEntry = findExistingLabEntry(previousLabs, labPath);
    if (!existingEntry && containerName) {
      existingEntry = findLabEntryByContainerName(previousLabs, containerName);
    }
    if (!existingEntry && !preferredLabKey && labName) {
      existingEntry = findLabEntryByName(previousLabs, labName);
    }
    const labKey = preferredLabKey ?? existingEntry?.key ?? null;
    if (!labKey) {
      return;
    }

    const existingLab = existingEntry?.lab;
    if (existingEntry && preferredLabKey && existingEntry.key !== preferredLabKey) {
      labs.delete(existingEntry.key);
    }
    const lab: LabState = existingLab
      ? {
          name: labName || existingLab.name,
          owner: existingLab.owner,
          topologyPath: labPath || existingLab.topologyPath,
          containers: new Map(existingLab.containers)
        }
      : {
          name: labName,
          owner: getAttrString(attrs, "clab-owner", "owner") ?? "",
          topologyPath: labPath,
          containers: new Map()
        };

    if (!containerName) return;
    const action = event.action;

    if (event.type === "container") {
      if (action === "destroy" || action === "die" || action === "kill") {
        lab.containers.delete(containerName);
        // If no containers left, remove the lab
        if (lab.containers.size === 0) {
          labs.delete(labKey);
        } else {
          labs.set(labKey, lab);
        }
      } else {
        // start, create, running, health_status, etc.
        const incoming = extractContainerState(attrs);
        const existing = lab.containers.get(containerName);
        const container = {
          ...(existing ?? incoming),
          ...incoming,
          interfaces: new Map(existing?.interfaces ?? incoming.interfaces)
        };
        if (incoming.owner) {
          lab.owner = incoming.owner;
        }
        if (incoming.labPath) {
          lab.topologyPath = incoming.labPath;
        }
        if (incoming.labName) {
          lab.name = incoming.labName;
        }
        lab.containers.set(containerName, container);
        labs.set(labKey, lab);
      }
    } else if (event.type === "interface" || event.type === "interface-stats") {
      const existing = lab.containers.get(containerName);
      const placeholder = extractContainerState(attrs);
      const container: ContainerState = existing
        ? { ...existing, interfaces: new Map(existing.interfaces) }
        : placeholder;
      upsertInterface(container, attrs, action);
      lab.containers.set(containerName, container);
      if (placeholder.labPath) {
        lab.topologyPath = placeholder.labPath;
      }
      if (placeholder.labName) {
        lab.name = placeholder.labName;
      }
      labs.set(labKey, lab);
    }

    set({ labs });
  },

  clear: () => set({ labs: new Map(), connected: false })
}));
