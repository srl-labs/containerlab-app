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
  InspectContainerInfo,
  LabBackend
} from "@srl-labs/containerlab-lab-backend";
import { LocalLabBackend } from "@srl-labs/containerlab-lab-backend/local";

import { outputChannel } from "../globals";
import type { ClabDetailedJSON } from "../treeView/common";
import type { ClabInterfaceSnapshot } from "../types/containerlab";

// Listeners for data changes, of every connection
type DataListener = () => void;
const dataListeners = new Set<DataListener>();
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

const INTERFACE_CACHE_TTL_MS = 5000;

/**
 * Polls the labs of one connection, for backends without an event stream:
 * `containerlab inspect` on this machine, the API's inspect records on a lab
 * server.
 */
export class LabPoller {
  private rawInspectData: Record<string, ClabDetailedJSON[]> | undefined;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private dataChangedTimer: ReturnType<typeof setTimeout> | null = null;
  // Interface cache: key is `labPath::containerName`, value is cached interfaces
  private readonly interfaceCache = new Map<
    string,
    { timestamp: number; interfaces: ClabInterfaceSnapshot[] }
  >();
  private readonly pendingInterfaceFetches = new Set<string>();

  constructor(private readonly backend: () => LabBackend) {}

  private scheduleDataChanged(): void {
    if (dataListeners.size === 0 || this.dataChangedTimer) {
      return;
    }
    this.dataChangedTimer = setTimeout(() => {
      this.dataChangedTimer = null;
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

  /**
   * Fetch lab data: containerlab's detailed inspect for labs that containerlab
   * on this machine runs (here or on a Kubernetes cluster), the backend's
   * inspect records on a lab server.
   */
  private async fetchInspectData(): Promise<Record<string, ClabDetailedJSON[]> | undefined> {
    try {
      const backend = this.backend();
      if (backend instanceof LocalLabBackend) {
        return parseInspectData(await backend.inspectDetails());
      }
      return toDetailedLabs(await backend.inspectAll());
    } catch (err) {
      console.error(
        `[containerlabInspectFallback]: Failed to inspect labs: ${err instanceof Error ? err.message : String(err)}`
      );
      return undefined;
    }
  }

  private async pollOnce(): Promise<void> {
    const newData = await this.fetchInspectData();
    if (hasDataChanged(this.rawInspectData, newData)) {
      this.rawInspectData = newData;
      this.scheduleDataChanged();
    }
  }

  private startPolling(intervalMs: number): void {
    if (this.pollingInterval) {
      return;
    }
    outputChannel.debug(
      `[containerlabInspectFallback] Starting polling with ${intervalMs}ms interval`
    );
    void this.pollOnce();
    this.pollingInterval = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    outputChannel.debug("[containerlabInspectFallback] Stopped polling");
  }

  getGroupedContainers(): Record<string, ClabDetailedJSON[]> {
    return this.rawInspectData ?? {};
  }

  /** Starts polling and waits for the first answer. */
  async ensure(): Promise<void> {
    const config = vscode.workspace.getConfiguration("containerlab");
    this.startPolling(config.get<number>("pollInterval", DEFAULT_POLL_INTERVAL_MS));
    this.rawInspectData = await this.fetchInspectData();
    this.scheduleDataChanged();
  }

  /** The lab path of a container, from the polled records. */
  private findLabPathForContainer(containerName: string): string | undefined {
    for (const labContainers of Object.values(this.rawInspectData ?? {})) {
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

  /**
   * Interface data for a container with `containerlab inspect interfaces`, from
   * the connection's own backend: this machine or a Kubernetes cluster that
   * containerlab on this machine runs labs on. Lab servers are not asked.
   */
  private async fetchInterfaces(
    labPath: string,
    containerName: string
  ): Promise<ClabInspectInterfaceJSON[]> {
    const backend = this.backend();
    if (!(backend instanceof LocalLabBackend)) {
      return [];
    }
    try {
      if (!(await backend.features()).interfaceInspect) {
        return [];
      }
      const parsed = await backend.inspectInterfaces(labPath, containerName);
      return parsed.filter((entry) => isClabInspectInterfaceJSON(entry));
    } catch (err) {
      console.error(
        `[containerlabInspectFallback]: Failed to fetch interfaces for ${containerName}: ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }

  getInterfaceSnapshot(_containerShortId: string, containerName: string): ClabInterfaceSnapshot[] {
    const labPath = this.findLabPathForContainer(containerName);
    if (labPath === undefined || labPath.length === 0) {
      console.warn(
        `[containerlabInspectFallback]: Could not find lab path for container ${containerName}`
      );
      return [];
    }

    const cacheKey = `${labPath}::${containerName}`;
    const cached = this.interfaceCache.get(cacheKey);

    // Refresh stale data in the background; listeners hear about the update.
    if (
      (!cached || Date.now() - cached.timestamp >= INTERFACE_CACHE_TTL_MS) &&
      !this.pendingInterfaceFetches.has(cacheKey)
    ) {
      this.pendingInterfaceFetches.add(cacheKey);
      void this.fetchInterfaces(labPath, containerName)
        .then((rawInterfaces) => {
          const interfaces = toInterfaceSnapshot(rawInterfaces);
          const changed = JSON.stringify(interfaces) !== JSON.stringify(cached?.interfaces ?? []);
          this.interfaceCache.set(cacheKey, { timestamp: Date.now(), interfaces });
          if (changed) this.scheduleDataChanged();
        })
        .finally(() => this.pendingInterfaceFetches.delete(cacheKey));
    }

    return cached?.interfaces ?? [];
  }
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
