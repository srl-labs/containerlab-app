/**
 * Wireshark on this machine, reading a capture stream on stdin
 * (`wireshark -k -i -`). The desktop app's way to show captures: it cannot
 * open `packetflix:` links.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

import { LabBackendError } from "../contract/errors.ts";
import { runCommand } from "./process.ts";

export interface FindWiresharkOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /**
   * WSL only: the Windows program folders (`%ProgramFiles%`,
   * `%ProgramFiles(x86)%`) as Linux paths. Asked from Windows through
   * `cmd.exe` and `wslpath` when unset; tests pass them.
   */
  windowsProgramFolders?: () => Promise<string[]>;
  /** `/proc/version`, which names Microsoft under WSL; read when unset and `env` is this process's. */
  procVersion?: string;
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
 * Whether this is Linux under WSL: `WSL_DISTRO_NAME` or `WSL_INTEROP` in the
 * environment, or a kernel that names Microsoft. `/proc/version` is only read
 * for this process's own environment; a given one describes another machine.
 */
async function isWsl(options: FindWiresharkOptions, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  let version = options.procVersion;
  if (version === undefined && options.env === undefined) {
    version = await fs.readFile("/proc/version", "utf8").catch(() => "");
  }
  return /microsoft/i.test(version ?? "");
}

/** Where Windows mounts C: when it cannot be asked (`/mnt/c` unless `wsl.conf` moves it). */
const WSL_FALLBACK_PROGRAM_FOLDERS = ["/mnt/c/Program Files", "/mnt/c/Program Files (x86)"];

/** The Windows program folders as Linux paths, asked from Windows through WSL interop. */
async function askWindowsProgramFolders(env: NodeJS.ProcessEnv): Promise<string[]> {
  try {
    const echoed = await runCommand("cmd.exe", ["/d", "/c", "echo %ProgramFiles%&echo %ProgramFiles(x86)%"], {
      env,
      timeoutMs: 5000
    });
    const windowsPaths = echoed.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      // An unset variable echoes itself.
      .filter((line) => /^[A-Za-z]:\\/.test(line));
    const folders: string[] = [];
    for (const windowsPath of windowsPaths) {
      const converted = await runCommand("wslpath", ["-u", windowsPath], { env, timeoutMs: 5000 });
      const folder = converted.stdout.trim();
      if (converted.code === 0 && folder) folders.push(folder);
    }
    if (folders.length > 0) return folders;
  } catch {
    // No interop (disabled in wsl.conf): guess the default mount.
  }
  return WSL_FALLBACK_PROGRAM_FOLDERS;
}

let windowsProgramFoldersOnce: Promise<string[]> | undefined;

/** Wireshark installed on Windows, as seen from WSL: `<program folder>/Wireshark/Wireshark.exe`. */
async function windowsWiresharkFromWsl(
  options: FindWiresharkOptions,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const folders = options.windowsProgramFolders
    ? await options.windowsProgramFolders()
    : await (windowsProgramFoldersOnce ??= askWindowsProgramFolders(env));
  for (const folder of folders) {
    const candidate = path.posix.join(folder, "Wireshark", "Wireshark.exe");
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The Wireshark executable: `binaryPath` when given (a path, or a name on
 * PATH), else the platform's install location, else `wireshark` on PATH,
 * else, under WSL, Wireshark installed on Windows: WSL interop runs it, and
 * it reads the capture from stdin like any other (`Wireshark.exe -k -i -`).
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
  const found =
    (await onPath("wireshark", env, platform)) ?? (platform === "win32" ? await onPath("Wireshark", env, platform) : undefined);
  if (found || platform !== "linux" || !(await isWsl(options, env))) return found;
  return windowsWiresharkFromWsl(options, env);
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
