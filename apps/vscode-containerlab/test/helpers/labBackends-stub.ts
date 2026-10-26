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

/** Whether the backend reports node usage, and the samples `streamLabStats` yields. */
export let nodeStats: { supported: boolean; samples: unknown[] } = { supported: true, samples: [] };

export function setNodeStats(next: { supported: boolean; samples: unknown[] }): void {
  nodeStats = next;
}

export function reset(): void {
  calls.length = 0;
  lifecycleEvents = [{ type: "done" }];
  shareSessions.sshx = [];
  shareSessions.gotty = [];
  nodeStats = { supported: true, samples: [] };
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
  },
  async netemSet(...args: unknown[]) {
    record("netemSet", args);
  },
  async netemReset(...args: unknown[]) {
    record("netemReset", args);
  },
  async features() {
    return { nodeStats: nodeStats.supported, terminalResume: true };
  },
  async streamLabStats(labName: string, options: { signal: AbortSignal }) {
    record("streamLabStats", [labName]);
    const { samples } = nodeStats;
    return (async function* () {
      yield* samples;
      // A live stream stays open until the caller stops it.
      await new Promise((resolve) =>
        options.signal.addEventListener("abort", resolve, { once: true })
      );
    })();
  }
};

const LOCAL = { id: "local", label: "Local", kind: "local" as const };

export function getLocalBackend() {
  return backend;
}

export function backendFor() {
  return backend;
}

export function backendOf() {
  return backend;
}

export function connectionOf() {
  return LOCAL;
}

export function connectionById() {
  return LOCAL;
}

export function isRemote(): boolean {
  return false;
}

export async function pickConnection() {
  return LOCAL;
}

export function getConnections(): undefined {
  return undefined;
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

export async function resolveLab(labPath: string, labName?: string, connectionId?: string) {
  record("resolveLab", [labPath, labName, connectionId]);
  return { backend, target: { labName: "", path: labPath } as LabTarget };
}

export function labNameForPath(labPath: string): string {
  return path.basename(labPath).replace(/\.clab\.ya?ml$/i, "");
}

export function viewLabPath(_connection: unknown, labPath: string): string {
  return labPath;
}
