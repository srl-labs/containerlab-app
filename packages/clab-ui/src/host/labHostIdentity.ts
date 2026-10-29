/**
 * Which lab host a topology belongs to, as the hosts hand it to the topology
 * view with its runtime and support: the toolbar names it, and a click opens
 * its settings.
 */
import type { LabRuntimeKind } from "./lifecycleOptions";

export type LabHostIdentityKind = "this-computer" | "cluster" | "server";

export type LabHostIdentityStatus = "connected" | "saved" | "session_expired" | "offline";

export interface LabHostIdentity {
  /** The lab host's id, as the settings and the explorer know it. */
  id: string;
  label: string;
  kind: LabHostIdentityKind;
  runtime?: LabRuntimeKind;
  status?: LabHostIdentityStatus;
  /** Where labs go, e.g. "Context kind-c9s-app", "Namespace c9s-<lab>", "http://host:8090 as alice". */
  details?: string[];
}

const KIND_LABELS: Record<LabHostIdentityKind, string> = {
  "this-computer": "This computer",
  cluster: "Kubernetes",
  server: "API Server"
};

const RUNTIME_LABELS: Record<LabRuntimeKind, string> = { docker: "Docker", podman: "Podman", c9s: "c9s" };

/**
 * The kind of a lab host for its tag, e.g. "Kubernetes" or "API Server"; with
 * `runtime`, the runtime too where it adds something ("API Server · c9s").
 * This computer, whose name is its kind, shows its runtime instead.
 */
export function labHostIdentityKindLabel(host: Pick<LabHostIdentity, "kind" | "label" | "runtime">, runtime = false): string {
  const kind = KIND_LABELS[host.kind];
  const runtimeLabel = host.runtime !== undefined && host.kind !== "cluster" ? RUNTIME_LABELS[host.runtime] : undefined;
  if (host.kind === "this-computer" && host.label === kind) return runtimeLabel ?? "Docker";
  return runtime && runtimeLabel ? `${kind} · ${runtimeLabel}` : kind;
}

/** What is wrong with a lab host in a few words; undefined when it is ready. */
export function labHostStatusWord(host: Pick<LabHostIdentity, "kind" | "status">): string | undefined {
  switch (host.status) {
    case "saved":
      return "Signed out";
    case "session_expired":
      return "Session expired";
    case "offline":
      return host.kind === "server" ? "Unreachable" : "Not ready";
    default:
      return undefined;
  }
}

const KINDS = new Set<string>(Object.keys(KIND_LABELS));
const STATUSES = new Set<string>(["connected", "saved", "session_expired", "offline"]);
const RUNTIMES = new Set<string>(Object.keys(RUNTIME_LABELS));

/** A lab host identity from a host transport; undefined when it is missing or malformed. */
export function parseLabHostIdentity(value: unknown): LabHostIdentity | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.label !== "string" || !KINDS.has(String(raw.kind))) return undefined;
  const identity: LabHostIdentity = { id: raw.id, label: raw.label, kind: raw.kind as LabHostIdentityKind };
  if (RUNTIMES.has(String(raw.runtime))) identity.runtime = raw.runtime as LabRuntimeKind;
  if (STATUSES.has(String(raw.status))) identity.status = raw.status as LabHostIdentityStatus;
  if (Array.isArray(raw.details)) {
    const details = raw.details.filter((line): line is string => typeof line === "string" && line.trim() !== "");
    if (details.length > 0) identity.details = details;
  }
  return identity;
}
