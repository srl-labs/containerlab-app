import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import { spawnError } from "./process.ts";

/** Output held for a slow reader before the script is made to wait. */
const HIGH_WATER_CHARS = 1024 * 1024;
const LOW_WATER_CHARS = 256 * 1024;
/** How long a stopped script may clean up before everything it started is killed. */
const STOP_GRACE_MS = 5_000;
/** After the script exits: stop reading once its pipes stay quiet this long. */
const DRAIN_QUIET_MS = 500;
/** ... and in any case after this long, when something it left behind keeps writing. */
const DRAIN_LIMIT_MS = 5_000;

interface ScriptOutput {
  stream: "stdout" | "stderr";
  text: string;
}

export interface ScriptProcess {
  /** Output as it comes; ends shortly after the script exits, whatever it left running. */
  output: AsyncIterable<ScriptOutput>;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Stops the script and what it started. Does nothing once the script has exited by itself. */
  stop(): void;
  timedOut(): boolean;
  cancelled(): boolean;
}

interface ScriptProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Starts a script in its own process group, so stopping it reaches its children.
 * What it leaves running when it exits by itself stays, without its output pipes.
 * Resolves once the process has spawned.
 */
export function startScriptProcess(
  file: string,
  args: string[],
  options: ScriptProcessOptions = {}
): Promise<ScriptProcess> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      reject(spawnError(file, error as NodeJS.ErrnoException));
      return;
    }

    const pipes = [child.stdout, child.stderr];
    const queue: ScriptOutput[] = [];
    let queuedChars = 0;
    let openPipes = pipes.length;
    let paused = false;
    let exited = false;
    let stopping = false;
    let timedOut = false;
    let cancelled = false;
    let lastOutputAt = 0;
    let wake: (() => void) | undefined;

    const signalGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The whole group is gone already.
      }
    };

    const stop = () => {
      if (stopping || exited) return;
      stopping = true;
      signalGroup("SIGTERM");
      setTimeout(() => signalGroup("SIGKILL"), STOP_GRACE_MS).unref();
    };

    const collect = (stream: ScriptOutput["stream"], pipe: Readable) => {
      pipe.setEncoding("utf8");
      pipe.on("data", (text: string) => {
        lastOutputAt = Date.now();
        queue.push({ stream, text });
        queuedChars += text.length;
        if (!paused && queuedChars > HIGH_WATER_CHARS) {
          paused = true;
          for (const each of pipes) each.pause();
        }
        wake?.();
      });
      // Reading a pipe that goes away is not the script's failure.
      pipe.on("error", () => undefined);
      pipe.once("close", () => {
        openPipes -= 1;
        wake?.();
      });
    };
    collect("stdout", child.stdout);
    collect("stderr", child.stderr);

    const abort = () => {
      cancelled = true;
      stop();
    };
    const timeout =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            stop();
          }, options.timeoutMs)
        : undefined;
    options.signal?.addEventListener("abort", abort, { once: true });

    /** A child that outlives the script holds the pipes open; don't wait for it. */
    const finishReading = () => {
      const exitedAt = Date.now();
      const check = () => {
        const reading = paused && queue.length > 0;
        // The exit can come before the last output, so the wait starts with it.
        const quiet = Date.now() - Math.max(lastOutputAt, exitedAt) >= DRAIN_QUIET_MS;
        if (openPipes === 0) return;
        if ((quiet && !reading) || Date.now() - exitedAt >= DRAIN_LIMIT_MS) {
          for (const pipe of pipes) pipe.destroy();
          return;
        }
        setTimeout(check, DRAIN_QUIET_MS / 5).unref();
      };
      check();
    };

    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      child.once("exit", (code, signal) => {
        exited = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        finishReading();
        resolveExit({ code, signal });
      });
    });

    async function* output(): AsyncGenerator<ScriptOutput> {
      while (true) {
        const next = queue.shift();
        if (next) {
          queuedChars -= next.text.length;
          if (paused && queuedChars < LOW_WATER_CHARS) {
            paused = false;
            for (const pipe of pipes) pipe.resume();
          }
          yield next;
          continue;
        }
        if (openPipes <= 0) return;
        await new Promise<void>((resume) => {
          wake = resume;
        });
        wake = undefined;
      }
    }

    child.once("spawn", () => {
      if (options.signal?.aborted === true) abort();
      resolve({
        output: output(),
        exit,
        stop,
        timedOut: () => timedOut,
        cancelled: () => cancelled
      });
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      reject(spawnError(file, error));
    });
  });
}
