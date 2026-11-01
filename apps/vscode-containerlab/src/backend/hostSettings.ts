/**
 * Where the settings of each lab host live. This computer keeps the
 * extension's settings of old (`containerlab.runtime`, `binaryPath`,
 * `capture.*`, ...), so existing configurations keep working; a Kubernetes
 * lab host and an API Server keep theirs in their `containerlab.connections`
 * entry. The settings page shows them per host (`hostSettingRows`) and
 * changes one at a time (`hostSettingUpdate`).
 */
import {
  CAPTURE_METHOD_LABELS,
  containerlabDefaultTimeout,
  parseCaptureMethod,
  type LabHostSettingId,
  type LabHostSettingRow,
  type LabHostSettingRows,
  type LabHostSettingValue,
  type LabHostSettingsKind
} from "@containerlab/clab-ui/host";

/** This computer's settings: the keys under `containerlab.`. */
const THIS_COMPUTER_KEYS: Partial<Record<LabHostSettingId, string>> = {
  runtime: "runtime",
  socket: "dockerSocketPath",
  binaryPath: "binaryPath",
  timeout: "deploy.timeout",
  deployArgs: "deploy.extraArgs",
  destroyArgs: "destroy.extraArgs",
  captureMethod: "capture.preferredAction",
  wiresharkImage: "capture.wireshark.dockerImage",
  wiresharkPullPolicy: "capture.wireshark.pullPolicy",
  vncHostname: "capture.wireshark.vncCaptureHostname",
  captureHostname: "capture.remoteHostname",
  packetflixPort: "capture.packetflixPort",
  edgesharkEnv: "capture.edgeshark.extraEnvironmentVars"
};

/** A Kubernetes lab host's settings: fields of its `containerlab.connections` entry. */
const CLUSTER_FIELDS: Partial<Record<LabHostSettingId, string>> = {
  timeout: "deployTimeout",
  exposeType: "exposeType",
  persistence: "persistence",
  imagePullSecret: "imagePullSecret",
  noTopologyCR: "noTopologyCR",
  deployArgs: "deployExtraArgs",
  destroyArgs: "destroyExtraArgs",
  captureMethod: "captureMethod",
  wiresharkImage: "wiresharkImage"
};

/** An API Server's settings: fields of its entry. The rest it sets itself. */
const SERVER_FIELDS: Partial<Record<LabHostSettingId, string>> = {
  captureMethod: "captureMethod"
};

const DEFAULT_WIRESHARK_IMAGE = "ghcr.io/srl-labs/wireshark-vnc-docker:latest";

/** Where a setting of a lab host kind is kept; undefined where it has none here. */
export function hostSettingKey(
  kind: LabHostSettingsKind,
  id: LabHostSettingId
): string | undefined {
  if (kind === "this-computer") return THIS_COMPUTER_KEYS[id];
  return (kind === "cluster" ? CLUSTER_FIELDS : SERVER_FIELDS)[id];
}

/** A configuration value as the settings page edits it: capture methods by id. */
function toRowValue(id: LabHostSettingId, value: unknown): LabHostSettingValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (id === "captureMethod") return parseCaptureMethod(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  return undefined;
}

/** A value from the settings page as it is stored: capture methods by label, like the setting's enum. */
export function toStoredValue(
  id: LabHostSettingId,
  value: LabHostSettingValue | undefined
): unknown {
  if (value === undefined) return undefined;
  if (id === "captureMethod") return CAPTURE_METHOD_LABELS[parseCaptureMethod(value)];
  if (id === "packetflixPort") return Number(value);
  return typeof value === "string" ? value.trim() : value;
}

function shownDefault(id: LabHostSettingId, value: unknown, kind: LabHostSettingsKind): string {
  if (id === "captureMethod") return CAPTURE_METHOD_LABELS[parseCaptureMethod(value)];
  if (id === "binaryPath" && (value === "" || value === undefined)) return "containerlab on PATH";
  if (id === "captureHostname" && (value === "" || value === undefined))
    return "Found automatically";
  if (id === "vncHostname" && (value === "" || value === undefined)) return "localhost";
  if (id === "timeout")
    return `${containerlabDefaultTimeout(kind === "cluster" ? "c9s" : "docker")} (containerlab default)`;
  if (id === "runtime") return value === "podman" ? "Podman" : "Docker";
  if (value === "" || value === undefined) return "None";
  return String(value);
}

/** What VS Code knows about one setting of `containerlab.`: the user's value and the default. */
export interface InspectedSetting {
  /** The user (global) value; undefined when the user set none. */
  userValue?: unknown;
  defaultValue?: unknown;
}

/** This computer's rows: its global settings, "changed" where the user set them. */
export function thisComputerRows(inspect: (key: string) => InspectedSetting): LabHostSettingRows {
  const rows: LabHostSettingRows = {};
  for (const [id, key] of Object.entries(THIS_COMPUTER_KEYS) as [LabHostSettingId, string][]) {
    const inspected = inspect(key);
    const value = toRowValue(id, inspected.userValue);
    rows[id] = {
      ...(value !== undefined ? { value } : {}),
      defaultLabel: shownDefault(id, inspected.defaultValue, "this-computer")
    };
  }
  return rows;
}

const CLUSTER_DEFAULTS: Partial<Record<LabHostSettingId, string>> = {
  exposeType: "clabernetes default",
  persistence: "On",
  imagePullSecret: "None",
  noTopologyCR: "Off",
  deployArgs: "None",
  destroyArgs: "None",
  captureMethod: "Automatic",
  wiresharkImage: DEFAULT_WIRESHARK_IMAGE
};

/**
 * A Kubernetes lab host's or an API Server's rows from its entry. A
 * cluster's containerlab is This computer's: its path shows read-only.
 */
export function entryRows(
  kind: "cluster" | "server",
  entry: Record<string, unknown> | undefined,
  context: { binaryPath?: string } = {}
): LabHostSettingRows {
  const rows: LabHostSettingRows = {};
  const fields = kind === "cluster" ? CLUSTER_FIELDS : SERVER_FIELDS;
  for (const [id, field] of Object.entries(fields) as [LabHostSettingId, string][]) {
    const value = toRowValue(id, entry?.[field]);
    const row: LabHostSettingRow = {
      defaultLabel:
        id === "timeout" ? shownDefault(id, undefined, kind) : (CLUSTER_DEFAULTS[id] ?? "None")
    };
    // Persistence is on unless false; only the change from the default is kept.
    if (value !== undefined && !(id === "persistence" && value === true)) row.value = value;
    rows[id] = row;
  }
  if (kind === "cluster") rows.binaryPath = { shown: context.binaryPath || "containerlab on PATH" };
  return rows;
}

/** The setting values that applied to every lab host before each kept its own. */
export interface LegacyHostSettings {
  deployArgs?: string;
  destroyArgs?: string;
  captureMethod?: string;
  wiresharkImage?: string;
}

const LEGACY_FIELDS: Record<
  keyof LegacyHostSettings,
  { field: string; cluster: boolean; server: boolean }
> = {
  deployArgs: { field: "deployExtraArgs", cluster: true, server: false },
  destroyArgs: { field: "destroyExtraArgs", cluster: true, server: false },
  captureMethod: { field: "captureMethod", cluster: true, server: true },
  wiresharkImage: { field: "wiresharkImage", cluster: true, server: false }
};

/**
 * Earlier builds applied `deploy.extraArgs`, `destroy.extraArgs`,
 * `capture.preferredAction` and the Wireshark VNC image to every lab host
 * they meant something to.
 * Now they are This computer's, and each Kubernetes lab host and API Server
 * has its own: the values the user set are copied once into the entries they
 * applied to, unless an entry has its own. Undefined when nothing changes.
 */
export function migrateConnectionEntries(
  entries: readonly unknown[],
  legacy: LegacyHostSettings,
  isCluster: (entry: Record<string, unknown>) => boolean
): unknown[] | undefined {
  const values = Object.entries(legacy).filter(
    ([, value]) => typeof value === "string" && value.trim() !== ""
  ) as [keyof LegacyHostSettings, string][];
  if (values.length === 0) return undefined;
  let changed = false;
  const next = entries.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
    const entry = raw as Record<string, unknown>;
    const cluster = isCluster(entry);
    const server = !cluster && typeof entry.url === "string";
    if (!cluster && !server) return raw;
    const copy = { ...entry };
    for (const [key, value] of values) {
      const target = LEGACY_FIELDS[key];
      if ((cluster ? target.cluster : target.server) && copy[target.field] === undefined) {
        copy[target.field] = value.trim();
        changed = true;
      }
    }
    return copy;
  });
  return changed ? next : undefined;
}

/**
 * A connection entry with one setting changed; `undefined` removes it, so the
 * host follows the default again.
 */
export function withEntrySetting(
  entry: Record<string, unknown>,
  field: string,
  value: unknown
): Record<string, unknown> {
  const next = { ...entry };
  if (value === undefined || value === "" || (field === "persistence" && value === true))
    delete next[field];
  else next[field] = value;
  return next;
}
