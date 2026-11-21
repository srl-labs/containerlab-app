/**
 * Types text into a terminal session the way a person would: one line at a
 * time, each once the terminal has gone quiet. An interactive CLI that is
 * still starting, or still answering the previous line, may drop input sent
 * at it, so each line waits for the output to settle.
 */

/** Quiet output before the first line, while a CLI may still be starting. */
const FIRST_LINE_QUIET_MS = 1000;
/** Quiet output before each later line: the previous line's echo and answer. */
const LINE_QUIET_MS = 300;
/** A line goes out after this much waiting, however busy the terminal is. */
const MAX_LINE_WAIT_MS = 10000;
const POLL_MS = 50;

export interface TerminalTyperOptions {
  /** Sends input; false while the connection cannot take it, to try again later. */
  send: (data: string) => boolean;
  now?: () => number;
  /** Calls back after `ms`; the returned function cancels it. */
  setTimer?: (callback: () => void, ms: number) => () => void;
}

function setTimer(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
}

/** The text as typed lines: line endings become Enter, and trailing empty lines go. */
export function terminalInputLines(text: string): string[] {
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return body === "" ? [] : body.split("\n").map((line) => `${line}\r`);
}

export class TerminalTyper {
  private readonly queue: string[] = [];
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => () => void;
  private lastActivityAt: number;
  private typedAny = false;
  private waitingSince: number | null = null;
  private cancelTimer: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly options: TerminalTyperOptions) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? setTimer;
    this.lastActivityAt = this.now();
  }

  /** The terminal printed something. */
  noteOutput(): void {
    this.lastActivityAt = this.now();
  }

  type(text: string): void {
    if (this.disposed) return;
    this.queue.push(...terminalInputLines(text));
    this.schedule(0);
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private schedule(ms: number): void {
    if (this.cancelTimer !== null || this.disposed) return;
    this.cancelTimer = this.setTimer(() => {
      this.cancelTimer = null;
      this.pump();
    }, ms);
  }

  private pump(): void {
    const line = this.queue.at(0);
    if (line === undefined) return;
    const now = this.now();
    this.waitingSince ??= now;
    const quiet = this.typedAny ? LINE_QUIET_MS : FIRST_LINE_QUIET_MS;
    const settled = now - this.lastActivityAt >= quiet;
    const waitedEnough = now - this.waitingSince >= MAX_LINE_WAIT_MS;
    if ((!settled && !waitedEnough) || !this.options.send(line)) {
      this.schedule(POLL_MS);
      return;
    }
    this.queue.shift();
    this.typedAny = true;
    this.waitingSince = null;
    // The line's own echo comes next; count the send as activity until it does.
    this.lastActivityAt = now;
    if (this.queue.length > 0) this.schedule(POLL_MS);
  }
}
