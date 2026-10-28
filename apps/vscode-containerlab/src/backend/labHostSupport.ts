import * as vscode from "vscode";
import {
  describeLabHost,
  type LabHostInfo,
  type LabHostSupport
} from "@srl-labs/containerlab-lab-backend";

import type { LabConnection } from "./connections";
import { backendFor } from "./labBackends";

/** Lab hosts get upgraded in place; ask again after a minute. */
const HOST_INFO_TTL_MS = 60_000;

const cache = new Map<string, { at: number; info: LabHostInfo }>();
const pending = new Map<string, Promise<LabHostInfo | undefined>>();
const changeEmitter = new vscode.EventEmitter<string>();

/** Fires with a connection id when its lab host info arrives. */
export const onDidChangeLabHostInfo = changeEmitter.event;

/** The runtime and support of a connection's lab host, once known; asks for it otherwise. */
export function cachedLabHostInfo(connection: LabConnection): LabHostInfo | undefined {
  const cached = cache.get(connection.id);
  if (!cached || Date.now() - cached.at > HOST_INFO_TTL_MS) void loadLabHostInfo(connection);
  return cached?.info;
}

/** The runtime and support of a connection's lab host; undefined while it cannot be asked. */
function loadLabHostInfo(connection: LabConnection): Promise<LabHostInfo | undefined> {
  const cached = cache.get(connection.id);
  if (cached && Date.now() - cached.at <= HOST_INFO_TTL_MS) return Promise.resolve(cached.info);
  let request = pending.get(connection.id);
  if (!request) {
    request = Promise.resolve()
      .then(() => describeLabHost(backendFor(connection)))
      .then(
        (info) => {
          const changed = JSON.stringify(cache.get(connection.id)?.info) !== JSON.stringify(info);
          cache.set(connection.id, { at: Date.now(), info });
          if (changed) changeEmitter.fire(connection.id);
          return info;
        },
        () => cached?.info
      )
      .finally(() => pending.delete(connection.id));
    pending.set(connection.id, request);
  }
  return request;
}

/**
 * Whether the connection's lab host can run an action; shows why not when
 * it cannot. A host that cannot be asked is let through: it refuses itself.
 */
export async function ensureHostSupports(
  connection: LabConnection,
  flag: keyof LabHostSupport,
  action: string
): Promise<boolean> {
  const info = await loadLabHostInfo(connection);
  if (!info || info.support[flag]) return true;
  const runtime = info.profile.runtime === "c9s" ? "Kubernetes (c9s)" : info.profile.runtime;
  void vscode.window.showWarningMessage(
    `${action} is not available on ${connection.label}, which runs labs on ${runtime}.`
  );
  return false;
}
