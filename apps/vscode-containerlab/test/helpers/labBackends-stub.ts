import * as path from "path";

import type { LabTarget, LifecycleStreamEvent } from "@srl-labs/containerlab-lab-backend";

/** Calls the extension made on the lab backend, in order. */
export const calls: { method: string; args: unknown[] }[] = [];

/** Events the next lifecycle stream yields. */
export let lifecycleEvents: LifecycleStreamEvent[] = [{ type: "done" }];
/** Sessions `listShareSessions` returns, per tool. */
export const shareSessions: Record<string, unknown[]> = { sshx: [], gotty: [] };

export function setLifecycleEvents(events: LifecycleStreamEvent[]): void {
  lifecycleEvents = events;
}

export function reset(): void {
  calls.length = 0;
  lifecycleEvents = [{ type: "done" }];
  shareSessions.sshx = [];
  shareSessions.gotty = [];
}

function record(method: string, args: unknown[]): void {
  calls.push({ method, args });
}

const backend = {
  kind: "local" as const,
  scope: "local:/test",
  async streamLifecycle(...args: unknown[]) {
    record("streamLifecycle", args);
    const events = lifecycleEvents;
    return (async function* () {
      yield* events;
    })();
  },
  async runLifecycle(...args: unknown[]) {
    record("runLifecycle", args);
    return { result: { dryRun: true }, logs: [] };
  },
  async listShareSessions(tool: string) {
    record("listShareSessions", [tool]);
    return shareSessions[tool] ?? [];
  },
  commandLine(args: string[]) {
    return ["containerlab", ...args].join(" ");
  }
};

export function getLabBackend() {
  return backend;
}

export function getLocalBackend() {
  return backend;
}

export function isRemoteActive(): boolean {
  return false;
}

export function getConnections(): undefined {
  return undefined;
}

export function activeConnection() {
  return { id: "local", label: "Local", kind: "local" as const };
}

export function isUriString(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

export function isLabSourceUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function labPathOf(uri: { scheme: string; fsPath: string; toString(): string }): string {
  return uri.scheme === "file" ? uri.fsPath : uri.toString();
}

export async function resolveLab(labPath: string, labName?: string) {
  record("resolveLab", [labPath, labName]);
  return { backend, target: { labName: "", path: labPath } as LabTarget };
}

export function labNameForPath(labPath: string): string {
  return path.basename(labPath).replace(/\.clab\.ya?ml$/i, "");
}
