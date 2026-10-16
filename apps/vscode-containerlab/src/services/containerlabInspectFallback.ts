/**
 * Fallback data provider that polls the lab backend's inspect data.
 *
 * This module provides an alternative to the event-based system for fetching
 * container and lab data. It polls containerlab inspect at configurable intervals.
 *
 * This is a temporary fallback that can be easily removed once the event system
 * is stable and widely available.
 */

import * as path from "path";

import * as vscode from "vscode";
import type {
  InspectAllLabsResponse,
  InspectContainerInfo
} from "@srl-labs/containerlab-lab-backend";

import { getLabBackend, getLocalBackend } from "../backend/labBackends";
import { outputChannel } from "../globals";
import type { ClabDetailedJSON } from "../treeView/common";
import type { ClabInterfaceSnapshot } from "../types/containerlab";

// Internal state
let rawInspectData: Record<string, ClabDetailedJSON[]> | undefined;
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

// Listeners for data changes
type DataListener = () => void;
const dataListeners = new Set<DataListener>();
let dataChangedTimer: ReturnType<typeof setTimeout> | null = null;
const DATA_NOTIFY_DELAY_MS = 50;

// Default polling interval (ms)
const DEFAULT_POLL_INTERVAL_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isClabDetailedJSON(value: unknown): value is ClabDetailedJSON {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.Names) &&
    typeof value.ID === "string" &&
    typeof value.ShortID === "string" &&
    typeof value.Image === "string" &&
    typeof value.State === "string" &&
    typeof value.Status === "string" &&
    isRecord(value.Labels)
  );
}

function isClabDetailedArray(value: unknown): value is ClabDetailedJSON[] {
  return Array.isArray(value) && value.every((entry) => isClabDetailedJSON(entry));
}

function parseInspectData(parsed: unknown): Record<string, ClabDetailedJSON[]> | undefined {
  if (!isRecord(parsed)) return undefined;
  const result: Record<string, ClabDetailedJSON[]> = {};
  for (const [labName, value] of Object.entries(parsed)) {
    if (!isClabDetailedArray(value)) return undefined;
    result[labName] = value;
  }
  return result;
}

function isClabInspectInterfaceEntry(
  value: unknown
): value is ClabInspectInterfaceJSON["interfaces"][number] {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.state === "string" &&
    typeof value.alias === "string" &&
    typeof value.mac === "string" &&
    typeof value.mtu === "number" &&
    typeof value.ifindex === "number"
  );
}

function isClabInspectInterfaceJSON(value: unknown): value is ClabInspectInterfaceJSON {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    Array.isArray(value.interfaces) &&
    value.interfaces.every((entry) => isClabInspectInterfaceEntry(entry))
  );
}

function getArrayMetadataString<T>(items: T[], key: string): string | undefined {
  const metadataValue = Object.entries(items).find(([entryKey]) => entryKey === key)?.[1];
  return typeof metadataValue === "string" && metadataValue.length > 0 ? metadataValue : undefined;
}

function scheduleDataChanged(): void {
  if (dataListeners.size === 0) {
    return;
  }
  if (dataChangedTimer) {
    return;
  }
  dataChangedTimer = setTimeout(() => {
    dataChangedTimer = null;
    for (const listener of Array.from(dataListeners)) {
      try {
        listener();
      } catch (err) {
        console.error(
          `[containerlabInspectFallback]: Failed to notify listener: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }, DATA_NOTIFY_DELAY_MS);
}

function inspectString(container: InspectContainerInfo, ...keys: string[]): string {
  const record = container as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value !== "N/A") return value;
  }
  return "";
}

function splitAddress(value: string): { address?: string; prefixLength?: number } {
  if (!value) return {};
  const [address, prefix] = value.split("/");
  return { address, prefixLength: prefix ? Number(prefix) : undefined };
}

/** A lab backend's inspect record in the detailed `containerlab inspect` shape. */
function toDetailedContainer(container: InspectContainerInfo): ClabDetailedJSON {
  const labPath = inspectString(container, "absLabPath", "labPath");
  const labName = inspectString(container, "lab_name", "labName");
  const nodeName = inspectString(container, "nodeName");
  const ipv4 = splitAddress(inspectString(container, "ipv4_address", "ipv4Address"));
  const ipv6 = splitAddress(inspectString(container, "ipv6_address", "ipv6Address"));
  const id = inspectString(container, "container_id", "containerId");
  return {
    Names: [container.name],
    ID: id,
    ShortID: id.slice(0, 12),
    Image: container.image,
    State: container.state,
    Status: container.status,
    Labels: {
      "clab-node-kind": container.kind,
      "clab-node-lab-dir": labPath
        ? path.join(path.dirname(labPath), `clab-${labName}`, nodeName)
        : "",
      "clab-node-longname": container.name,
      "clab-node-name": nodeName,
      "clab-owner": container.owner,
      "clab-topo-file": labPath,
      "clab-node-group": container.group,
      containerlab: labName
    },
    NetworkSettings: {
      IPv4addr: ipv4.address,
      IPv4pLen: ipv4.prefixLength,
      IPv6addr: ipv6.address,
      IPv6pLen: ipv6.prefixLength
    },
    Mounts: [],
    Ports: [],
    NetworkName: inspectString(container, "mgmt_network") || undefined
  };
}

function toDetailedLabs(labs: InspectAllLabsResponse): Record<string, ClabDetailedJSON[]> {
  return Object.fromEntries(
    Object.entries(labs).map(([labName, containers]) => [
      labName,
      containers.map(toDetailedContainer)
    ])
  );
}

/**
 * Fetch lab data: containerlab's detailed inspect on this machine, the
 * backend's inspect records otherwise.
 */
async function fetchInspectData(): Promise<Record<string, ClabDetailedJSON[]> | undefined> {
  try {
    const backend = getLabBackend();
    if (backend.kind === "local") {
      return parseInspectData(await getLocalBackend().inspectDetails());
    }
    return toDetailedLabs(await backend.inspectAll());
  } catch (err) {
    console.error(
      `[containerlabInspectFallback]: Failed to inspect labs: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

/**
 * Check if containers in a lab have changed
 */
function hasLabChanged(
  oldContainers: ClabDetailedJSON[],
  newContainers: ClabDetailedJSON[]
): boolean {
  if (oldContainers.length !== newContainers.length) {
    return true;
  }

  for (const newContainer of newContainers) {
    const oldContainer = oldContainers.find((c) => c.ShortID === newContainer.ShortID);
    if (!oldContainer || oldContainer.State !== newContainer.State) {
      return true;
    }
  }

  return false;
}

/**
 * Compare two data sets to detect changes
 */
function hasDataChanged(
  oldData: Record<string, ClabDetailedJSON[]> | undefined,
  newData: Record<string, ClabDetailedJSON[]> | undefined
): boolean {
  if (!oldData && !newData) {
    return false;
  }
  if (!oldData || !newData) {
    return true;
  }

  const oldLabs = Object.keys(oldData);
  const newLabs = Object.keys(newData);

  if (oldLabs.length !== newLabs.length) {
    return true;
  }

  for (const labName of newLabs) {
    if (!Object.prototype.hasOwnProperty.call(oldData, labName)) {
      return true;
    }

    if (hasLabChanged(oldData[labName], newData[labName])) {
      return true;
    }
  }

  return false;
}

/**
 * Poll for updates
 */
async function pollOnce(): Promise<void> {
  const newData = await fetchInspectData();

  if (hasDataChanged(rawInspectData, newData)) {
    rawInspectData = newData;
    scheduleDataChanged();
  }
}

/**
 * Start polling for lab data
 */
function startPolling(intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void {
  if (isPolling) {
    return;
  }

  isPolling = true;
  outputChannel.debug(
    `[containerlabInspectFallback] Starting polling with ${intervalMs}ms interval`
  );

  // Initial fetch
  void pollOnce();

  // Set up polling interval
  pollingInterval = setInterval(() => {
    void pollOnce();
  }, intervalMs);
}

/**
 * Stop polling
 */
export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  isPolling = false;
  outputChannel.debug("[containerlabInspectFallback] Stopped polling");
}

/**
 * Get the current grouped containers data
 */
export function getGroupedContainers(): Record<string, ClabDetailedJSON[]> {
  return rawInspectData ?? {};
}

/**
 * Force an immediate update
 */
async function forceUpdate(): Promise<void> {
  const newData = await fetchInspectData();
  rawInspectData = newData;
  scheduleDataChanged();
}

/**
 * Ensure the fallback is running (similar API to ensureEventStream)
 */
export async function ensureFallback(): Promise<void> {
  const config = vscode.workspace.getConfiguration("containerlab");
  const pollInterval = config.get<number>("pollInterval", DEFAULT_POLL_INTERVAL_MS);

  if (!isPolling) {
    startPolling(pollInterval);
  }

  // Do an initial fetch and wait for it
  await forceUpdate();
}

/**
 * Register a listener for data changes
 */
export function onDataChanged(listener: DataListener): () => void {
  dataListeners.add(listener);
  return () => {
    dataListeners.delete(listener);
  };
}

// Interface cache: key is `labPath::containerName`, value is cached interfaces
const interfaceCache = new Map<
  string,
  {
    timestamp: number;
    interfaces: ClabInterfaceSnapshot[];
  }
>();
const INTERFACE_CACHE_TTL_MS = 5000;

/**
 * Raw interface data from containerlab inspect interfaces
 */
interface ClabInspectInterfaceJSON {
  name: string;
  interfaces: Array<{
    name: string;
    type: string;
    state: string;
    alias: string;
    mac: string;
    mtu: number;
    ifindex: number;
  }>;
}

/**
 * Find the lab path for a container by looking through rawInspectData
 */
function findLabPathForContainer(containerName: string): string | undefined {
  if (!rawInspectData) {
    return undefined;
  }

  for (const labContainers of Object.values(rawInspectData)) {
    const container = labContainers.find((c) => c.Names[0] === containerName);
    if (container) {
      // The topo-file is stored as a property on the array
      return (
        getArrayMetadataString(labContainers, "topo-file") ?? container.Labels["clab-topo-file"]
      );
    }
  }
  return undefined;
}

const pendingInterfaceFetches = new Set<string>();

/**
 * Fetch interface data for a container with `containerlab inspect interfaces`.
 * Only labs on this machine can be inspected this way.
 */
async function fetchInterfaces(
  labPath: string,
  containerName: string
): Promise<ClabInspectInterfaceJSON[]> {
  if (getLabBackend().kind !== "local") {
    return [];
  }
  try {
    const parsed = await getLocalBackend().inspectInterfaces(labPath, containerName);
    return parsed.filter((entry) => isClabInspectInterfaceJSON(entry));
  } catch (err) {
    console.error(
      `[containerlabInspectFallback]: Failed to fetch interfaces for ${containerName}: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

/**
 * Convert raw interface data to snapshot format
 */
function toInterfaceSnapshot(raw: ClabInspectInterfaceJSON[]): ClabInterfaceSnapshot[] {
  if (raw.length === 0) {
    return [];
  }

  return raw.map((item) => ({
    name: item.name,
    interfaces: item.interfaces.map((iface) => ({
      name: iface.name,
      type: iface.type || "",
      state: iface.state || "",
      alias: iface.alias || "",
      mac: iface.mac || "",
      mtu: iface.mtu || 0,
      ifindex: iface.ifindex || 0
    }))
  }));
}

/**
 * Get interface snapshot for a container (fallback implementation)
 */
export function getInterfaceSnapshot(
  _containerShortId: string,
  containerName: string
): ClabInterfaceSnapshot[] {
  // Find the lab path for this container
  const labPath = findLabPathForContainer(containerName);
  if (labPath === undefined || labPath.length === 0) {
    console.warn(
      `[containerlabInspectFallback]: Could not find lab path for container ${containerName}`
    );
    return [];
  }

  const cacheKey = `${labPath}::${containerName}`;
  const cached = interfaceCache.get(cacheKey);

  // Refresh stale data in the background; listeners hear about the update.
  if (
    (!cached || Date.now() - cached.timestamp >= INTERFACE_CACHE_TTL_MS) &&
    !pendingInterfaceFetches.has(cacheKey)
  ) {
    pendingInterfaceFetches.add(cacheKey);
    void fetchInterfaces(labPath, containerName)
      .then((rawInterfaces) => {
        const interfaces = toInterfaceSnapshot(rawInterfaces);
        const changed = JSON.stringify(interfaces) !== JSON.stringify(cached?.interfaces ?? []);
        interfaceCache.set(cacheKey, { timestamp: Date.now(), interfaces });
        if (changed) scheduleDataChanged();
      })
      .finally(() => pendingInterfaceFetches.delete(cacheKey));
  }

  return cached?.interfaces ?? [];
}
