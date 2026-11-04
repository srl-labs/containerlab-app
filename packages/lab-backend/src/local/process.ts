import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

import { LabBackendError } from "../contract/errors.ts";
import type { ResolvedLocalOptions } from "./options.ts";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  input?: string;
}

const ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`, "g");

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function spawnError(file: string, error: NodeJS.ErrnoException): LabBackendError {
  if (error.code === "ENOENT") {
    return new LabBackendError(`${file} was not found. Install it or set its path.`, 503, {
      cause: error
    });
  }
  return new LabBackendError(`Failed to run ${file}: ${error.message}`, 500, { cause: error });
}

/** Runs a command to completion and collects its output. */
export function runCommand(file: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        timeout: options.timeoutMs
      });
    } catch (error) {
      reject(spawnError(file, error as NodeJS.ErrnoException));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.name === "AbortError") {
        reject(new LabBackendError(`${file} was cancelled`, 499, { cause: error }));
        return;
      }
      reject(spawnError(file, error));
    });
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code
      });
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

/** Like `runCommand`, but rejects unless the command exits with 0. */
export async function runChecked(
  file: string,
  args: string[],
  options: RunOptions = {}
): Promise<CommandResult> {
  const result = await runCommand(file, args, options);
  if (result.code !== 0) {
    throw new LabBackendError(commandFailureMessage(file, args, result), 500);
  }
  return result;
}

function commandFailureMessage(file: string, args: string[], result: CommandResult): string {
  const output = stripAnsi(`${result.stderr}\n${result.stdout}`).trim();
  const errorLine = lastContainerlabError(output);
  const detail = errorLine ?? output.split("\n").slice(-5).join("\n");
  return `${[file, ...args.slice(0, 2)].join(" ")} failed (exit ${result.code ?? "signal"})${detail ? `: ${detail}` : ""}`;
}

/**
 * The message of containerlab's last error: its last `ERRO`/`FATA` log line,
 * or the boxed `ERROR` block it prints when a command fails, e.g.
 *
 * ```
 *    ERROR
 *
 *   This containerlab command requires root privileges or root via SUID to run, ….
 * ```
 */
export function lastContainerlabError(output: string): string | undefined {
  const lines = stripAnsi(output).split("\n").map((line) => line.trim());
  // containerlab prints the box last, when the command fails.
  const header = lines.findLastIndex((line) => /^(?:ERROR|FATAL)$/.test(line));
  const boxed = header >= 0 ? boxedErrorMessage(lines, header + 1) : undefined;
  if (boxed !== undefined) return boxed;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /^(?:\d{2}:\d{2}:\d{2} )?(?:ERRO|FATA|ERROR|FATAL)\b\s*(.*)$/.exec(lines[index]);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** The message under a boxed `ERROR` header: the wrapped lines up to the next blank line. */
function boxedErrorMessage(lines: string[], start: number): string | undefined {
  let index = start;
  while (index < lines.length && lines[index] === "") index += 1;
  const message: string[] = [];
  for (; index < lines.length && lines[index] !== ""; index += 1) message.push(lines[index]);
  return message.length > 0 ? message.join(" ") : undefined;
}

interface OutputLine {
  line: string;
  stream: "stdout" | "stderr";
}

export interface StreamingCommand {
  lines: AsyncIterable<OutputLine>;
  /** Settles when the command exits. */
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill(): void;
}

/**
 * Starts a command and yields its output lines from both streams in order.
 * Resolves once the process has spawned.
 */
export function spawnLines(file: string, args: string[], options: RunOptions = {}): Promise<StreamingCommand> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(file, args, { cwd: options.cwd, env: options.env });
    } catch (error) {
      reject(spawnError(file, error as NodeJS.ErrnoException));
      return;
    }
    child.stdin.end();

    const queue: OutputLine[] = [];
    let wake: (() => void) | undefined;
    let openStreams = 2;
    const push = (line: OutputLine | null) => {
      if (line) {
        queue.push(line);
      } else {
        openStreams -= 1;
      }
      wake?.();
    };
    readline.createInterface({ input: child.stdout }).on("line", (line) => push({ line, stream: "stdout" }));
    readline.createInterface({ input: child.stderr }).on("line", (line) => push({ line, stream: "stderr" }));
    child.stdout.on("end", () => push(null));
    child.stderr.on("end", () => push(null));

    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      child.on("close", (code, signal) => resolveExit({ code, signal }));
    });
    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", kill, { once: true });

    async function* lines(): AsyncGenerator<OutputLine> {
      try {
        while (true) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          if (openStreams <= 0) return;
          await new Promise<void>((resume) => {
            wake = resume;
          });
          wake = undefined;
        }
      } finally {
        options.signal?.removeEventListener("abort", kill);
      }
    }

    child.once("spawn", () => resolve({ lines: lines(), exit, kill }));
    child.once("error", (error: NodeJS.ErrnoException) => reject(spawnError(file, error)));
  });
}

/** The command line that runs containerlab with `args`. */
export function containerlabCommand(
  options: Pick<ResolvedLocalOptions, "binaryPath" | "sudo">,
  args: string[]
): [string, string[]] {
  return options.sudo ? ["sudo", ["-n", options.binaryPath, ...args]] : [options.binaryPath, args];
}
