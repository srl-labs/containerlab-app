import type {
  BuiltImage,
  ImageRecord,
  ImagesConfigSummary,
  ImagesDoctorCheck,
  ImagesIndexInfo,
  ImagesScanFile,
  ImagesTemplateResult
} from "@srl-labs/containerlab-lab-backend";

import { ImagesError } from "./errors.ts";

/** The contract version of `climg` this server understands. */
export const SUPPORTED_CONTRACT = 1;

function incompatible(what: string): ImagesError {
  return new ImagesError(`climg returned unexpected output (${what}); its version may be incompatible`, 502, "incompatible");
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, what: string): Obj {
  if (!isObject(value)) throw incompatible(what);
  return value;
}

function arrayOfObjects(value: unknown, what: string): Obj[] {
  if (!Array.isArray(value) || !value.every(isObject)) throw incompatible(what);
  return value;
}

function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw incompatible(what);
  return value as string[];
}

function string(value: unknown, what: string): string {
  if (typeof value !== "string") throw incompatible(what);
  return value;
}

function number(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw incompatible(what);
  return value;
}

export interface ClimgVersion {
  version: string;
  contract: number;
}

/** `climg 0.1.0 (contract 1)`. */
export function parseVersionLine(output: string): ClimgVersion {
  const match = /^climg\s+(\S+)\s+\(contract\s+(\d+)\)\s*$/m.exec(output);
  if (!match) throw incompatible("--version");
  return { version: match[1], contract: Number(match[2]) };
}

/** The `climg config --json` document, as far as the server uses it. */
export interface ClimgConfigDoc extends ImagesConfigSummary {
  contract: number;
  version: string;
  configFile?: string;
}

export function parseConfig(value: unknown): ClimgConfigDoc {
  const doc = object(value, "config");
  const imagesDirs = strings(doc.images_dirs, "config.images_dirs");
  if (imagesDirs.length === 0) throw incompatible("config.images_dirs is empty");
  return {
    contract: number(doc.contract_version, "config.contract_version"),
    version: string(doc.version, "config.version"),
    ...(typeof doc.config_file === "string" ? { configFile: doc.config_file } : {}),
    imagesDirs,
    stateDir: string(doc.state_dir, "config.state_dir"),
    diskFloorBytes: number(doc.disk_floor_bytes, "config.disk_floor_bytes"),
    maxBuilds: number(doc.max_builds, "config.max_builds"),
    mirrors: strings(doc.mirrors ?? [], "config.mirrors"),
    ...(typeof doc.workspace === "string" ? { workspace: doc.workspace } : {}),
    ...(typeof doc.nodetpl_file === "string" ? { nodetplFile: doc.nodetpl_file } : {}),
    ...(typeof doc.nodetpl_writer === "string" ? { nodetplWriter: doc.nodetpl_writer } : {}),
    credentialsSet: doc.credentials_set === true
  };
}

export function parseDoctor(value: unknown): ImagesDoctorCheck[] {
  return arrayOfObjects(value, "doctor").map((row) => ({
    check: string(row.check, "doctor.check"),
    status: string(row.status, "doctor.status"),
    detail: typeof row.detail === "string" ? row.detail : ""
  }));
}

/** `vendors` of `climg index --json`; entries that do not fit are dropped, absent for an older `climg`. */
function vendorCounts(value: unknown): ImagesIndexInfo["vendors"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((row) =>
    isObject(row) && typeof row.vendor === "string" && typeof row.entries === "number" && typeof row.buildable === "number"
      ? [{ vendor: row.vendor, entries: row.entries, buildable: row.buildable }]
      : []
  );
}

export function parseIndex(value: unknown): ImagesIndexInfo {
  const { vendors, ...rest } = object(value, "index");
  const parsed = vendorCounts(vendors);
  return { ...rest, ...(parsed ? { vendors: parsed } : {}) } as ImagesIndexInfo;
}

/** The optional `vendor`, `folder` and `model` strings of a record: kept when text or null, dropped otherwise. */
function recordOf(row: Obj): ImageRecord {
  string(row.key, "record.key");
  string(row.status, "record.status");
  const record: Obj = { ...row };
  for (const field of ["vendor", "folder", "model"]) {
    if (field in record && record[field] !== null && typeof record[field] !== "string") delete record[field];
  }
  return record as ImageRecord;
}

export function parseRecords(value: unknown): ImageRecord[] {
  return arrayOfObjects(value, "records").map(recordOf);
}

export function parseRecord(value: unknown): ImageRecord {
  return recordOf(object(value, "record"));
}

export function parseBuiltImages(value: unknown): BuiltImage[] {
  return arrayOfObjects(value, "images").map((row) => {
    string(row.tag, "image.tag");
    return row as BuiltImage;
  });
}

export function parseScan(value: unknown): ImagesScanFile[] {
  return arrayOfObjects(value, "scan").map((row) => {
    string(row.path, "scan.path");
    number(row.size, "scan.size");
    string(row.status, "scan.status");
    return row as unknown as ImagesScanFile;
  });
}

export interface NodetplRow {
  name: string;
  kind: string;
  image?: string;
  icon?: string;
  owned: boolean;
  /** Owned by climg and edited by the user; absent for a climg that does not report it. */
  customized?: boolean;
}

export function parseNodetplList(value: unknown): NodetplRow[] {
  return arrayOfObjects(value, "nodetpl list").map((row) => ({
    name: string(row.name, "template.name"),
    kind: typeof row.kind === "string" ? row.kind : "",
    ...(typeof row.image === "string" ? { image: row.image } : {}),
    ...(typeof row.icon === "string" ? { icon: row.icon } : {}),
    owned: row.owned === true,
    ...(typeof row.customized === "boolean" ? { customized: row.customized } : {})
  }));
}

/** A `kept` list of strings; undefined when absent, empty or not a list (an older `climg`). */
export function keptList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value.length > 0 ? (value as string[]) : undefined;
}

/** The fields kept by the `updated` change of a `nodetpl` result, if `climg` reports any. */
export function keptFields(changes: readonly unknown[]): string[] | undefined {
  for (const change of changes) {
    if (isObject(change) && change.action === "updated") {
      const kept = keptList(change.kept);
      if (kept) return kept;
    }
  }
  return undefined;
}

export function parseTemplateResult(value: unknown): ImagesTemplateResult {
  const doc = object(value, "nodetpl result");
  string(doc.action, "nodetpl.action");
  for (const key of ["changes", "skipped", "added", "updated", "removed"]) {
    if (!Array.isArray(doc[key])) throw incompatible(`nodetpl.${key}`);
  }
  return doc as ImagesTemplateResult;
}

/** The progress document `climg --job-file` rewrites. */
export interface ClimgJobDoc {
  state: string;
  phase: string;
  pct: number | null;
  message: string;
  log: string[];
  result?: unknown;
}

export function parseJobDoc(value: unknown): ClimgJobDoc | undefined {
  if (!isObject(value) || typeof value.state !== "string") return undefined;
  return {
    state: value.state,
    phase: typeof value.phase === "string" ? value.phase : "",
    pct: typeof value.pct === "number" && Number.isFinite(value.pct) ? value.pct : null,
    message: typeof value.message === "string" ? value.message : "",
    log: Array.isArray(value.log) ? value.log.map((line) => String(line)) : [],
    ...(value.result !== undefined ? { result: value.result } : {})
  };
}

export function isObjectValue(value: unknown): value is Obj {
  return isObject(value);
}
