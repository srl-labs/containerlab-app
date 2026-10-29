/**
 * Wireshark on this machine, reading a capture stream on stdin
 * (`wireshark -k -i -`): how the desktop app and VS Code show a capture
 * stream live.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

import { LabBackendError } from "../contract/errors.ts";

export interface FindWiresharkOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** The executable on PATH, with Windows' PATHEXT. */
async function onPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | undefined> {
  const pathValue = env.PATH ?? env.Path ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const extensions = platform === "win32" ? ["", ".exe"] : [""];
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Where Wireshark installs itself, per platform, before PATH is searched. */
export function wiresharkCandidates(options: FindWiresharkOptions = {}): string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const home = env.HOME;
    return [
      "/Applications/Wireshark.app/Contents/MacOS/Wireshark",
      ...(home ? [path.posix.join(home, "Applications/Wireshark.app/Contents/MacOS/Wireshark")] : [])
    ];
  }
  if (platform === "win32") {
    return [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432]
      .filter((root): root is string => Boolean(root))
      .map((root) => path.win32.join(root, "Wireshark", "Wireshark.exe"));
  }
  return [];
}

/**
 * The Wireshark executable: `binaryPath` when given (a path, or a name on
 * PATH), else the platform's install location, else `wireshark` on PATH.
 */
export async function findWireshark(
  binaryPath?: string,
  options: FindWiresharkOptions = {}
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const configured = binaryPath?.trim();
  if (configured) {
    if (/[\\/]/.test(configured)) return (await isFile(configured)) ? configured : undefined;
    return onPath(configured, env, platform);
  }
  for (const candidate of wiresharkCandidates({ env, platform })) {
    if (await isFile(candidate)) return candidate;
  }
  return (await onPath("wireshark", env, platform)) ?? (platform === "win32" ? onPath("Wireshark", env, platform) : undefined);
}

export interface LaunchLocalWiresharkOptions {
  /** Window title, e.g. the lab and its interfaces. */
  title?: string;
  /** The Wireshark executable; found on this machine when unset. */
  binaryPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /**
   * Ends the capture stream, e.g. the abort of the signal it was opened
   * with. Called when Wireshark exits or `stop()` is called.
   */
  stopCapture?: () => void;
}

export interface LocalWiresharkSession {
  pid: number | undefined;
  /** Settles when Wireshark exits, e.g. its window was closed. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Settles when the stream ended or Wireshark stopped reading it. */
  finished: Promise<void>;
  /** Stops the capture; Wireshark stays open with what it read. */
  stop(): void;
}

type WiresharkChild = ChildProcessByStdio<Writable, null, Readable>;

function write(stdin: Writable, chunk: Uint8Array): Promise<boolean> {
  return new Promise((resolve) => {
    if (stdin.destroyed || !stdin.writable) {
      resolve(false);
      return;
    }
    const onError = () => resolve(false);
    stdin.once("error", onError);
    const flushed = stdin.write(chunk, (error) => {
      if (error) resolve(false);
    });
    if (flushed) {
      stdin.off("error", onError);
      resolve(true);
      return;
    }
    const onDrain = () => {
      stdin.off("error", onError);
      stdin.off("close", onClose);
      resolve(true);
    };
    const onClose = () => {
      stdin.off("drain", onDrain);
      resolve(false);
    };
    stdin.once("drain", onDrain);
    stdin.once("close", onClose);
  });
}

/**
 * Starts Wireshark with `-k -i -` and pipes the capture stream into it, as
 * fast as Wireshark reads. Resolves once Wireshark runs. When the stream
 * ends, Wireshark's stdin closes and it shows the finished capture. When
 * Wireshark exits or stops reading, the stream is left, which ends the
 * capture on the lab host.
 */
export async function launchLocalWireshark(
  stream: AsyncIterable<Uint8Array>,
  options: LaunchLocalWiresharkOptions = {}
): Promise<LocalWiresharkSession> {
  const env = options.env ?? process.env;
  const binary = await findWireshark(options.binaryPath, { env, platform: options.platform });
  if (!binary) {
    throw new LabBackendError(
      options.binaryPath
        ? `Wireshark was not found at ${options.binaryPath}.`
        : "Wireshark was not found on this machine. Install Wireshark, or set its path.",
      503
    );
  }
  const args = ["-k", "-i", "-"];
  const title = options.title?.trim();
  if (title) args.push("-o", `gui.window_title:${title}`);

  const child = await new Promise<WiresharkChild>((resolve, reject) => {
    let spawned: WiresharkChild;
    try {
      spawned = spawn(binary, args, { env, stdio: ["pipe", "ignore", "pipe"], detached: false });
    } catch (error) {
      reject(new LabBackendError(`Failed to start Wireshark: ${(error as Error).message}`, 500, { cause: error }));
      return;
    }
    spawned.once("spawn", () => resolve(spawned));
    spawned.once("error", (error) =>
      reject(new LabBackendError(`Failed to start Wireshark: ${error.message}`, 500, { cause: error }))
    );
  });
  // Wireshark's own messages are not ours to show; keep the pipe from filling.
  child.stderr.resume();
  // A Wireshark that exits closes its stdin; writes then fail, which is how the capture learns it.
  child.stdin.on("error", () => {});

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal }))
  );
  const iterator = stream[Symbol.asyncIterator]();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    // A quiet link yields nothing to fail on; ending the stream is what stops it.
    options.stopCapture?.();
  };

  const finished = (async () => {
    try {
      // After stopCapture the stream still ends with its last blocks, which Wireshark gets.
      while (!stopped || options.stopCapture) {
        const next = await iterator.next();
        if (next.done) break;
        if (!(await write(child.stdin, next.value))) break;
      }
    } catch {
      // The capture failed on the lab host; Wireshark shows what arrived.
    } finally {
      // Ends the capture unless it ended by itself.
      await iterator.return?.().catch(() => undefined);
      if (!child.stdin.destroyed) child.stdin.end();
    }
  })();
  void exited.then(stop);

  return {
    pid: child.pid,
    exited,
    finished,
    stop
  };
}
