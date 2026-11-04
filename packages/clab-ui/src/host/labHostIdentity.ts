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

/** What each kind of lab host is called. */
export const LAB_HOST_KIND_NAMES: Readonly<Record<LabHostIdentityKind, string>> = {
  "this-computer": "This computer",
  cluster: "Kubernetes",
  server: "API Server"
};

/** What each lab runtime is called. */
export const LAB_RUNTIME_NAMES: Readonly<Record<LabRuntimeKind, string>> = { docker: "Docker", podman: "Podman", c9s: "c9s" };

type KindAndRuntime = Pick<LabHostIdentity, "kind" | "runtime">;

/** The runtime of a lab host: a cluster's is c9s, This computer's Docker unless it says Podman. */
function runtimeOf(host: KindAndRuntime): LabRuntimeKind | undefined {
  if (host.kind === "cluster") return "c9s";
  if (host.kind === "this-computer") return host.runtime === "podman" ? "podman" : "docker";
  return host.runtime;
}

/**
 * A lab host's kind with the runtime that runs its labs, the one label every
 * place uses: "API Server · c9s", "This computer · Podman", "Kubernetes · c9s".
 * An API Server tells its runtime once signed in; until then it is "API Server".
 */
export function labHostKindLabel(host: KindAndRuntime): string {
  const runtime = runtimeOf(host);
  const kind = LAB_HOST_KIND_NAMES[host.kind];
  return runtime ? `${kind} · ${LAB_RUNTIME_NAMES[runtime]}` : kind;
}

/**
 * The tag next to a lab host's name: its kind label, without the kind when
 * the name already says it ("Docker" next to "This computer").
 */
export function labHostTagLabel(host: Pick<LabHostIdentity, "kind" | "label" | "runtime">): string {
  const kind = LAB_HOST_KIND_NAMES[host.kind];
  const runtime = runtimeOf(host);
  if (host.label.trim() === kind && runtime) return LAB_RUNTIME_NAMES[runtime];
  return labHostKindLabel(host);
}

/** Each kind in a few letters, for narrow places. */
const SHORT_KIND_NAMES: Readonly<Record<LabHostIdentityKind, string>> = {
  "this-computer": "This computer",
  cluster: "K8s",
  server: "API"
};

/**
 * The shortest label, for narrow places: "API · c9s", "K8s · c9s", or This
 * computer's runtime ("Docker"); "API Server" while it has not told its runtime.
 */
export function labHostShortLabel(host: KindAndRuntime): string {
  const runtime = runtimeOf(host);
  if (runtime === undefined) return LAB_HOST_KIND_NAMES[host.kind];
  if (host.kind === "this-computer") return LAB_RUNTIME_NAMES[runtime];
  return `${SHORT_KIND_NAMES[host.kind]} · ${LAB_RUNTIME_NAMES[runtime]}`;
}

/** A lab host's kind and runtime as a tag: its text, a shorter one for narrow places, and the full label. */
export interface LabHostTag {
  /** E.g. "API Server · c9s", or "Docker" next to "This computer". */
  label: string;
  /** E.g. "API · c9s": for narrow places. */
  short: string;
  /** E.g. "API Server · c9s", for the tooltip and screen readers. */
  title: string;
}

/** The tag of a lab host next to its name, e.g. at the explorer root. */
export function labHostTag(host: Pick<LabHostIdentity, "kind" | "label" | "runtime">): LabHostTag {
  return { label: labHostTagLabel(host), short: labHostShortLabel(host), title: labHostKindLabel(host) };
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

const KINDS = new Set<string>(Object.keys(LAB_HOST_KIND_NAMES));
const STATUSES = new Set<string>(["connected", "saved", "session_expired", "offline"]);
const RUNTIMES = new Set<string>(Object.keys(LAB_RUNTIME_NAMES));

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
