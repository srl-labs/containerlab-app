/** How the kept changes read: their kind, the timeline's bars, and what each one says. */
import { keyText, shortValue } from "./fabricFormat";
import type { FabricChange, FabricRecord } from "./fabricTypes";

export const CHANGE_KINDS = ["raised", "cleared", "commit", "config", "change"] as const;

export type FabricChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_KIND_LABELS: Readonly<Record<FabricChangeKind, string>> = {
  raised: "Finding raised",
  cleared: "Finding cleared",
  commit: "Commit",
  config: "Change after a commit",
  change: "Unplanned change"
};

export const HISTORY_WINDOWS: ReadonlyArray<readonly [string, number]> = [
  ["15m", 15 * 60],
  ["1h", 3600],
  ["6h", 6 * 3600],
  ["24h", 86400],
  ["7d", 7 * 86400]
];

export function changeKind(change: FabricChange): FabricChangeKind {
  if (change.finding) return change.finding === "cleared" || change.finding === "eased" ? "cleared" : "raised";
  if (change.report === "config-commits") return "commit";
  return change.origin === "config" ? "config" : "change";
}

export interface FabricTimelineBucket {
  start: number;
  end: number;
  counts: Record<FabricChangeKind, number>;
  total: number;
}

function emptyCounts(): Record<FabricChangeKind, number> {
  return { raised: 0, cleared: 0, commit: 0, config: 0, change: 0 };
}

/** The changes in equal slices of the window, each counted by kind. */
export function timelineBuckets(
  changes: readonly FabricChange[],
  from: number,
  to: number,
  count: number
): FabricTimelineBucket[] {
  const step = (to - from) / count;
  const buckets: FabricTimelineBucket[] = Array.from({ length: count }, (_, index) => ({
    start: from + index * step,
    end: from + (index + 1) * step,
    counts: emptyCounts(),
    total: 0
  }));
  for (const change of changes) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((change.ts - from) / step)));
    const bucket = buckets[index];
    if (bucket) {
      bucket.counts[changeKind(change)] += 1;
      bucket.total += 1;
    }
  }
  return buckets;
}

/** A bar's height as a share of the tallest: a square root, so the burst of the first sync flattens no other bar. */
export function barShare(total: number, peak: number): number {
  return peak > 0 && total > 0 ? Math.sqrt(total / peak) : 0;
}

export interface FabricFieldDelta {
  field: string;
  before: unknown;
  after: unknown;
}

/** The fields of a record that differ, the node left out. */
export function changedFields(before: FabricRecord | null, after: FabricRecord | null): FabricFieldDelta[] {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  fields.delete("node");
  return [...fields].flatMap((field) => {
    const [was, now] = [before?.[field], after?.[field]];
    return JSON.stringify(was) === JSON.stringify(now) ? [] : [{ field, before: was, after: now }];
  });
}

/** What a list field lost and gained; `reordered` when neither. */
export function listDelta(before: unknown, after: unknown): { gone: unknown[]; came: unknown[] } {
  const was = Array.isArray(before) ? (before as unknown[]) : [];
  const now = Array.isArray(after) ? (after as unknown[]) : [];
  const text = (value: unknown) => JSON.stringify(value);
  const wasText = new Set(was.map(text));
  const nowText = new Set(now.map(text));
  return {
    gone: was.filter((value) => !nowText.has(text(value))),
    came: now.filter((value) => !wasText.has(text(value)))
  };
}

export type FabricChangeSummary =
  | { type: "commit"; id: unknown; user: string; comment: string }
  | { type: "finding"; check: string; subject: string; detail: string; severity: string; moved?: string }
  | { type: "fields"; key: string; deltas: string[]; more: number }
  | { type: "record"; key: string };

const SHOWN_FIELDS = 4;

function textField(record: FabricRecord | null, field: string): string {
  const value = record?.[field];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** What the line of a change says: a commit, a finding, the fields that moved, or the record that came or went. */
export function summarizeChange(change: FabricChange): FabricChangeSummary {
  const { before, after } = change;
  if (change.report === "config-commits" && change.op !== "remove") {
    return {
      type: "commit",
      id: after?.id,
      user: textField(after, "username") || "?",
      comment: textField(after, "comment")
    };
  }
  if (change.finding) {
    const record = change.op === "remove" ? before : after;
    const [was, now] = [textField(before, "severity"), textField(after, "severity")];
    return {
      type: "finding",
      check: textField(record, "check"),
      subject: textField(record, "subject"),
      detail: textField(record, "detail"),
      severity: textField(record, "severity"),
      ...(change.op === "change" && was !== now ? { moved: `${was} → ${now}` } : {})
    };
  }
  if (change.op === "change") {
    const deltas = changedFields(before, after);
    return {
      type: "fields",
      key: keyText(change.key),
      deltas: deltas
        .slice(0, SHOWN_FIELDS)
        .map((delta) => `${delta.field} ${shortValue(delta.before)} → ${shortValue(delta.after)}`),
      more: Math.max(0, deltas.length - SHOWN_FIELDS)
    };
  }
  return { type: "record", key: keyText(change.key) };
}

/** Now as a baseline's name: the local time to the second, which also reads as a time. */
export function baselineStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Where two versions of a line differ, as how much of its start and end are common. */
export function differingPart(text: string, other: string): readonly [number, number] {
  let start = 0;
  while (start < text.length && start < other.length && text[start] === other[start]) start += 1;
  let end = 0;
  while (
    end < text.length - start &&
    end < other.length - start &&
    text[text.length - 1 - end] === other[other.length - 1 - end]
  ) end += 1;
  return [start, end];
}
