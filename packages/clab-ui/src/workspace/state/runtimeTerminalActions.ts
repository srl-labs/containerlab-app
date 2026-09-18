export type TerminalExportScope = "screen" | "log";

interface TerminalBufferLineLike {
  translateToString(trimRight?: boolean): string;
}

interface TerminalBufferLike {
  viewportY: number;
  length: number;
  getLine(index: number): TerminalBufferLineLike | undefined | null;
}

export interface TerminalTextSource {
  rows: number;
  hasSelection(): boolean;
  getSelection(): string;
  buffer: {
    active: TerminalBufferLike;
  };
}

function readBufferRange(buffer: TerminalBufferLike, start: number, endExclusive: number): string[] {
  const lines: string[] = [];
  for (let index = start; index < endExclusive; index += 1) {
    const line = buffer.getLine(index);
    lines.push(line ? line.translateToString(true) : "");
  }
  return lines;
}

export function extractTerminalText(source: TerminalTextSource, scope: TerminalExportScope): string {
  const buffer = source.buffer.active;
  const start = scope === "screen" ? buffer.viewportY : 0;
  const endExclusive = scope === "screen" ? Math.min(buffer.viewportY + source.rows, buffer.length) : buffer.length;
  return readBufferRange(buffer, start, endExclusive).join("\n");
}

export function resolveTerminalCopyText(source: TerminalTextSource): string {
  const selection = source.hasSelection() ? source.getSelection() : "";
  if (selection.length > 0) {
    return selection;
  }
  return extractTerminalText(source, "screen");
}

function sanitizeFileSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "unknown";
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  ].join("-");
}

export function createTerminalExportFileName(input: {
  nodeName: string;
  protocol: string;
  scope: TerminalExportScope;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const suffix = input.scope === "screen" ? "screen" : "log";
  return `clab-terminal-${sanitizeFileSegment(input.nodeName)}-${sanitizeFileSegment(
    input.protocol
  )}-${formatTimestamp(now)}-${suffix}.txt`;
}
