import * as vscode from "vscode";
import { errorStatus } from "@srl-labs/containerlab-lab-backend";

import { backendFor, getConnections } from "../backend/labBackends";
import { LOCAL_CONNECTION, type LabConnection } from "../backend/connections";
import * as events from "../services/containerlabEvents";
import * as fallback from "../services/containerlabInspectFallback";
import { outputChannel } from "../globals";
import type { ClabInterfaceSnapshot } from "../types/containerlab";

import type * as c from "./common";

type LabsByName = Record<string, c.ClabDetailedJSON[]>;

/** The running labs of each connection, by connection id. */
const labsByConnection = new Map<string, LabsByName>();
/** Connections whose backend cannot stream events; they are polled instead. */
const pollingConnections = new Set<string>();
const pollers = new Map<string, fallback.LabPoller>();

/**
 * The connections whose labs the views show: Local unless it is hidden,
 * and every lab host that is signed in.
 */
function inspectedConnections(): LabConnection[] {
  const manager = getConnections();
  if (!manager) return [LOCAL_CONNECTION];
  return manager
    .list()
    .filter(
      (connection) => connection.kind === "local" || manager.status(connection) === "connected"
    );
}

/** The running labs of a connection, as the last update saw them. */
export function labsOf(connectionId: string): LabsByName | undefined {
  return labsByConnection.get(connectionId);
}

/** The running labs of every connection the views show, by connection id. */
export function allLabs(): Map<string, LabsByName> {
  return new Map(labsByConnection);
}

function preferPolling(): boolean {
  return (
    vscode.workspace.getConfiguration("containerlab").get<string>("refreshMode", "events") ===
    "polling"
  );
}

/** Whether a connection's labs come from polling instead of events. */
export function isPollingMode(connectionId = LOCAL_CONNECTION.id): boolean {
  return preferPolling() || pollingConnections.has(connectionId);
}

function pollerFor(connection: LabConnection): fallback.LabPoller {
  let poller = pollers.get(connection.id);
  if (!poller) {
    poller = new fallback.LabPoller(() => backendFor(connection));
    pollers.set(connection.id, poller);
  }
  return poller;
}

/** Stops watching a connection, e.g. after it signed out or was removed. */
export function forgetConnection(connectionId: string): void {
  events.stopEventStreams(connectionId);
  pollers.get(connectionId)?.stop();
  pollers.delete(connectionId);
  pollingConnections.delete(connectionId);
  labsByConnection.delete(connectionId);
}

/** Starts over for every connection: a new backend may stream events after all. */
export function resetForConnectionChange(): void {
  for (const connectionId of new Set([...labsByConnection.keys(), ...pollers.keys()])) {
    forgetConnection(connectionId);
  }
  events.stopEventStreams();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function updateConnection(connection: LabConnection): Promise<void> {
  const manager = getConnections();
  const runtime = vscode.workspace
    .getConfiguration("containerlab")
    .get<string>("runtime", "docker");
  if (isPollingMode(connection.id)) {
    await updateWithPolling(connection);
    return;
  }
  try {
    outputChannel.debug(`[inspector] Updating ${connection.label} via events stream`);
    const backend = backendFor(connection);
    const stream = events.eventStreamFor(connection.id);
    await stream.ensure(backend, `${backend.scope}|${runtime}`);
    labsByConnection.set(connection.id, stream.getGroupedContainers());
    if (connection.kind === "api") manager?.setProblem(connection, undefined);
  } catch (err) {
    if (connection.kind === "api" && errorStatus(err) === 401) {
      // The token expired: no labs until the user signs in again.
      forgetConnection(connection.id);
      void manager?.expire(connection);
      return;
    }
    if (connection.kind === "api" && errorStatus(err) === undefined) {
      // The host does not answer; keep the last labs until it is back.
      manager?.setProblem(connection, messageOf(err));
      events.stopEventStreams(connection.id);
      return;
    }
    outputChannel.warn(
      `[inspector] Events stream of ${connection.label} failed: ${messageOf(err)}, falling back to polling`
    );
    pollingConnections.add(connection.id);
    await updateWithPolling(connection);
  }
}

/** How long Local waits before it starts a stopped events stream again. */
const LOCAL_RESTART_DELAY_MS = 2000;

/**
 * Notices running event streams that stop. A lab host that stops streaming
 * shows as not reachable until it answers again; Local starts its stream
 * again after a moment.
 */
export function watchStreamLoss(onLocalRestarted: () => void): () => void {
  let localRestart: ReturnType<typeof setTimeout> | undefined;
  const stopListening = events.onStreamLost((connectionId, error) => {
    const manager = getConnections();
    const connection =
      connectionId === LOCAL_CONNECTION.id ? LOCAL_CONNECTION : manager?.get(connectionId);
    if (!connection) return;
    outputChannel.warn(
      `[inspector] Events stream of ${connection.label} stopped: ${error.message}`
    );
    if (connection.kind === "api") {
      manager?.setProblem(connection, `Lost the connection: ${error.message}`);
      return;
    }
    if (localRestart) clearTimeout(localRestart);
    localRestart = setTimeout(() => {
      localRestart = undefined;
      void update().then(onLocalRestarted, () => {});
    }, LOCAL_RESTART_DELAY_MS);
  });
  return () => {
    stopListening();
    if (localRestart) clearTimeout(localRestart);
  };
}

async function updateWithPolling(connection: LabConnection): Promise<void> {
  const poller = pollerFor(connection);
  await poller.ensure();
  labsByConnection.set(connection.id, poller.getGroupedContainers());
}

/** Updates the running labs of every connection the views show. */
export async function update(): Promise<void> {
  const connections = inspectedConnections();
  const shown = new Set(connections.map((connection) => connection.id));
  for (const connectionId of labsByConnection.keys()) {
    if (!shown.has(connectionId)) forgetConnection(connectionId);
  }
  const start = Date.now();
  await Promise.all(connections.map((connection) => updateConnection(connection)));
  outputChannel.debug(
    `[inspector] Updated ${connections.length} connections in ${((Date.now() - start) / 1000).toFixed(3)}s`
  );
}

export function getInterfacesSnapshot(
  connectionId: string,
  containerShortId: string,
  containerName: string
): ClabInterfaceSnapshot[] {
  if (isPollingMode(connectionId)) {
    // Interfaces come from `containerlab inspect interfaces` on this machine.
    return pollers.get(connectionId)?.getInterfaceSnapshot(containerShortId, containerName) ?? [];
  }
  return events.eventStreamFor(connectionId).getInterfaceSnapshot(containerShortId, containerName);
}

/** Takes the latest labs from the running streams and pollers, without asking the backends. */
export function refreshFromEventStream(): void {
  for (const connection of inspectedConnections()) {
    if (isPollingMode(connection.id)) {
      const poller = pollers.get(connection.id);
      if (poller) labsByConnection.set(connection.id, poller.getGroupedContainers());
    } else {
      labsByConnection.set(
        connection.id,
        events.eventStreamFor(connection.id).getGroupedContainers()
      );
    }
  }
}
