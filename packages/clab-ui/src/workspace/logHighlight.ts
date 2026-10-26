/**
 * Splits container log lines into parts to color: the timestamp the runtime
 * prefixes, log levels and `key=value` pairs.
 */

export type LogSegmentKind = "text" | "timestamp" | "error" | "warn" | "info" | "debug" | "key" | "value";

interface LogSegment {
  text: string;
  kind: LogSegmentKind;
}

export interface ParsedLogLine {
  /** The RFC 3339 timestamp `logs --timestamps` puts before each line, without it in `segments`. */
  runtimeTimestamp?: string;
  segments: LogSegment[];
}

const RUNTIME_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s/;

/** Timestamps written by the node itself: ISO dates, `2026/01/02 15:04:05` and `15:04:05`. */
const LINE_TIMESTAMP =
  /^\s*\[?(?:\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\]?/;

const LEVELS: ReadonlyArray<[RegExp, LogSegmentKind]> = [
  [/^(?:ERROR|ERRO|ERR|FATAL|FATA|CRIT|CRITICAL|PANIC|EMERG|ALERT)$/i, "error"],
  [/^(?:WARN|WARNING)$/i, "warn"],
  [/^(?:INFO|NOTICE)$/i, "info"],
  [/^(?:DEBUG|DEBU|TRACE|TRAC)$/i, "debug"]
];

/** A `key=value` pair, or an upper-case level word, maybe in brackets. */
const TOKEN =
  /\b([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|[^\s,;]+)|\[?\b([A-Z]{3,9})\b\]?/g;

function levelKind(word: string): LogSegmentKind | undefined {
  return LEVELS.find(([pattern]) => pattern.test(word))?.[1];
}

function pushText(segments: LogSegment[], text: string): void {
  if (!text) return;
  const last = segments.at(-1);
  if (last?.kind === "text") {
    last.text += text;
  } else {
    segments.push({ text, kind: "text" });
  }
}

export function parseLogLine(line: string): ParsedLogLine {
  const result: ParsedLogLine = { segments: [] };
  let rest = line;
  const runtime = RUNTIME_TIMESTAMP.exec(rest);
  if (runtime) {
    result.runtimeTimestamp = runtime[1];
    rest = rest.slice(runtime[0].length);
  }
  const own = LINE_TIMESTAMP.exec(rest);
  if (own && own[0].trim()) {
    result.segments.push({ text: own[0], kind: "timestamp" });
    rest = rest.slice(own[0].length);
  }

  let index = 0;
  for (const match of rest.matchAll(TOKEN)) {
    const start = match.index;
    const [whole, key, value, word] = match;
    if (word !== undefined) {
      const kind = levelKind(word);
      if (!kind) continue;
      pushText(result.segments, rest.slice(index, start));
      result.segments.push({ text: whole, kind });
    } else if (key !== undefined && value !== undefined) {
      pushText(result.segments, rest.slice(index, start));
      const keyKind = key.toLowerCase() === "level" || key.toLowerCase() === "lvl" ? levelKind(value.replace(/"/g, "")) : undefined;
      result.segments.push({ text: `${key}=`, kind: "key" });
      result.segments.push({ text: value, kind: keyKind ?? "value" });
    }
    index = start + whole.length;
  }
  pushText(result.segments, rest.slice(index));
  return result;
}

/** A runtime timestamp as local `HH:MM:SS.mmm`, for display next to the line. */
export function formatRuntimeTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
