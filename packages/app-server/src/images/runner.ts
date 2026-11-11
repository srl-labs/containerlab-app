// The server runs climg itself: it is a host command with a fixed path, never a lab backend operation.
// oxlint-disable-next-line no-restricted-imports
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ImagesConfig } from "./config.ts";

const PROXY_VARIABLES = [
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY"
];
const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const CAPTURE_LIMIT_BYTES = 64 * 1024 * 1024;
const FILE_MODE = 0o660;

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Home folder of a user from `/etc/passwd`; undefined when unknown. */
function homeOf(uid: number): string | undefined {
  try {
    for (const line of fs.readFileSync("/etc/passwd", "utf8").split("\n")) {
      const fields = line.split(":");
      if (fields.length >= 6 && Number(fields[2]) === uid) return fields[5];
    }
  } catch {
    // No passwd file (minimal image): fall back to the server's HOME.
  }
  return undefined;
}

/**
 * The only environment `climg` gets: PATH, HOME (the configured one, else that of the run-as user), CLIMG_*,
 * and the proxy variables. Nothing else is inherited from the server.
 */
export function climgEnvironment(config: ImagesConfig, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {
    PATH: source.PATH?.trim() || DEFAULT_PATH,
    PYTHONUNBUFFERED: "1"
  };
  const home = config.home ?? (config.runAs ? (homeOf(config.runAs.uid) ?? source.HOME) : (source.HOME ?? os.homedir()));
  if (home) env.HOME = home;
  if (config.configPath) env.CLIMG_CONFIG = config.configPath;
  if (config.statePath) env.CLIMG_STATE = config.statePath;
  for (const name of PROXY_VARIABLES) {
    const value = source[name];
    if (value) env[name] = value;
  }
  return { ...env, ...config.extraEnv };
}

export interface SpawnedClimg {
  child: ChildProcess;
  /** Resolves with the exit status; never rejects (a start failure is `code: null` and `startError`). */
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null; startError?: Error }>;
}

/**
 * Starts `climg` from its fixed path: no shell, own process group, the
 * configured run-as user, stdout and stderr appended to the given files so a
 * full pipe cannot stall it and a restart of this server cannot break it.
 */
export function spawnClimg(
  config: ImagesConfig,
  args: string[],
  files: { stdout: number; stderr: number }
): SpawnedClimg {
  const child = spawn(config.climgPath, args, {
    shell: false,
    detached: true,
    stdio: ["ignore", files.stdout, files.stderr],
    env: climgEnvironment(config),
    ...(config.runAs ? { uid: config.runAs.uid, gid: config.runAs.gid } : {}),
    windowsHide: true
  });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; startError?: Error }>((resolve) => {
    let settled = false;
    const settle = (value: { code: number | null; signal: NodeJS.Signals | null; startError?: Error }) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    child.once("error", (error) => settle({ code: null, signal: null, startError: error }));
    child.once("close", (code, signal) => settle({ code, signal }));
  });
  return { child, done };
}

/** Kills a `climg` process group; the group leader is the child itself (`detached`). */
export function signalGroup(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (pid === undefined || pid <= 1) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Opens an output file the run-as user and the host group can read. */
export async function openOutputFile(file: string, chown: (target: string) => Promise<void>): Promise<fsp.FileHandle> {
  const handle = await fsp.open(file, "w", FILE_MODE);
  try {
    await chown(file);
  } catch (error) {
    await handle.close();
    throw error;
  }
  return handle;
}

async function readCapped(file: string): Promise<string> {
  const handle = await fsp.open(file, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, CAPTURE_LIMIT_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

/**
 * Runs a short `climg` command and returns its output. Output goes through
 * files (as for jobs) in a private temp folder; the command is killed with its
 * process group after `timeoutMs`.
 */
export async function runClimg(config: ImagesConfig, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "climg-run-"));
  const outFile = path.join(directory, "out");
  const errFile = path.join(directory, "err");
  const out = await fsp.open(outFile, "w", 0o600);
  const err = await fsp.open(errFile, "w", 0o600);
  try {
    // The files are opened here and handed over; the run-as user needs no access to the folder.
    const { child, done } = spawnClimg(config, args, { stdout: out.fd, stderr: err.fd });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!signalGroup(child.pid, "SIGKILL")) child.kill("SIGKILL");
    }, timeoutMs);
    const exit = await done;
    clearTimeout(timer);
    if (exit.startError) throw exit.startError;
    return {
      code: exit.code,
      signal: exit.signal,
      stdout: await readCapped(outFile),
      stderr: await readCapped(errFile),
      timedOut
    };
  } finally {
    await out.close().catch(() => undefined);
    await err.close().catch(() => undefined);
    await fsp.rm(directory, { recursive: true, force: true });
  }
}
