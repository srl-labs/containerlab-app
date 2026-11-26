/**
 * Types text into a terminal session the way a person would: one line at a
 * time, each once the terminal has gone quiet. An interactive CLI that is
 * still starting, or still answering the previous line, may drop input sent
 * at it, so each line waits for the output to settle. The first line also
 * waits for the terminal to print something at all: a CLI that has shown
 * nothing yet is not reading.
 */

/** Quiet output before the first line, while a CLI may still be starting. */
const FIRST_LINE_QUIET_MS = 1000;
/** Quiet output before each later line: the previous line's echo and answer. */
const LINE_QUIET_MS = 300;
/**
 * A line goes out after this much waiting on a connection that takes input,
 * however busy the terminal is, or however silent before the first line.
 */
const MAX_LINE_WAIT_MS = 10000;
const POLL_MS = 50;

export interface TerminalTyperOptions {
  /** Sends input; false while the connection cannot take it, to try again later. */
  send: (data: string) => boolean;
  /** Whether the connection takes input yet. Until it does, no line counts as waiting. */
  ready?: () => boolean;
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
  private sawOutput = false;
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
    this.sawOutput = true;
    this.lastActivityAt = this.now();
  }

  type(text: string): void {
    if (this.disposed) return;
    this.queue.push(...terminalInputLines(text));
    this.schedule(0);
  }

  /** Stops typing and hands back the lines that did not go out, for a session that follows. */
  dispose(): string[] {
    this.disposed = true;
    const unsent = this.queue.splice(0).map((line) => line.slice(0, -1));
    this.cancelTimer?.();
    this.cancelTimer = null;
    return unsent;
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
    if (this.options.ready?.() === false) {
      // A connection still opening has shown nothing of the terminal behind
      // it, so the longest wait starts once it is there.
      this.waitingSince = null;
      this.schedule(POLL_MS);
      return;
    }
    const now = this.now();
    this.waitingSince ??= now;
    const quiet = this.typedAny ? LINE_QUIET_MS : FIRST_LINE_QUIET_MS;
    const settled = (this.typedAny || this.sawOutput) && now - this.lastActivityAt >= quiet;
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
