import { create } from "zustand";

type EventAttributeValue = string | number;

export interface ContainerState {
  endpointId: string;
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
  label: string;
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
  endpointId: string;
  name: string;
  owner: string;
  topologyPath: string;
  containers: Map<string, ContainerState>;
}

interface LabStoreState {
  labs: Map<string, LabState>;
  labsByEndpoint: Map<string, Map<string, LabState>>;
  connectedByEndpoint: Map<string, boolean>;
  clear: () => void;
  clearEndpoint: (endpointId: string) => void;
  getAllLabs: () => Map<string, LabState>;
  getLabsForEndpoint: (endpointId: string) => Map<string, LabState>;
  processEvent: (endpointId: string, event: EventData) => void;
  setConnected: (endpointId: string, connected: boolean) => void;
  updateInterfaceNetemState: (update: InterfaceNetemUpdate) => void;
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
    .replace(/\/+?/g, "/")
    .replace(/^\.\//, "");
}

function normalizeLabStoreName(labName: string | undefined): string {
  return (labName ?? "").trim().toLowerCase();
}

function resolveLabStoreKey(labPath: string | undefined): string | null {
  const normalizedPath = normalizeLabStorePath(labPath);
  return normalizedPath ? `path:${normalizedPath}` : null;
}

function resolveNamedLabStoreKey(labName: string | undefined): string | null {
  const normalizedName = normalizeLabStoreName(labName);
  return normalizedName ? `name:${normalizedName}` : null;
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

function fallbackContainerState(action: string): string {
  switch (action.trim().toLowerCase()) {
    case "pause":
      return "paused";
    case "die":
    case "stop":
    case "kill":
      return "exited";
    case "create":
      return "created";
    default:
      return "running";
  }
}

function fallbackContainerStatus(state: string): string {
  switch (state) {
    case "exited":
      return "Exited";
    case "paused":
      return "Paused";
    default:
      return "";
  }
}

function isRunningContainerState(state: string): boolean {
  const normalized = state.trim().toLowerCase();
  return normalized.includes("running") || normalized.includes("healthy");
}

function interfacesForContainerState(
  existing: ContainerState | undefined,
  incoming: ContainerState
): Map<string, InterfaceState> {
  const interfaces = new Map(existing?.interfaces ?? incoming.interfaces);
  if (interfaces.size === 0 || isRunningContainerState(incoming.state)) {
    return interfaces;
  }

  for (const [name, iface] of interfaces.entries()) {
    interfaces.set(name, { ...iface, state: "down" });
  }
  return interfaces;
}

function extractContainerState(
  endpointId: string,
  attrs: Record<string, EventAttributeValue>,
  action = ""
): ContainerState {
  const fallbackState = fallbackContainerState(action);
  const fallbackStatus = fallbackContainerStatus(fallbackState);

  return {
    endpointId,
    name: getAttrString(attrs, "name") ?? "",
    containerId: getAttrString(attrs, "container-id", "id", "name") ?? "",
    labName: getAttrString(attrs, "lab", "containerlab") ?? "",
    labPath: getAttrString(attrs, "lab-path", "clab-topo-file") ?? "",
    owner: getAttrString(attrs, "clab-owner", "owner") ?? "",
    nodeName: getAttrString(attrs, "clab-node-name") ?? "",
    kind: getAttrString(attrs, "clab-node-kind") ?? "",
    image: getAttrString(attrs, "image") ?? "",
    state: getAttrString(attrs, "state") ?? fallbackState,
    status: getAttrString(attrs, "status") ?? fallbackStatus,
    ipv4Address: getAttrString(attrs, "ipv4-address", "mgmt_ipv4") ?? "N/A",
    ipv6Address: getAttrString(attrs, "ipv6-address", "mgmt_ipv6") ?? "N/A",
    interfaces: new Map()
  };
}

type MutableInterfaceField = Exclude<keyof InterfaceState, "name">;

const INTERFACE_ATTRIBUTE_FIELDS: Array<[MutableInterfaceField, string]> = [
  ["alias", "alias"],
  ["state", "state"],
  ["type", "type"],
  ["mac", "mac"],
  ["mtu", "mtu"],
  ["rxBps", "rx_bps"],
  ["txBps", "tx_bps"],
  ["rxPps", "rx_pps"],
  ["txPps", "tx_pps"],
  ["rxBytes", "rx_bytes"],
  ["txBytes", "tx_bytes"],
  ["rxPackets", "rx_packets"],
  ["txPackets", "tx_packets"],
  ["statsIntervalSeconds", "interval_seconds"],
  ["netemDelay", "netem_delay"],
  ["netemJitter", "netem_jitter"],
  ["netemLoss", "netem_loss"],
  ["netemRate", "netem_rate"],
  ["netemCorruption", "netem_corruption"]
];

const NETEM_INTERFACE_FIELDS = [
  "netemDelay",
  "netemJitter",
  "netemLoss",
  "netemRate",
  "netemCorruption"
] as const;

const DEFAULT_INTERFACE_NETEM_STATE = {
  netemDelay: "0ms",
  netemJitter: "0ms",
  netemLoss: "0%",
  netemRate: "0",
  netemCorruption: "0"
} as const;

type InterfaceNetemField = typeof NETEM_INTERFACE_FIELDS[number];

export type InterfaceNetemPatch = Partial<Pick<InterfaceState, InterfaceNetemField>>;

export interface InterfaceNetemUpdate {
  endpointId?: string;
  topologyPath?: string;
  labName?: string;
  nodeName: string;
  interfaceName: string;
  netem: InterfaceNetemPatch;
}

function normalizeNetemTargetValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function labMatchesNetemTarget(lab: LabState, update: InterfaceNetemUpdate): boolean {
  const targetPath = normalizeLabStorePath(update.topologyPath);
  if (targetPath) {
    const labPathMatches = normalizeLabStorePath(lab.topologyPath) === targetPath;
    const containerPathMatches = [...lab.containers.values()].some(
      (container) => normalizeLabStorePath(container.labPath) === targetPath
    );
    if (labPathMatches || containerPathMatches) {
      return true;
    }
  }

  const targetLabName = normalizeLabStoreName(update.labName);
  if (targetLabName) {
    return normalizeLabStoreName(lab.name) === targetLabName;
  }

  // Runtime events and topology sessions can report different path forms.
  // If the path did not match, let the node/container/interface match decide.
  return true;
}

function containerMatchesNetemTarget(lab: LabState, container: ContainerState, nodeName: string): boolean {
  const target = normalizeNetemTargetValue(nodeName);
  if (!target) {
    return false;
  }

  const containerName = normalizeNetemTargetValue(container.name);
  const containerNodeName = normalizeNetemTargetValue(container.nodeName);
  if (containerName === target || containerNodeName === target) {
    return true;
  }

  const labPrefix = `clab-${normalizeNetemTargetValue(lab.name)}-`;
  const shortContainerName = containerName.startsWith(labPrefix)
    ? containerName.slice(labPrefix.length)
    : containerName;
  return shortContainerName === target || containerName.endsWith(`-${target}`);
}

function findInterfaceEntry(
  interfaces: Map<string, InterfaceState>,
  interfaceName: string
): [string, InterfaceState] | undefined {
  const target = normalizeNetemTargetValue(interfaceName);
  if (!target) {
    return undefined;
  }
  for (const [key, iface] of interfaces.entries()) {
    if (
      normalizeNetemTargetValue(iface.name) === target ||
      normalizeNetemTargetValue(iface.alias) === target
    ) {
      return [key, iface];
    }
  }
  return undefined;
}

function applyNetemPatch(iface: InterfaceState, patch: InterfaceNetemPatch): InterfaceState {
  const next = { ...iface };
  for (const field of NETEM_INTERFACE_FIELDS) {
    const value = patch[field];
    if (value !== undefined) {
      next[field] = value;
    }
  }
  return next;
}

function interfaceNetemPatchChanges(iface: InterfaceState, patch: InterfaceNetemPatch): boolean {
  return NETEM_INTERFACE_FIELDS.some((field) => {
    const value = patch[field];
    return value !== undefined && iface[field] !== value;
  });
}

function shouldDeleteInterface(interfaceName: string, action: string): boolean {
  return interfaceName.startsWith("clab-") || action === "delete";
}

function baseInterfaceState(interfaceName: string, existing: InterfaceState | undefined): InterfaceState {
  return {
    name: interfaceName,
    alias: existing?.alias ?? "",
    label: existing?.label ?? interfaceName,
    state: existing?.state ?? "",
    type: existing?.type ?? "",
    mac: existing?.mac ?? "",
    mtu: existing?.mtu ?? "",
    ...(existing ? {} : DEFAULT_INTERFACE_NETEM_STATE)
  };
}

function applyInterfaceAttributes(
  next: InterfaceState,
  attrs: Record<string, EventAttributeValue>
): void {
  for (const [field, attr] of INTERFACE_ATTRIBUTE_FIELDS) {
    const value = getAttrString(attrs, attr);
    if (value !== undefined) {
      next[field] = value;
    }
  }
  const ifIndex = getAttrString(attrs, "index", "ifindex");
  if (ifIndex !== undefined) {
    next.ifIndex = ifIndex;
  }
  next.label = next.alias || next.name;
}

function preserveInterfaceMetadata(next: InterfaceState, existing: InterfaceState | undefined): void {
  if (!existing) {
    return;
  }
  for (const field of ["alias", "label", "type", "mac", "mtu"] as const) {
    next[field] = existing[field];
  }
}

function preserveInterfaceNetemState(
  next: InterfaceState,
  existing: InterfaceState | undefined
): void {
  if (!existing) {
    return;
  }
  for (const field of NETEM_INTERFACE_FIELDS) {
    if (next[field] === undefined && existing[field] !== undefined) {
      next[field] = existing[field];
    }
  }
}

function removeInterfaceRecordsWithSameIndex(
  interfaces: Map<string, InterfaceState>,
  incomingName: string,
  incomingIfIndex: string | undefined
): void {
  if (incomingIfIndex === undefined || incomingIfIndex.trim().length === 0) {
    return;
  }

  for (const [existingName, existing] of interfaces.entries()) {
    if (existingName === incomingName) {
      continue;
    }
    if (existing.ifIndex === incomingIfIndex) {
      interfaces.delete(existingName);
    }
  }
}

function upsertInterface(
  container: ContainerState,
  attrs: Record<string, EventAttributeValue>,
  action: string
): void {
  const interfaceName = getAttrString(attrs, "ifname", "interface") ?? "";
  if (!interfaceName) {
    return;
  }
  if (shouldDeleteInterface(interfaceName, action)) {
    container.interfaces.delete(interfaceName);
    return;
  }

  const existing = container.interfaces.get(interfaceName);
  const next = baseInterfaceState(interfaceName, existing);
  applyInterfaceAttributes(next, attrs);
  preserveInterfaceNetemState(next, existing);
  if (action === "stats") {
    preserveInterfaceMetadata(next, existing);
  }

  removeInterfaceRecordsWithSameIndex(container.interfaces, interfaceName, next.ifIndex);
  container.interfaces.set(interfaceName, next);
}

interface EventLabContext {
  attrs: Record<string, EventAttributeValue>;
  containerName: string;
  endpointLabs: Map<string, LabState>;
  lab: LabState;
  labKey: string;
}

function resolveExistingLabEntry(
  labs: Map<string, LabState>,
  labPath: string,
  labName: string,
  containerName: string,
  preferredLabKey: string | null
): { key: string; lab: LabState } | null {
  return (
    findExistingLabEntry(labs, labPath) ??
    (containerName ? findLabEntryByContainerName(labs, containerName) : null) ??
    (!preferredLabKey && labName ? findLabEntryByName(labs, labName) : null)
  );
}

function cloneOrCreateLab(
  endpointId: string,
  attrs: Record<string, EventAttributeValue>,
  labName: string,
  labPath: string,
  existingLab: LabState | undefined
): LabState {
  if (!existingLab) {
    return {
      endpointId,
      name: labName,
      owner: getAttrString(attrs, "clab-owner", "owner") ?? "",
      topologyPath: labPath,
      containers: new Map()
    };
  }
  return {
    endpointId,
    name: labName || existingLab.name,
    owner: existingLab.owner,
    topologyPath: labPath || existingLab.topologyPath,
    containers: new Map(existingLab.containers)
  };
}

function resolveEventLabContext(
  endpointId: string,
  event: EventData,
  previousLabs: Map<string, LabState> | undefined
): EventLabContext | null {
  const attrs = event.attributes;
  const labName = getAttrString(attrs, "lab", "containerlab") ?? "";
  const labPath = getAttrString(attrs, "lab-path", "clab-topo-file") ?? "";
  const containerName =
    getAttrString(attrs, "name", "container-name", "container") ??
    getEventString(event, "actor_name", "actorName") ??
    "";
  const preferredLabKey = resolveLabStoreKey(labPath);
  const endpointLabs = new Map(previousLabs ?? new Map());
  const existingEntry = resolveExistingLabEntry(endpointLabs, labPath, labName, containerName, preferredLabKey);
  const labKey = preferredLabKey ?? existingEntry?.key ?? resolveNamedLabStoreKey(labName);
  if (!labKey || !containerName) {
    return null;
  }
  if (existingEntry && preferredLabKey && existingEntry.key !== preferredLabKey) {
    endpointLabs.delete(existingEntry.key);
  }
  return {
    attrs,
    containerName,
    endpointLabs,
    lab: cloneOrCreateLab(endpointId, attrs, labName, labPath, existingEntry?.lab),
    labKey
  };
}

function applyContainerEvent(
  context: EventLabContext,
  endpointId: string,
  action: string
): void {
  const { attrs, containerName, endpointLabs, lab, labKey } = context;
  if (action === "destroy" || action === "delete" || action === "remove") {
    lab.containers.delete(containerName);
    if (lab.containers.size === 0) {
      endpointLabs.delete(labKey);
    } else {
      endpointLabs.set(labKey, lab);
    }
    return;
  }

  const incoming = extractContainerState(endpointId, attrs, action);
  const existing = lab.containers.get(containerName);
  const container: ContainerState = {
    ...(existing ?? incoming),
    ...incoming,
    endpointId,
    interfaces: interfacesForContainerState(existing, incoming)
  };
  lab.owner = incoming.owner || lab.owner;
  lab.topologyPath = incoming.labPath || lab.topologyPath;
  lab.name = incoming.labName || lab.name;
  lab.containers.set(containerName, container);
  endpointLabs.set(labKey, lab);
}

function applyInterfaceEvent(
  context: EventLabContext,
  endpointId: string,
  action: string
): void {
  const { attrs, containerName, endpointLabs, lab, labKey } = context;
  const existing = lab.containers.get(containerName);
  const placeholder = extractContainerState(endpointId, attrs, action);
  const container: ContainerState = existing
    ? { ...existing, endpointId, interfaces: new Map(existing.interfaces) }
    : placeholder;
  upsertInterface(container, attrs, action);
  lab.containers.set(containerName, container);
  lab.topologyPath = placeholder.labPath || lab.topologyPath;
  lab.name = placeholder.labName || lab.name;
  endpointLabs.set(labKey, lab);
}

function applyLabEventContext(
  context: EventLabContext,
  endpointId: string,
  event: EventData
): void {
  if (event.type === "container") {
    applyContainerEvent(context, endpointId, event.action);
    return;
  }
  if (event.type === "interface" || event.type === "interface-stats") {
    applyInterfaceEvent(context, endpointId, event.action);
  }
}

function mergeLabsByEndpoint(
  labsByEndpoint: Map<string, Map<string, LabState>>
): Map<string, LabState> {
  const merged = new Map<string, LabState>();
  for (const [endpointId, endpointLabs] of labsByEndpoint.entries()) {
    for (const [labKey, lab] of endpointLabs.entries()) {
      merged.set(`${endpointId}:${labKey}`, lab);
    }
  }
  return merged;
}

export const useLabStore = create<LabStoreState>((set, get) => ({
  labs: new Map(),
  labsByEndpoint: new Map(),
  connectedByEndpoint: new Map(),

  setConnected: (endpointId, connected) =>
    set((state) => {
      const connectedByEndpoint = new Map(state.connectedByEndpoint);
      connectedByEndpoint.set(endpointId, connected);
      return { connectedByEndpoint };
    }),

  processEvent: (endpointId, event) => {
    const previousLabsByEndpoint = get().labsByEndpoint;
    const context = resolveEventLabContext(endpointId, event, previousLabsByEndpoint.get(endpointId));
    if (!context) {
      return;
    }
    applyLabEventContext(context, endpointId, event);

    set((state) => {
      const labsByEndpoint = new Map(state.labsByEndpoint);
      labsByEndpoint.set(endpointId, context.endpointLabs);
      return {
        labsByEndpoint,
        labs: mergeLabsByEndpoint(labsByEndpoint)
      };
    });
  },

  updateInterfaceNetemState: (update) =>
    set((state) => {
      let changed = false;
      const labsByEndpoint = new Map(state.labsByEndpoint);

      for (const [endpointId, endpointLabs] of state.labsByEndpoint.entries()) {
        if (update.endpointId && endpointId !== update.endpointId) {
          continue;
        }

        let endpointChanged = false;
        const nextEndpointLabs = new Map(endpointLabs);

        for (const [labKey, lab] of endpointLabs.entries()) {
          if (!labMatchesNetemTarget(lab, update)) {
            continue;
          }

          for (const [containerKey, container] of lab.containers.entries()) {
            if (!containerMatchesNetemTarget(lab, container, update.nodeName)) {
              continue;
            }
            const interfaceEntry = findInterfaceEntry(container.interfaces, update.interfaceName);
            if (!interfaceEntry) {
              continue;
            }
            const [interfaceKey, iface] = interfaceEntry;
            if (!interfaceNetemPatchChanges(iface, update.netem)) {
              continue;
            }

            const nextInterfaces = new Map(container.interfaces);
            nextInterfaces.set(interfaceKey, applyNetemPatch(iface, update.netem));

            const nextContainers = new Map(lab.containers);
            nextContainers.set(containerKey, { ...container, interfaces: nextInterfaces });
            nextEndpointLabs.set(labKey, { ...lab, containers: nextContainers });
            endpointChanged = true;
            changed = true;
            break;
          }
        }

        if (endpointChanged) {
          labsByEndpoint.set(endpointId, nextEndpointLabs);
        }
      }

      if (!changed) {
        return state;
      }

      return {
        labsByEndpoint,
        labs: mergeLabsByEndpoint(labsByEndpoint)
      };
    }),

  clearEndpoint: (endpointId) =>
    set((state) => {
      const labsByEndpoint = new Map(state.labsByEndpoint);
      const connectedByEndpoint = new Map(state.connectedByEndpoint);
      labsByEndpoint.delete(endpointId);
      connectedByEndpoint.delete(endpointId);
      return {
        labsByEndpoint,
        connectedByEndpoint,
        labs: mergeLabsByEndpoint(labsByEndpoint)
      };
    }),

  clear: () => set({
    labs: new Map(),
    labsByEndpoint: new Map(),
    connectedByEndpoint: new Map()
  }),

  getAllLabs: () => get().labs,
  getLabsForEndpoint: (endpointId) => get().labsByEndpoint.get(endpointId) ?? new Map()
}));
