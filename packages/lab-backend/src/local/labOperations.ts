import fs from "node:fs/promises";
import path from "node:path";

import {
  isValidLabActionPath,
  isValidLabelFilter,
  isValidLifecycleNodeName,
  summarizeSnapshots,
  type LabExecRequest,
  type LabOperationSupport,
  type LabSnapshotSaveRequest,
  type TopoViewerNodesAction
} from "@containerlab/clab-ui/host";

import type {
  ExecResponse,
  InspectDetailsResponse,
  LifecycleActionResult,
  SnapshotNodeResult,
  SnapshotSaveResponse
} from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import { filterLifecycleLine } from "./lifecycle.ts";
import type { ResolvedLocalOptions } from "./options.ts";
import {
  containerlabCommand,
  lastContainerlabError,
  runCommand,
  stripAnsi,
  type CommandResult
} from "./process.ts";

/** containerlab release that brought VM snapshots and `deploy --restore`. */
const SNAPSHOT_RELEASE: readonly [number, number] = [0, 72];
/** containerlab release that brought `save --copy`. */
const SAVE_COPY_RELEASE: readonly [number, number] = [0, 73];

const DURATION_PATTERN = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/;
const DEFAULT_SNAPSHOT_DIR = "snapshots";

/** Where containerlab runs for a lab: by topology file, else by lab name. */
export interface LocalLabRef {
  topology?: string;
  labName: string;
}

function atLeast(version: string | undefined, release: readonly [number, number]): boolean {
  const match = /^v?(\d+)\.(\d+)/.exec(version ?? "");
  // A build without a release version is a development build: assume it is current.
  if (!match) return true;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > release[0] || (major === release[0] && minor >= release[1]);
}

/** What the installed containerlab can do, by its version. */
export function localOperationSupport(
  version: string | undefined,
  hostScripts = true
): LabOperationSupport {
  const snapshots = atLeast(version, SNAPSHOT_RELEASE);
  return {
    execByLabel: true,
    snapshotSave: snapshots,
    deployRestore: snapshots,
    saveCopy: atLeast(version, SAVE_COPY_RELEASE),
    inspectDetails: true,
    hostScript: hostScripts
  };
}

function labArgs(lab: LocalLabRef): string[] {
  return lab.topology ? ["-t", lab.topology] : ["--name", lab.labName];
}

function labCwd(options: ResolvedLocalOptions, lab: LocalLabRef): string {
  return lab.topology ? path.dirname(lab.topology) : options.workspaceRoot;
}

function failure(action: string, result: CommandResult): LabBackendError {
  const output = stripAnsi(`${result.stderr}\n${result.stdout}`);
  const detail = lastContainerlabError(output) ?? `exit status ${result.code ?? "signal"}`;
  return new LabBackendError(`Failed to ${action}: ${detail}`, 500);
}

function jsonObject(stdout: string): Record<string, unknown> | undefined {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function checkNodeNames(nodeNames: readonly string[]): void {
  const invalid = nodeNames.find((name) => !isValidLifecycleNodeName(name));
  if (invalid !== undefined) throw new LabBackendError(`Invalid node name '${invalid}'.`, 400);
}

/**
 * `containerlab exec`, once per chosen node so the command only runs where it
 * was asked to. Every call stays inside the lab: by its topology file, or by
 * the lab's `containerlab` label.
 */
export async function localExec(
  options: ResolvedLocalOptions,
  lab: LocalLabRef,
  request: LabExecRequest
): Promise<ExecResponse> {
  const command = request.command.trim();
  if (!command) throw new LabBackendError("Command cannot be empty.", 400);
  const labels = request.labels ?? [];
  const invalidLabel = labels.find((label) => !isValidLabelFilter(label));
  if (invalidLabel !== undefined) {
    throw new LabBackendError(`Invalid label filter '${invalidLabel}'. Use key=value.`, 400);
  }
  const nodeNames = Array.from(new Set(request.nodeNames ?? []));
  checkNodeNames(nodeNames);

  const scope = lab.topology ? ["-t", lab.topology] : ["--label", `containerlab=${lab.labName}`];
  const run = async (extraLabels: string[]): Promise<ExecResponse> => {
    const args = ["exec", "-r", options.runtime, ...scope, `--cmd=${command}`, "--format", "json"];
    for (const label of [...labels, ...extraLabels]) args.push("--label", label);
    const [file, commandArgs] = containerlabCommand(options, args);
    const result = await runCommand(file, commandArgs, {
      cwd: labCwd(options, lab),
      env: options.env,
      timeoutMs: 10 * 60_000
    });
    const parsed = jsonObject(result.stdout);
    if (parsed) return parsed as ExecResponse;
    if (result.code !== 0) throw failure(`run '${command}'`, result);
    return {};
  };

  const responses =
    nodeNames.length > 0
      ? await Promise.all(nodeNames.map((node) => run([`clab-node-name=${node}`])))
      : [await run([])];
  const merged: ExecResponse = Object.assign({}, ...responses);
  if (Object.keys(merged).length === 0) {
    throw new LabBackendError("No running nodes match the selection.", 404);
  }
  return merged;
}

/** Start, stop or restart some nodes: `containerlab <action> --node a,b`. */
export async function localNodesAction(
  options: ResolvedLocalOptions,
  lab: LocalLabRef,
  nodeNames: string[],
  action: TopoViewerNodesAction
): Promise<LifecycleActionResult> {
  const nodes = Array.from(new Set(nodeNames));
  if (nodes.length === 0) throw new LabBackendError("Choose at least one node.", 400);
  checkNodeNames(nodes);
  const args = [action, "-r", options.runtime, ...labArgs(lab), "--node", nodes.join(",")];
  const [file, commandArgs] = containerlabCommand(options, args);
  const result = await runCommand(file, commandArgs, {
    cwd: labCwd(options, lab),
    env: options.env,
    timeoutMs: 10 * 60_000
  });
  const logs = `${result.stderr}\n${result.stdout}`
    .split("\n")
    .map(filterLifecycleLine)
    .filter((line): line is string => line !== undefined);
  if (result.code !== 0) throw Object.assign(failure(`${action} ${nodes.join(", ")}`, result), { logs });
  const past = { start: "started", stop: "stopped", restart: "restarted" }[action];
  return { message: `Nodes ${nodes.join(", ")} ${past} successfully.`, logs };
}

/** `containerlab inspect --details` for one lab. */
export async function localInspectDetails(
  options: ResolvedLocalOptions,
  lab: LocalLabRef
): Promise<InspectDetailsResponse> {
  const args = ["inspect", "-r", options.runtime, ...labArgs(lab), "--details"];
  const [file, commandArgs] = containerlabCommand(options, args);
  const result = await runCommand(file, commandArgs, {
    cwd: labCwd(options, lab),
    env: options.env,
    timeoutMs: 60_000
  });
  if (result.code !== 0) throw failure("inspect the lab", result);
  return (jsonObject(result.stdout) ?? {}) as InspectDetailsResponse;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function logFields(line: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const match of line.matchAll(/(\w[\w-]*)=("(?:[^"\\]|\\.)*"|\S+)/g)) {
    fields.set(match[1], unquote(match[2]));
  }
  return fields;
}

const LOG_PREFIX = /^(?:\d{2}:\d{2}:\d{2} |\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} )?(INFO|WARN|ERRO|ERROR|FATA)\s+(.*)$/;

/**
 * Per-node results from `tools snapshot save` logs: `snapshot saved node=…`,
 * `<node>: skipping (<reason>)` and `<node>: <error>`.
 */
export function parseSnapshotLog(output: string): SnapshotNodeResult[] {
  const results = new Map<string, SnapshotNodeResult>();
  for (const raw of stripAnsi(output).split("\n")) {
    const match = LOG_PREFIX.exec(raw.trim());
    if (!match) continue;
    const [, level, message] = match;
    if (message.startsWith("snapshot saved")) {
      const fields = logFields(message);
      const node = fields.get("node");
      if (!node) continue;
      const result: SnapshotNodeResult = { node, status: "success" };
      const filePath = fields.get("path");
      if (filePath) result.path = filePath;
      results.set(node, result);
      continue;
    }
    const nodeMessage = /^([A-Za-z0-9._-]+): (.*)$/.exec(message);
    if (!nodeMessage) continue;
    const [, node, detail] = nodeMessage;
    if (level === "INFO" && detail.startsWith("skipping")) {
      const reason = /^skipping \((.*)\)$/.exec(detail)?.[1] ?? detail;
      results.set(node, { node, status: "skipped", reason });
    } else if (level !== "INFO" && level !== "WARN") {
      results.set(node, { node, status: "failed", error: detail });
    }
  }
  return Array.from(results.values()).sort((left, right) => left.node.localeCompare(right.node));
}

/** `containerlab tools snapshot save` into a directory next to the topology. */
export async function localSaveSnapshots(
  options: ResolvedLocalOptions,
  topology: string,
  request: LabSnapshotSaveRequest
): Promise<SnapshotSaveResponse> {
  const outputDir = request.outputDir?.trim() || DEFAULT_SNAPSHOT_DIR;
  if (!isValidLabActionPath(outputDir)) throw new LabBackendError("Invalid snapshot directory.", 400);
  const timeout = request.timeout?.trim();
  if (timeout && !DURATION_PATTERN.test(timeout)) {
    throw new LabBackendError(`Invalid timeout '${timeout}'. Use a duration such as 5m.`, 400);
  }
  const nodes = Array.from(new Set(request.nodeNames ?? []));
  checkNodeNames(nodes);

  const directory = path.resolve(path.dirname(topology), outputDir);
  const args = ["tools", "snapshot", "save", "-r", options.runtime, "-t", topology, "--output-dir", directory];
  if (nodes.length > 0) args.push("--node-filter", nodes.join(","));
  if (timeout) args.push("--timeout", timeout);
  const [file, commandArgs] = containerlabCommand(options, args);
  const result = await runCommand(file, commandArgs, {
    cwd: path.dirname(topology),
    env: options.env,
    timeoutMs: 2 * 60 * 60_000
  });
  const results = parseSnapshotLog(`${result.stderr}\n${result.stdout}`);
  if (result.code !== 0 && results.length === 0) throw failure("save snapshots", result);
  await Promise.all(
    results
      .filter((entry) => entry.status === "success")
      .map(async (entry) => {
        entry.path ??= path.join(directory, `${entry.node}.tar`);
        entry.path = path.resolve(path.dirname(topology), entry.path);
        const stat = await fs.stat(entry.path).catch(() => undefined);
        if (stat) entry.sizeBytes = stat.size;
      })
  );
  return { outputDir: directory, results, summary: summarizeSnapshots(results) };
}
