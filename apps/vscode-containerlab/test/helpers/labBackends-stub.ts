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

export function labTargetForPath(labPath: string, labName = ""): LabTarget {
  return { labName, path: labPath };
}

export function labNameForPath(labPath: string): string {
  return path.basename(labPath).replace(/\.clab\.ya?ml$/i, "");
}
