import type { TopologyRef } from "../../session";
import { classifyNodeReadiness } from "../../topology/runtime";
import type { ContainerState } from "../types";

/** A lab card's state: how its containers run, or a topology file nobody deployed. */
export type LabRunState = "running" | "partial" | "stopped" | "failed" | "undeployed";

/** One node of a running lab, as the card's thumbnail colors it. */
export type LabNodeRunState = "ready" | "starting" | "down";

export interface LabOverviewCard {
  /** `${endpointId}::${path}`, the same identity as the lab's document tab. */
  id: string;
  endpointId: string;
  endpointLabel: string;
  name: string;
  /** The running lab's name on its lab host; missing for topology files nobody deployed. */
  labName?: string;
  /** The topology file; missing for running labs without one, such as other users' labs. */
  path?: string;
  annotationsPath?: string;
  topologyRef?: TopologyRef;
  owner?: string;
  /** Lives in the shared workspace that every user of the lab host can edit. */
  shared: boolean;
  state: LabRunState;
  nodeCount: number;
  readyCount: number;
  nodes: Record<string, LabNodeRunState>;
  /** Estimated start of the oldest container, with the precision Docker reported it in. */
  startedAt?: number;
  uptimePrecisionMs?: number;
  canDeploy: boolean;
  canDestroy: boolean;
  /** A link that opens this lab, when the lab has a topology file. */
  link?: string;
}

export interface LabThumbnailSources {
  yaml: string;
  annotations?: string;
}

type ContainerRuntime = Pick<ContainerState, "state" | "status">;

function isRunningContainer(container: ContainerRuntime): boolean {
  return container.state.trim().toLowerCase() === "running";
}

/** A running node whose health check, if it has one, passed; the canvas decides the same way. */
export function isContainerReady(container: ContainerRuntime): boolean {
  return classifyNodeReadiness(container) === "ready";
}

export function labNodeRunState(container: ContainerRuntime): LabNodeRunState {
  switch (classifyNodeReadiness(container)) {
    case "ready":
      return "ready";
    case "starting":
    case "unhealthy":
      return "starting";
    default:
      return "down";
  }
}

function exitedWithError(container: ContainerRuntime): boolean {
  if (container.state.trim().toLowerCase() === "dead") return true;
  const code = /exited \((\d+)\)/i.exec(container.status)?.[1];
  return code !== undefined && code !== "0";
}

export function labRunState(containers: Iterable<ContainerRuntime>): LabRunState {
  let total = 0;
  let running = 0;
  let failed = false;
  for (const container of containers) {
    total += 1;
    if (isRunningContainer(container)) running += 1;
    else if (exitedWithError(container)) failed = true;
  }
  if (total > 0 && running === total) return "running";
  if (running > 0) return "partial";
  return failed ? "failed" : "stopped";
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UNITS: Record<string, number> = {
  second: SECOND, minute: MINUTE, hour: HOUR, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY
};

/**
 * How long a container has been up, from Docker's status text such as "Up 5 minutes (healthy)".
 * Docker rounds down to the largest unit, so the result is a lower bound with that unit's precision.
 */
export function parseDockerUptime(status: string): { ms: number; precisionMs: number } | undefined {
  const text = /^up\s+(.+?)(?:\s+\(.*\))?$/i.exec(status.trim())?.[1]?.toLowerCase();
  if (!text) return undefined;
  if (text === "less than a second") return { ms: 0, precisionMs: SECOND };
  const about = /^about an? (minute|hour)$/.exec(text);
  if (about) return { ms: UNITS[about[1]], precisionMs: UNITS[about[1]] };
  const counted = /^(\d+) (second|minute|hour|day|week|month|year)s?$/.exec(text);
  if (!counted) return undefined;
  const unit = UNITS[counted[2]];
  return { ms: Number(counted[1]) * unit, precisionMs: unit };
}

/** "2 h 16 min", never finer than the precision the duration is known in. */
export function formatLabUptime(ms: number, precisionMs = MINUTE): string {
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return precisionMs <= HOUR && hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return precisionMs <= MINUTE && minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return minutes > 0 ? `${minutes} min` : "<1 min";
}

export const LAB_RUN_STATE_LABELS: Record<LabRunState, string> = {
  running: "Running",
  partial: "Partially running",
  stopped: "Stopped",
  failed: "Failed",
  undeployed: "Not deployed"
};
