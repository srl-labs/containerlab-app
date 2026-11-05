/** Formatting for the Fabric view. Times are epoch seconds, as the engine gives them. */

const UNITS: ReadonlyArray<readonly [number, string]> = [
  [1e9, "Gbps"],
  [1e6, "Mbps"],
  [1e3, "Kbps"]
];

/** Compares names the way people read them: `leaf2` before `leaf10`. */
export function natural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function ago(ts: number | undefined, now = Date.now() / 1000): string {
  if (!ts) return "";
  const seconds = Math.max(0, now - ts);
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/** A time of day; with its date when it is not today. */
export function clock(ts: number | undefined, now = Date.now() / 1000): string {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  if (new Date(now * 1000).toDateString() === date.toDateString()) {
    return date.toLocaleTimeString([], { hour12: false });
  }
  return date.toLocaleString([], {
    hour12: false,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

/** A rate; `—` when there is none yet, as a rate takes two samples. */
export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "—";
  for (const [size, unit] of UNITS) {
    if (bps >= size) return `${(bps / size).toFixed(bps >= size * 10 ? 0 : 1)} ${unit}`;
  }
  return `${Math.round(bps)} bps`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** A record's key, kept as JSON by the history, as words. */
export function keyText(key: string): string {
  try {
    const parts: unknown = JSON.parse(key);
    return Array.isArray(parts) ? parts.filter((part) => part !== null && part !== "").join(" ") : key;
  } catch {
    return key;
  }
}

const SHORT_VALUE = 60;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function valueText(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** A value on one line, cut where it would not fit in a summary. */
export function shortValue(value: unknown): string {
  if (isBlank(value)) return "—";
  const text = valueText(value);
  return text.length > SHORT_VALUE ? `${text.slice(0, SHORT_VALUE - 1)}…` : text;
}

/** A value in full: objects indented, so a next-hop reads as one. */
export function fullValue(value: unknown): string {
  if (isBlank(value)) return "—";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

/** Whether a record field is worth showing. */
export function hasValue(value: unknown): boolean {
  return !isBlank(value) && !(Array.isArray(value) && value.length === 0);
}
