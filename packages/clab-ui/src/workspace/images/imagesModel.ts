// Pure helpers of the Images view: how records are addressed, which host checks
// block which action, and the numbers the confirmations show.
import type { ImageRecord, ImagesDoctorCheck, ImagesIndexInfo, ImagesJob, ImagesTemplate, ImagesUnavailableInfo } from "./types";

// The server's allow patterns (design D6); the view never sends what they refuse.
const REF = /^(labhub:|local:)?[A-Za-z0-9#][A-Za-z0-9._@#+-]{0,199}$/;
const DOCKER_REFERENCE =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::\d{1,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,250}$/;
const KIND = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const isValidVersion = (value: string): boolean => VERSION.test(value);
export const isValidKind = (value: string): boolean => KIND.test(value);
export const isValidTag = (value: string): boolean => value.length <= 255 && DOCKER_REFERENCE.test(value);

/**
 * How the server is asked about a record: its key, or `#<id>` for a LabHub entry
 * whose name the key cannot carry (names may contain spaces), or its docker tag.
 * Undefined when nothing safe addresses it; its actions are then off.
 */
export function recordRef(record: ImageRecord): string | undefined {
  if (REF.test(record.key)) return record.key;
  // `#id` indexes the QEMU entries first: other sections reuse those ids, so they must not be addressed this way.
  if (record.source === "labhub" && record.section === "QEMU" && typeof record.id === "number") return `#${record.id}`;
  if (typeof record.tag === "string" && DOCKER_REFERENCE.test(record.tag)) return record.tag;
  return undefined;
}

/** The display name of a record: its LabHub or file name, else the key without its source. */
export function recordName(record: ImageRecord): string {
  if (typeof record.name === "string" && record.name) return record.name;
  return record.key.replace(/^(labhub|local):/, "");
}

/** The image file of a local record, as a build job names it. */
export function localFileName(record: ImageRecord): string | undefined {
  if (record.source !== "local") return undefined;
  const fromPath = typeof record.path === "string" ? record.path.split("/").pop() : undefined;
  const name = fromPath ?? record.key.replace(/^local:/, "");
  return FILE_NAME.test(name) && !name.includes("..") ? name : undefined;
}

/** The tag a built record runs as, preferring the one `show` found on the host. */
export function builtTag(record: ImageRecord): string | undefined {
  if (typeof record.built_tag === "string" && record.built_tag) return record.built_tag;
  if (record.status === "built" && typeof record.detail === "string" && record.detail.includes(":")) return record.detail;
  return typeof record.tag === "string" ? record.tag : undefined;
}

const vendorOfKind = (kind: string): string => kind.split("_", 1)[0] ?? kind;

/** The vendor a record carries; absent for an older `climg` or a record without one. */
export const recordVendor = (record: ImageRecord): string | undefined =>
  typeof record.vendor === "string" && record.vendor !== "" ? record.vendor : undefined;

export const recordFolder = (record: ImageRecord): string | undefined =>
  typeof record.folder === "string" && record.folder !== "" ? record.folder : undefined;

/** An entry no vrnetlab kind exists for: it is listed and findable, but cannot be pulled or built. */
export const isUnbuildable = (record: ImageRecord): boolean => record.status === "unbuildable";

/** Buildable records first, each group in the order `climg` listed them. */
export function sortRecords(records: readonly ImageRecord[]): ImageRecord[] {
  return [...records.filter((record) => !isUnbuildable(record)), ...records.filter(isUnbuildable)];
}

/**
 * The vendors the filter offers: the index's list when `climg` reports one, else the vendors of the
 * records seen, else (an older `climg`) the first part of their kinds.
 */
export function vendorOptions(index: ImagesIndexInfo | undefined, seen: readonly string[], kinds: readonly string[]): string[] {
  const fromIndex = (index?.vendors ?? []).map((entry) => entry.vendor);
  let names = fromIndex;
  if (names.length === 0) names = [...seen];
  if (names.length === 0) names = kinds.map(vendorOfKind);
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

/** Running jobs first, then the queue in order, then ended jobs newest first. */
export function sortJobs<T extends Pick<ImagesJob, "state" | "queuePosition" | "startedAt">>(jobs: readonly T[]): T[] {
  const rank = (job: T) => ({ running: 0, queued: 1 })[job.state as "running" | "queued"] ?? 2;
  return [...jobs].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;
    if (rank(left) === 1) return (left.queuePosition ?? Number.MAX_SAFE_INTEGER) - (right.queuePosition ?? Number.MAX_SAFE_INTEGER);
    return right.startedAt.localeCompare(left.startedAt);
  });
}

/** `Next` for the job at the head of the queue, `N in line` behind it; undefined when the server gave no place. */
export function queueText(job: Pick<ImagesJob, "state" | "queuePosition">): string | undefined {
  if (job.state !== "queued" || job.queuePosition === undefined) return undefined;
  return job.queuePosition <= 1 ? "Queued · Next" : `Queued · ${job.queuePosition} in line`;
}

export function canPull(record: ImageRecord): boolean {
  return record.source === "labhub" && (record.status === "available" || record.status === "cached" || record.status === "built");
}

export function canBuild(record: ImageRecord): boolean {
  return record.source === "local" && record.status === "cached" && localFileName(record) !== undefined;
}

export type ImagesAction = "pull" | "build" | "upload" | "templates";

/** The host checks each action needs; a check that reports FAIL turns the action off. */
const ACTION_CHECKS: Record<ImagesAction, readonly string[]> = {
  pull: ["docker", "/dev/kvm", "vrnetlab", "make", "disk", "state dir", "labhub index"],
  build: ["docker", "/dev/kvm", "vrnetlab", "make", "disk", "state dir"],
  upload: ["images dir", "disk"],
  templates: ["config"]
};

const failed = (check: ImagesDoctorCheck): boolean => check.status.toUpperCase() === "FAIL";

/** Why an action is off, naming the failed check; undefined when it can run. */
export function blockedReason(checks: readonly ImagesDoctorCheck[] | undefined, action: ImagesAction): string | undefined {
  if (!checks) return undefined;
  const needed = ACTION_CHECKS[action];
  const blocking = checks.filter((check) => failed(check) && needed.includes(check.check));
  // A pull needs at least one LabHub mirror that answers.
  const mirrors = checks.filter((check) => check.check.startsWith("mirror "));
  if (action === "pull" && mirrors.length > 0 && mirrors.every(failed)) blocking.push(...mirrors);
  if (blocking.length === 0) return undefined;
  return `Host check failed: ${blocking.map((check) => (check.detail ? `${check.check} (${check.detail})` : check.check)).join(", ")}`;
}

/** Free bytes from the `disk` check (`412.0 GB free, floor 20.0 GB`), when it says. */
export function freeDiskBytes(checks: readonly ImagesDoctorCheck[] | undefined): number | undefined {
  const detail = checks?.find((check) => check.check === "disk")?.detail ?? "";
  const match = /([\d.]+)\s*GB free/.exec(detail);
  return match ? Math.round(Number(match[1]) * 1e9) : undefined;
}

/** Sizes as `climg` prints them (decimal units), so the numbers match the CLI. */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (Math.abs(value) >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** Whether an upload may start, and if not, why (the server checks again). */
export function uploadProblem(
  file: { name: string; size: number },
  limits: { extensions: readonly string[]; maxBytes: number }
): string | undefined {
  const lower = file.name.toLowerCase();
  if (!limits.extensions.some((extension) => lower.endsWith(extension))) {
    return `Unsupported file type. Accepted: ${limits.extensions.join(" ")}`;
  }
  if (!FILE_NAME.test(file.name) || file.name.includes("..")) {
    return "The file name may only use letters, digits, dot, dash, underscore and plus, and must start with a letter or digit.";
  }
  if (file.size > limits.maxBytes) return `The file is larger than the upload limit of ${formatSize(limits.maxBytes)}.`;
  return undefined;
}

/** The Node Template whose image is the record's built tag. */
export function linkedTemplate(record: ImageRecord, templates: readonly ImagesTemplate[]): ImagesTemplate | undefined {
  const tag = builtTag(record);
  return tag ? templates.find((template) => template.image === tag) : undefined;
}

/** The 404 "unavailable" answer carried by an error, if the error is one. */
export function unavailableOf(error: unknown): ImagesUnavailableInfo | undefined {
  if (typeof error !== "object" || error === null || !("unavailable" in error)) return undefined;
  const value = (error as { unavailable?: unknown }).unavailable;
  if (typeof value !== "object" || value === null) return undefined;
  const info = value as Partial<ImagesUnavailableInfo>;
  return info.reason === "unavailable" && typeof info.detail === "string" ? (info as ImagesUnavailableInfo) : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const OP_LABELS: Record<ImagesJob["op"], string> = { pull: "Pull", build: "Build", add: "Register" };

export function jobTitle(job: ImagesJob): string {
  return `${OP_LABELS[job.op]} ${job.ref ?? job.file ?? ""}`.trim();
}

/** The `kept` list of a result item: the fields whose user values climg kept; empty when absent or malformed. */
export function keptFields(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((field): field is string => typeof field === "string" && field !== "") : [];
}

/** `kept your interfacePattern, icon`; undefined when nothing was kept. */
export function keptText(fields: readonly string[]): string | undefined {
  return fields.length > 0 ? `kept your ${fields.join(", ")}` : undefined;
}

/** A template change of a `nodetpl` result as one line: `created x`, `deleted y`; `updated` ones carry the fields kept. */
export function templateChanges(changes: readonly unknown[]): Array<{ action: string; name: string; kept: string[] }> {
  return changes.flatMap((change) => {
    if (typeof change !== "object" || change === null) return [];
    const { action, name, kept } = change as { action?: unknown; name?: unknown; kept?: unknown };
    return typeof action === "string" && typeof name === "string" ? [{ action, name, kept: keptFields(kept) }] : [];
  });
}

/** The reason climg gives for keeping an edited template whose image is gone. */
const EDITED_IMAGE_MISSING = "edited by user; image missing";

/** The skipped entries of a sync that are edited templates kept although their image is missing. */
export function keptMissingImage(skipped: readonly unknown[]): string[] {
  return skipped.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { name, reason } = entry as { name?: unknown; reason?: unknown };
    return typeof name === "string" && reason === EDITED_IMAGE_MISSING ? [name] : [];
  });
}
