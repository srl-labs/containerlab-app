/**
 * Packet capture on a c9s lab host through the containerlab CLI:
 * `containerlab -r c9s capture … -w -` writes one pcapng stream to stdout,
 * and `capture --list -f json` names the lab-link interfaces.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import readline from "node:readline";
import type { Readable } from "node:stream";

import {
  captureLimits,
  captureTargetFlags,
  parseCaptureGapLine,
  parseCaptureInterfaces,
  pcapngBlocks,
  type CaptureNodeTarget
} from "../capture.ts";
import type { CaptureGap, CaptureInterface } from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import type { ResolvedLocalOptions } from "./options.ts";
import { containerlabCommand, lastContainerlabError, runChecked, stripAnsi } from "./process.ts";

export interface C9sCaptureRequest {
  labName: string;
  targets: CaptureNodeTarget[];
  duration?: string;
  packetLimit?: number;
  snapLength?: number;
}

/** The arguments of `containerlab -r c9s capture` that write the request's pcapng to stdout. */
export function c9sCaptureArgs(request: C9sCaptureRequest): string[] {
  const limits = captureLimits(request);
  return [
    "-r",
    "c9s",
    "capture",
    "--name",
    request.labName,
    ...captureTargetFlags(request.targets),
    ...(limits.duration !== undefined ? ["--duration", limits.duration] : []),
    ...(limits.packetLimit !== undefined ? ["--packet-limit", String(limits.packetLimit)] : []),
    ...(limits.snapLength !== undefined ? ["--snap-length", String(limits.snapLength)] : []),
    "-w",
    "-"
  ];
}

/** `containerlab -r c9s capture --name <lab> --list -f json`. */
export async function listC9sCaptureInterfaces(
  options: Pick<ResolvedLocalOptions, "binaryPath" | "sudo">,
  labName: string,
  env: NodeJS.ProcessEnv
): Promise<CaptureInterface[]> {
  const [file, args] = containerlabCommand(options, ["-r", "c9s", "capture", "--name", labName, "--list", "-f", "json"]);
  const result = await runChecked(file, args, { env, timeoutMs: 60_000 });
  const start = result.stdout.indexOf("[");
  if (start < 0) return [];
  try {
    return parseCaptureInterfaces(JSON.parse(result.stdout.slice(start)) as unknown);
  } catch (error) {
    throw new LabBackendError(`containerlab capture --list returned no JSON: ${String(error)}`, 502);
  }
}

/** Waits after SIGINT before SIGTERM, and after SIGTERM before SIGKILL. */
const CAPTURE_STOP_GRACE_MS = 10_000;

export interface CaptureProcessOptions {
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  onGap?: (gap: CaptureGap) => void;
  /** Time between the stop signals; tests shorten it. */
  stopGraceMs?: number;
}

type CaptureChild = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Ends the capture: SIGINT lets containerlab finish the file and stop the
 * clabwire processes in the pods. A process that is still there after the
 * grace time gets SIGTERM (containerlab aborts on a second signal), then SIGKILL.
 */
function stopCapture(child: CaptureChild, graceMs: number): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGINT");
  const escalate = (signal: NodeJS.Signals, next?: () => void) =>
    setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
      next?.();
    }, graceMs).unref();
  escalate("SIGTERM", () => escalate("SIGKILL"));
}

async function drain(source: AsyncIterator<unknown>): Promise<void> {
  try {
    while (!(await source.next()).done) {
      // Discard what the stopped capture still writes.
    }
  } catch {
    // The process is gone.
  }
}

function spawnError(file: string, error: NodeJS.ErrnoException): LabBackendError {
  return error.code === "ENOENT"
    ? new LabBackendError(`${file} was not found. Install it or set its path.`, 503, { cause: error })
    : new LabBackendError(`Failed to run ${file}: ${error.message}`, 500, { cause: error });
}

function failure(stderr: string[], code: number | null): LabBackendError {
  const output = stripAnsi(stderr.join("\n")).trim();
  const detail = lastContainerlabError(output) ?? output.split("\n").slice(-3).join("\n");
  const status = /not found|unknown|not capturable|invalid|duplicate|provide/i.test(detail) ? 400 : 502;
  return new LabBackendError(`containerlab capture failed (exit ${code ?? "signal"})${detail ? `: ${detail}` : ""}`, status);
}

/**
 * Runs `containerlab capture` and yields its stdout as whole pcapng blocks.
 * Resolves once the first bytes arrived, so a capture that cannot start
 * rejects with containerlab's error. The stream is read only as fast as it
 * is consumed. Aborting `signal`, or leaving the iteration early, stops the
 * command with SIGINT; the stream then ends with containerlab's last block.
 */
export function spawnC9sCapture(
  options: Pick<ResolvedLocalOptions, "binaryPath" | "sudo">,
  args: string[],
  processOptions: CaptureProcessOptions
): Promise<AsyncIterable<Uint8Array>> {
  const [file, commandArgs] = containerlabCommand(options, args);
  const grace = processOptions.stopGraceMs ?? CAPTURE_STOP_GRACE_MS;
  return new Promise((resolve, reject) => {
    if (processOptions.signal.aborted) {
      reject(new LabBackendError("The capture was cancelled.", 499));
      return;
    }
    let child: CaptureChild;
    try {
      child = spawn(file, commandArgs, { env: processOptions.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(spawnError(file, error as NodeJS.ErrnoException));
      return;
    }
    const stderr: string[] = [];
    readline.createInterface({ input: child.stderr }).on("line", (line) => {
      const gap = parseCaptureGapLine(stripAnsi(line));
      if (gap) {
        processOptions.onGap?.(gap);
        return;
      }
      stderr.push(line);
      if (stderr.length > 50) stderr.shift();
    });
    const exited = new Promise<number | null>((resolveExit) => child.once("close", (code) => resolveExit(code)));
    let stopRequested = false;
    const stop = () => {
      stopRequested = true;
      stopCapture(child, grace);
    };
    processOptions.signal.addEventListener("abort", stop, { once: true });

    const source = child.stdout[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    let settled = false;
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      processOptions.signal.removeEventListener("abort", stop);
      reject(spawnError(file, error));
    });

    async function* chunks(first: Buffer | undefined): AsyncGenerator<Uint8Array> {
      if (first) yield new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
      while (true) {
        const next = await source.next();
        if (next.done) break;
        yield new Uint8Array(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      }
    }

    async function* stream(first: Buffer | undefined): AsyncGenerator<Uint8Array> {
      let complete = false;
      try {
        yield* pcapngBlocks(chunks(first));
        complete = true;
      } finally {
        if (!complete) {
          // The consumer left early, e.g. Wireshark closed: end the capture in the pods too.
          stop();
          // Keep reading, so containerlab finishes its file instead of writing into a closed pipe.
          void drain(source);
          processOptions.signal.removeEventListener("abort", stop);
        }
      }
      const code = await exited;
      processOptions.signal.removeEventListener("abort", stop);
      // A capture that failed after it started, e.g. its pod went away.
      if (code !== 0 && !stopRequested) throw failure(stderr, code);
    }

    void source.next().then(
      async (first) => {
        if (settled) return;
        settled = true;
        if (first.done) {
          const code = await exited;
          if (code !== 0 && !stopRequested) {
            processOptions.signal.removeEventListener("abort", stop);
            reject(failure(stderr, code));
            return;
          }
          resolve(stream(undefined));
          return;
        }
        resolve(stream(first.value));
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        stop();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}
