import * as vscode from "vscode";
import type { LabHostsSnapshot } from "@containerlab/clab-ui/settings/schema";

import { backendFor, connectionById, getConnections } from "../../backend/labBackends";
import {
  DEFAULT_SESSION_DURATION,
  type ConnectionManager,
  type LabConnection
} from "../../backend/connections";

/** Local and the lab hosts, for the Lab Hosts page of the settings. */
export function labHostsSnapshot(): LabHostsSnapshot | undefined {
  const connections = getConnections();
  if (!connections) return undefined;
  const local = connections.local;
  return {
    hosts: connections.list().map((connection) => {
      const status = connections.status(connection);
      return {
        id: connection.id,
        kind: connection.kind,
        url: connection.url ?? "",
        label: connection.label,
        username:
          connection.kind === "local" ? (local?.username ?? "") : (connection.username ?? ""),
        sessionDuration:
          connection.kind === "local"
            ? ""
            : (connection.sessionDuration ?? DEFAULT_SESSION_DURATION),
        status,
        connected: status === "connected"
      };
    }),
    ...(connections.localAvailable
      ? {
          local: {
            shown: connections.list().some((connection) => connection.kind === "local"),
            available: local?.available ?? true,
            problems: local?.problems ?? [],
            ...(local?.containerlabVersion !== undefined
              ? { containerlabVersion: local.containerlabVersion }
              : {})
          }
        }
      : {})
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function labHost(payload: Record<string, unknown>): LabConnection {
  const connection = connectionById(text(payload.endpointId));
  if (!connection) throw new Error("This lab host is no longer configured.");
  return connection;
}

function password(payload: Record<string, unknown>): string {
  return typeof payload.password === "string" ? payload.password : "";
}

type LabHostsAction = (
  connections: ConnectionManager,
  payload: Record<string, unknown>
) => Promise<unknown>;

/** What each button of the Lab Hosts page does. */
const ACTIONS: Record<string, LabHostsAction> = {
  "labHosts.add": async (connections, payload) => {
    await connections.addAndSignIn({
      url: text(payload.url),
      label: text(payload.label),
      username: text(payload.username),
      password: password(payload),
      sessionDuration: text(payload.sessionDuration)
    });
  },
  "labHosts.signIn": async (connections, payload) => {
    await connections.signIn(labHost(payload), text(payload.username), password(payload));
  },
  "labHosts.signOut": async (connections, payload) => {
    await connections.signOut(labHost(payload));
  },
  "labHosts.update": async (connections, payload) => {
    const connection = labHost(payload);
    if (connection.kind === "local") return;
    await connections.updateConnection(connection, {
      label: text(payload.label) || connection.label,
      url: text(payload.url) || (connection.url ?? ""),
      username:
        payload.username !== undefined ? text(payload.username) : (connection.username ?? ""),
      sessionDuration:
        payload.sessionDuration !== undefined
          ? text(payload.sessionDuration)
          : connection.sessionDuration
    });
  },
  "labHosts.remove": async (connections, payload) => {
    const connection = labHost(payload);
    if (connection.kind === "local") await connections.setLocalEnabled(false);
    else await connections.removeConnection(connection);
  },
  "labHosts.showLocal": async (connections) => {
    await connections.setLocalEnabled(true);
  },
  "labHosts.checkLocal": async () => {
    await vscode.commands.executeCommand("containerlab.connection.checkLocal", { quiet: true });
  },
  // Health stats answer with their metrics.
  "labHosts.metrics": async (_connections, payload) => backendFor(labHost(payload)).healthMetrics()
};

/** Whether a settings request belongs to the Lab Hosts page. */
export function isLabHostsAction(action: unknown): boolean {
  return typeof action === "string" && action in ACTIONS;
}

/**
 * Runs an action of the Lab Hosts page. Health stats answer with their
 * metrics; every other action with undefined, and the page gets the new
 * settings snapshot.
 */
export async function handleLabHostsAction(payload: Record<string, unknown>): Promise<unknown> {
  const connections = getConnections();
  if (!connections) throw new Error("Containerlab is not ready yet.");
  const action = typeof payload.action === "string" ? ACTIONS[payload.action] : undefined;
  if (!action) throw new Error("Unsupported lab host action.");
  return action(connections, payload);
}
