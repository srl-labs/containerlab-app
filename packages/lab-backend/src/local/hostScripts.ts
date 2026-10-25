import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  LabHostScriptEvent,
  LabHostScriptRequest,
  LabHostScriptResult
} from "@containerlab/clab-ui/host";

import { LabBackendError } from "../contract/errors.ts";
import type { ResolvedLocalOptions } from "./options.ts";
import { spawnLines } from "./process.ts";

/** Keeps the tail of each stream so a chatty script cannot flood the UI. */
const MAX_OUTPUT_CHARS = 512 * 1024;

function tail(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `[output truncated to the last ${MAX_OUTPUT_CHARS} characters]\n${output.slice(-MAX_OUTPUT_CHARS)}`;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

async function resolveScriptFile(scriptPath: string, topology: string | undefined): Promise<string> {
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
  } catch (error) {
    if (error instanceof LabBackendError) throw error;
    throw new LabBackendError(`Script not found: ${file}`, 404, { cause: error });
  }
  return file;
}

/**
 * Starts a script button's script with bash on this machine, from the topology
 * folder, and yields its output lines as they come, then how it ended.
 * `CLAB_LAB_NAME` and `CLAB_TOPOLOGY` tell the script which lab it belongs to.
 */
export async function streamLocalHostScript(
  options: ResolvedLocalOptions,
  lab: { labName: string; topology?: string },
  request: LabHostScriptRequest
): Promise<AsyncIterable<LabHostScriptEvent>> {
  if (!options.hostScripts) {
    throw new LabBackendError("Script buttons are turned off on this lab host.", 403);
  }
  const scriptPath = request.scriptPath?.trim() ?? "";
  const script = request.script ?? "";
  if (scriptPath === "" && script.trim() === "") {
    throw new LabBackendError("The script button has no script or script path.", 400);
  }
  const args =
    scriptPath !== "" ? [await resolveScriptFile(scriptPath, lab.topology)] : ["-c", script];
  const timeoutMs =
    request.timeoutSeconds !== undefined && request.timeoutSeconds > 0
      ? request.timeoutSeconds * 1000
      : undefined;
  const env: NodeJS.ProcessEnv = {
    ...options.env,
    CLAB_LAB_NAME: lab.labName,
    ...(lab.topology !== undefined ? { CLAB_TOPOLOGY: lab.topology } : {})
  };

  const started = Date.now();
  const command = await spawnLines("bash", args, {
    cwd: lab.topology !== undefined ? path.dirname(lab.topology) : options.workspaceRoot,
    env
  });
  let timedOut = false;
  const timer =
    timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          command.kill();
        }, timeoutMs)
      : undefined;

  async function* events(): AsyncGenerator<LabHostScriptEvent> {
    const collected = { stdout: "", stderr: "" };
    try {
      for await (const { line, stream } of command.lines) {
        const text = `${line}\n`;
        collected[stream] = tail(collected[stream] + text);
        yield { type: "output", stream, text };
      }
      const exit = await command.exit;
      yield {
        type: "exit",
        result: {
          exitCode: exit.code,
          stdout: collected.stdout,
          stderr: collected.stderr,
          timedOut,
          durationMs: Date.now() - started
        }
      };
    } finally {
      clearTimeout(timer);
      // A consumer that stops reading early, e.g. a closed connection, stops the script.
      command.kill();
    }
  }
  return events();
}

/** Runs a script button's script to the end and collects its output. */
export async function runLocalHostScript(
  options: ResolvedLocalOptions,
  lab: { labName: string; topology?: string },
  request: LabHostScriptRequest
): Promise<LabHostScriptResult> {
  for await (const event of await streamLocalHostScript(options, lab, request)) {
    if (event.type === "exit") return event.result;
  }
  throw new LabBackendError("The script ended without an exit status.", 500);
}
