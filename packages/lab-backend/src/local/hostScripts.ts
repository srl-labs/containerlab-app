import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  hostScriptRequestProblem,
  hostScriptUnavailableMessage,
  type LabHostScriptDescription,
  type LabHostScriptEvent,
  type LabHostScriptRequest,
  type LabHostScriptResult,
  type LabHostScriptSource
} from "@containerlab/clab-ui/host";

import type { HostScriptRunOptions } from "../contract/backend.ts";
import { collectHostScript } from "../contract/hostScripts.ts";
import { LabBackendError } from "../contract/errors.ts";
import type { ResolvedLocalOptions } from "./options.ts";
import { startScriptProcess } from "./scriptProcess.ts";

/** A script file is read to show and check it, so it has to fit in memory. */
const MAX_SCRIPT_FILE_BYTES = 10 * 1024 * 1024;
/** How much of a script the confirmation shows. */
const MAX_PREVIEW_BYTES = 64 * 1024;
/** Settings of the app around the lab backend; scripts have no use for them. */
const APP_ENV_PREFIXES = ["ELECTRON_", "VSCODE_", "WEB_", "CONTAINERLAB_WEB_", "CONTAINERLAB_DESKTOP_", "CLAB_API_"];

interface LocalLab {
  labName: string;
  topology?: string;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

async function resolveScriptFile(
  scriptPath: string,
  topology: string | undefined
): Promise<{ file: string; stat: Stats }> {
  const expanded = expandHome(scriptPath);
  if (!path.isAbsolute(expanded) && topology === undefined) {
    throw new LabBackendError(
      `Cannot resolve ${scriptPath}: the lab's topology folder is unknown. Use an absolute path.`,
      400
    );
  }
  const file = path.resolve(topology === undefined ? "/" : path.dirname(topology), expanded);
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new LabBackendError(`${scriptPath} is not a file.`, 400);
    return { file, stat };
  } catch (error) {
    if (error instanceof LabBackendError) throw error;
    throw new LabBackendError(`Script not found: ${file}`, 404, { cause: error });
  }
}

function assertScriptsAllowed(options: ResolvedLocalOptions): void {
  if (options.hostScripts) return;
  const reason = options.runtime === "c9s" ? "c9s" : "disabled";
  throw new LabBackendError(hostScriptUnavailableMessage(reason), 501);
}

function assertValidRequest(request: LabHostScriptRequest): void {
  const problem = hostScriptRequestProblem(request);
  if (problem !== undefined) throw new LabBackendError(problem, 400);
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readScriptFile(file: string, stat: Stats): Promise<Buffer> {
  if (stat.size > MAX_SCRIPT_FILE_BYTES) {
    throw new LabBackendError(`${file} is larger than ${MAX_SCRIPT_FILE_BYTES / (1024 * 1024)} MiB.`, 413);
  }
  try {
    return await fs.readFile(file);
  } catch (error) {
    throw new LabBackendError(`Cannot read ${file}: ${(error as Error).message}`, 403, { cause: error });
  }
}

/** Another user's file, as far as this machine's owners tell. */
function ownedByOther(stat: Pick<Stats, "uid">): boolean {
  return process.getuid !== undefined && stat.uid !== process.getuid();
}

async function topologyOwnedByOther(topology: string | undefined): Promise<boolean> {
  if (topology === undefined) return false;
  try {
    return ownedByOther(await fs.stat(topology));
  } catch {
    return false;
  }
}

/** What a script is right now, for the confirmation and for checking what a run was agreed to. */
export async function describeLocalHostScript(
  options: ResolvedLocalOptions,
  lab: LocalLab,
  source: LabHostScriptSource
): Promise<LabHostScriptDescription> {
  assertScriptsAllowed(options);
  assertValidRequest(source);
  const scriptPath = source.scriptPath?.trim() ?? "";
  const foreignLab = await topologyOwnedByOther(lab.topology);

  let content: Buffer;
  let details: Pick<LabHostScriptDescription, "kind" | "resolvedPath" | "owner" | "foreign">;
  if (scriptPath !== "") {
    const { file, stat } = await resolveScriptFile(scriptPath, lab.topology);
    content = await readScriptFile(file, stat);
    details = {
      kind: "file",
      resolvedPath: file,
      owner: ownedByOther(stat) ? `uid ${stat.uid}` : options.username,
      foreign: foreignLab || ownedByOther(stat)
    };
  } else {
    content = Buffer.from(source.script ?? "");
    details = { kind: "inline", foreign: foreignLab };
  }

  const digest = sha256(content);
  return {
    ...details,
    sha256: digest,
    size: content.length,
    content: content.subarray(0, MAX_PREVIEW_BYTES).toString("utf8"),
    truncated: content.length > MAX_PREVIEW_BYTES,
    trustKey: sha256(`${os.hostname()}\n${lab.topology ?? lab.labName}\n${digest}`)
  };
}

/** The environment of a script: this process's, without the app's own settings. */
function scriptEnvironment(options: ResolvedLocalOptions, lab: LocalLab): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(options.env)) {
    if (!APP_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) env[key] = value;
  }
  env.CLAB_LAB_NAME = lab.labName;
  if (lab.topology !== undefined) env.CLAB_TOPOLOGY = lab.topology;
  return env;
}

async function scriptFolder(options: ResolvedLocalOptions, lab: LocalLab): Promise<string> {
  const folder = lab.topology !== undefined ? path.dirname(lab.topology) : options.workspaceRoot;
  const stat = await fs.stat(folder).catch(() => undefined);
  if (!stat?.isDirectory()) throw new LabBackendError(`The lab's folder does not exist: ${folder}`, 404);
  return folder;
}

/**
 * Starts a script button's script with bash on this machine, from the topology
 * folder, and yields its output as it comes, then how it ended.
 * `CLAB_LAB_NAME` and `CLAB_TOPOLOGY` tell the script which lab it belongs to.
 */
export async function streamLocalHostScript(
  options: ResolvedLocalOptions,
  lab: LocalLab,
  request: LabHostScriptRequest,
  run: HostScriptRunOptions = {}
): Promise<AsyncIterable<LabHostScriptEvent>> {
  assertScriptsAllowed(options);
  assertValidRequest(request);
  const scriptPath = request.scriptPath?.trim() ?? "";

  let args: string[];
  if (scriptPath !== "") {
    const { file, stat } = await resolveScriptFile(scriptPath, lab.topology);
    args = [file];
    if (request.expectedSha256 !== undefined) {
      assertExpected(sha256(await readScriptFile(file, stat)), request.expectedSha256);
    }
  } else {
    args = ["-c", request.script ?? ""];
    if (request.expectedSha256 !== undefined) {
      assertExpected(sha256(request.script ?? ""), request.expectedSha256);
    }
  }

  const started = Date.now();
  const command = await startScriptProcess("bash", args, {
    cwd: await scriptFolder(options, lab),
    env: scriptEnvironment(options, lab),
    ...(run.signal !== undefined ? { signal: run.signal } : {}),
    ...(request.timeoutSeconds !== undefined ? { timeoutMs: request.timeoutSeconds * 1000 } : {})
  });

  async function* events(): AsyncGenerator<LabHostScriptEvent> {
    try {
      for await (const { stream, text } of command.output) {
        yield { type: "output", stream, text };
      }
      const exit = await command.exit;
      yield {
        type: "exit",
        result: {
          exitCode: exit.code,
          // The output went by in the events; `collectHostScript` keeps it when wanted.
          stdout: "",
          stderr: "",
          timedOut: command.timedOut(),
          ...(command.cancelled() ? { cancelled: true } : {}),
          durationMs: Date.now() - started
        }
      };
    } finally {
      // A consumer that stops reading early stops the script.
      command.stop();
    }
  }
  return events();
}

function assertExpected(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new LabBackendError("The script changed since it was confirmed. Run it again to review it.", 409);
  }
}

/** Runs a script button's script to the end and collects its output. */
export async function runLocalHostScript(
  options: ResolvedLocalOptions,
  lab: LocalLab,
  request: LabHostScriptRequest,
  run: HostScriptRunOptions = {}
): Promise<LabHostScriptResult> {
  return collectHostScript(await streamLocalHostScript(options, lab, request, run));
}
