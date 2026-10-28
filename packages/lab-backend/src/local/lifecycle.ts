import path from "node:path";

import { labLifecycleCliFlags, topologyFileStem, type LabLifecycleOptions } from "@containerlab/clab-ui/host";

import { c9sPlanFields } from "../c9sPlan.ts";
import type {
  LabLifecycleAction,
  LabTarget,
  LifecycleRunOptions,
  LifecycleStreamEvent
} from "../contract/backend.ts";
import type { InspectAllLabsResponse, LifecycleActionResult } from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import type { ResolvedLocalOptions } from "./options.ts";
import {
  containerlabCommand,
  lastContainerlabError,
  runCommand,
  spawnLines,
  stripAnsi,
  type StreamingCommand
} from "./process.ts";
import { isClusterTopologyPath, isRunningTopologyHere } from "./runningTopology.ts";

const LOG_LINE_PATTERN =
  /^(?:\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERRO|ERROR|FATAL|PANIC)\b/;
const KEPT_PREFIXES = ["notice=", "│", "╭", "├", "╰", "🎉=", "deprecated type="];

/**
 * The containerlab output lines clab-api-server forwards: log records, tables
 * and notices, without ANSI codes and without lines that show a username.
 */
export function filterLifecycleLine(raw: string): string | undefined {
  const line = stripAnsi(raw).trim();
  if (!line || line.includes(" username=")) return undefined;
  if (LOG_LINE_PATTERN.test(line) || KEPT_PREFIXES.some((prefix) => line.startsWith(prefix))) {
    return line;
  }
  return undefined;
}

/** clab-api-server's stream classification of a log line. */
export function lifecycleLineStream(line: string): "stdout" | "stderr" {
  const upper = line.toUpperCase();
  return upper.includes(" ERROR ") ||
    upper.includes(" FATAL ") ||
    upper.includes("PANIC") ||
    upper.startsWith("STDERR:")
    ? "stderr"
    : "stdout";
}

const ACTION_VERBS: Record<LabLifecycleAction, string> = {
  deploy: "deploy",
  destroy: "destroy",
  redeploy: "redeploy",
  apply: "apply",
  start: "start",
  stop: "stop",
  restart: "restart"
};

const NODE_ACTION_PAST: Record<"start" | "stop" | "restart", string> = {
  start: "started",
  stop: "stopped",
  restart: "restarted"
};

interface ApplyPlanJson {
  "dry-run"?: boolean;
  "deployed-lab"?: boolean;
  "lab-name"?: string;
  "added-nodes"?: string[] | null;
  "deleted-nodes"?: string[] | null;
  "recreated-nodes"?: string[] | null;
  "started-nodes"?: string[] | null;
  "added-links"?: string[] | null;
  "deleted-endpoints"?: string[] | null;
  "restarted-nodes"?: string[] | null;
  "node-change-reasons"?: Record<string, string> | null;
}

interface C9sDeployPlanJson {
  "lab-name"?: string;
  namespace?: string;
  changes?: unknown;
}

/** A c9s deploy plan in the `ApplyLabResponse` shape, with its resource changes. */
function toC9sApplyLabResponse(plan: C9sDeployPlanJson, labName: string, dryRun: boolean) {
  return {
    ...toApplyLabResponse({ "lab-name": plan["lab-name"] ?? labName }, labName, dryRun),
    ...c9sPlanFields(plan)
  };
}

/** containerlab's apply plan in clab-api-server's `ApplyLabResponse` shape. */
export function toApplyLabResponse(plan: ApplyPlanJson, labName: string, dryRun: boolean) {
  const list = (value: string[] | null | undefined) => (Array.isArray(value) ? value : []);
  return {
    dryRun,
    deployedLab: plan["deployed-lab"] === true,
    labName: plan["lab-name"] ?? labName,
    addedNodes: list(plan["added-nodes"]),
    deletedNodes: list(plan["deleted-nodes"]),
    recreatedNodes: list(plan["recreated-nodes"]),
    startedNodes: list(plan["started-nodes"]),
    addedLinks: list(plan["added-links"]),
    deletedEndpoints: list(plan["deleted-endpoints"]),
    restartedNodes: list(plan["restarted-nodes"]),
    nodeChangeReasons: plan["node-change-reasons"] ?? {}
  };
}

function parseJsonOutput(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("containerlab returned no JSON");
  }
  return JSON.parse(stdout.slice(start, end + 1)) as unknown;
}

/** The lab's name, or its topology file name when the host gave none. */
function labDisplayName(lab: LabTarget): string {
  if (lab.labName) return lab.labName;
  const file = (lab.path ?? "").split(/[\\/]/).pop() ?? "";
  return topologyFileStem(file) || "lab";
}

export interface LifecycleContext {
  options: ResolvedLocalOptions;
  /** The environment of a command on a lab, e.g. with its c9s namespace. */
  labEnv?(labName: string): Promise<NodeJS.ProcessEnv>;
  /** Absolute path of a workspace topology, or of an absolute/URL path given as is. */
  resolveTopology(labName: string, rawPath: string): Promise<string>;
  /** Absolute path of the topology a running lab was deployed from. */
  runningTopologyFile(labName: string): Promise<string | undefined>;
  inspectLab(labName: string): Promise<InspectAllLabsResponse[string]>;
}

interface PreparedCommand {
  args: string[];
  cwd: string;
  labName: string;
  env: NodeJS.ProcessEnv;
}

/** Actions on a running lab, which may go by its name when its topology file is not here. */
const RUNNING_LAB_ACTIONS: ReadonlySet<LabLifecycleAction> = new Set(["destroy", "start", "stop", "restart"]);

/** Runs containerlab lifecycle actions the way clab-api-server reports them. */
export class LocalLifecycle {
  private readonly busy = new Map<string, LabLifecycleAction>();

  private readonly context: LifecycleContext;

  constructor(context: LifecycleContext) {
    this.context = context;
  }

  private async prepare(
    action: LabLifecycleAction,
    lab: LabTarget,
    options: LifecycleRunOptions,
    extraArgs: string[] = []
  ): Promise<PreparedCommand> {
    const { runtime, deployExtraArgs, destroyExtraArgs, workspaceRoot } = this.context.options;
    const topology = await this.topologyFor(action, lab);
    // c9s deploys again to apply a changed topology: the plan is deploy's dry run.
    const verb = runtime === "c9s" && action === "apply" ? "deploy" : ACTION_VERBS[action];
    const args = [verb, "-r", runtime];
    switch (action) {
      case "deploy":
        args.push(...deployExtraArgs);
        if (options.cleanup) args.push("--reconfigure");
        if (lab.labName) args.push("--name", lab.labName);
        args.push(...labLifecycleCliFlags(this.withHostDefaults(options.lifecycleOptions)));
        break;
      case "redeploy":
        args.push(...deployExtraArgs);
        if (options.cleanup) args.push("--cleanup");
        args.push(...labLifecycleCliFlags(this.withHostDefaults(options.lifecycleOptions)));
        break;
      case "destroy":
        args.push(...destroyExtraArgs);
        if (options.cleanup) args.push("--cleanup");
        args.push(...labLifecycleCliFlags(options.lifecycleOptions));
        break;
      case "apply":
        if (options.dryRun) args.push("--dry-run");
        if (runtime === "c9s") args.push(...labLifecycleCliFlags(this.withHostDefaults(undefined)));
        break;
      case "start":
      case "stop":
      case "restart":
        break;
    }
    args.push(...extraArgs);
    const byFile =
      topology !== undefined &&
      (RUNNING_LAB_ACTIONS.has(action)
        ? await isRunningTopologyHere(runtime, topology)
        : !isClusterTopologyPath(topology));
    if (byFile) {
      args.push("-t", topology);
    } else {
      args.push("--name", lab.labName);
    }
    const cwd = byFile && !/^[a-z][a-z0-9+.-]*:\/\//i.test(topology) ? path.dirname(topology) : workspaceRoot;
    const env =
      lab.labName && this.context.labEnv ? await this.context.labEnv(lab.labName) : this.context.options.env;
    return { args, cwd, labName: lab.labName, env };
  }

  /** A c9s host's deploy defaults (exposure, persistence, pull secret) where the options leave them open. */
  private withHostDefaults(options: LabLifecycleOptions | undefined): LabLifecycleOptions | undefined {
    const c9s = this.context.options.c9s;
    if (this.context.options.runtime !== "c9s" || !c9s) return options;
    return {
      ...options,
      ...(options?.exposeType === undefined && c9s.exposeType ? { exposeType: c9s.exposeType } : {}),
      ...(options?.noPersistence === undefined && c9s.persistence === false ? { noPersistence: true } : {}),
      ...(options?.imagePullSecret === undefined && c9s.imagePullSecret ? { imagePullSecret: c9s.imagePullSecret } : {})
    };
  }

  private async topologyFor(action: LabLifecycleAction, lab: LabTarget): Promise<string | undefined> {
    // A host that knows the file (an absolute path or a URL) uses it for every action.
    if (lab.path && (path.isAbsolute(lab.path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(lab.path))) {
      return this.context.resolveTopology(lab.labName, lab.path);
    }
    if (action === "deploy" || (action === "apply" && lab.path)) {
      const rawPath = lab.path ?? `${lab.labName}/${lab.labName}.clab.yml`;
      return this.context.resolveTopology(lab.labName, rawPath);
    }
    const running = await this.context.runningTopologyFile(lab.labName);
    if (running) return running;
    if (action === "apply") {
      return this.context.resolveTopology(lab.labName, `${lab.labName}/${lab.labName}.clab.yml`);
    }
    if (action === "destroy") return undefined;
    throw new LabBackendError(`Lab '${lab.labName}' not found.`, 404);
  }

  private acquire(lab: LabTarget, action: LabLifecycleAction): () => void {
    const labName = labDisplayName(lab);
    const current = this.busy.get(labName);
    if (current) {
      throw new LabBackendError(`Lab '${labName}' is busy with ${current} operation.`, 409);
    }
    this.busy.set(labName, action);
    return () => {
      if (this.busy.get(labName) === action) this.busy.delete(labName);
    };
  }

  private failure(action: LabLifecycleAction, labName: string, detail: string): string {
    return `Failed to ${ACTION_VERBS[action]} lab '${labName}': ${detail}`;
  }

  private successMessage(action: LabLifecycleAction, labName: string): string | undefined {
    switch (action) {
      case "destroy":
        return `Lab '${labName}' destroyed successfully`;
      case "redeploy":
        return `Lab '${labName}' redeployed successfully`;
      case "start":
      case "stop":
      case "restart":
        return `Lab '${labName}' nodes ${NODE_ACTION_PAST[action]} successfully.`;
      default:
        return undefined;
    }
  }

  async run(
    action: LabLifecycleAction,
    lab: LabTarget,
    options: LifecycleRunOptions = {}
  ): Promise<LifecycleActionResult> {
    if (action === "apply" && options.dryRun) {
      return { result: await this.plan(lab), logs: [] };
    }
    const release = this.acquire(lab, action);
    try {
      const plan = action === "apply" ? await this.plan(lab) : undefined;
      const prepared = await this.prepare(action, lab, options);
      const [file, args] = containerlabCommand(this.context.options, prepared.args);
      const result = await runCommand(file, args, {
        cwd: prepared.cwd,
        env: prepared.env,
        signal: options.signal
      });
      const logs = `${result.stderr}\n${result.stdout}`
        .split("\n")
        .map(filterLifecycleLine)
        .filter((line): line is string => line !== undefined);
      if (result.code !== 0) {
        const detail = lastContainerlabError(stripAnsi(result.stderr)) ?? `exit status ${result.code}`;
        throw Object.assign(new LabBackendError(this.failure(action, labDisplayName(lab), detail), 500), { logs });
      }
      return {
        result: lab.labName ? await this.resultFor(action, lab.labName, plan) : undefined,
        message: this.successMessage(action, labDisplayName(lab)),
        logs
      };
    } finally {
      release();
    }
  }

  async stream(
    action: LabLifecycleAction,
    lab: LabTarget,
    options: LifecycleRunOptions = {}
  ): Promise<AsyncIterable<LifecycleStreamEvent>> {
    const release = this.acquire(lab, action);
    let command: StreamingCommand;
    try {
      const prepared = await this.prepare(action, lab, options);
      const [file, args] = containerlabCommand(this.context.options, prepared.args);
      command = await spawnLines(file, args, {
        cwd: prepared.cwd,
        env: prepared.env,
        signal: options.signal
      });
    } catch (error) {
      release();
      throw error;
    }
    const failure = (detail: string) => this.failure(action, labDisplayName(lab), detail);
    const message = this.successMessage(action, labDisplayName(lab));
    const startStop = action === "start" || action === "stop" || action === "restart";

    async function* events(): AsyncGenerator<LifecycleStreamEvent> {
      let lastError: string | undefined;
      try {
        for await (const output of command.lines) {
          const line = filterLifecycleLine(output.line);
          if (!line) continue;
          lastError = lastContainerlabError(line) ?? lastError;
          yield { type: "log", line, stream: lifecycleLineStream(line) };
        }
        const exit = await command.exit;
        if (exit.code === 0) {
          yield startStop && message ? { type: "done", message } : { type: "done" };
        } else if (!options.signal?.aborted) {
          yield {
            type: "error",
            error: failure(lastError ?? (exit.signal ? `terminated by ${exit.signal}` : `exit status ${exit.code}`))
          };
        }
      } finally {
        command.kill();
        release();
      }
    }
    return events();
  }

  /** `containerlab apply --dry-run`: what applying the topology would change. */
  async plan(lab: LabTarget) {
    const prepared = await this.prepare("apply", lab, { dryRun: true }, ["--format", "json"]);
    const [file, args] = containerlabCommand(this.context.options, prepared.args);
    const result = await runCommand(file, args, { cwd: prepared.cwd, env: prepared.env });
    if (result.code !== 0) {
      const detail = lastContainerlabError(stripAnsi(result.stderr)) ?? `exit status ${result.code}`;
      throw new LabBackendError(this.failure("apply", labDisplayName(lab), detail), 500);
    }
    if (this.context.options.runtime === "c9s") {
      return toC9sApplyLabResponse(parseJsonOutput(result.stdout) as C9sDeployPlanJson, labDisplayName(lab), true);
    }
    return toApplyLabResponse(parseJsonOutput(result.stdout) as ApplyPlanJson, labDisplayName(lab), true);
  }

  private async resultFor(
    action: LabLifecycleAction,
    labName: string,
    plan: ReturnType<typeof toApplyLabResponse> | undefined
  ): Promise<unknown> {
    switch (action) {
      case "deploy":
      case "redeploy":
        return { [labName]: await this.context.inspectLab(labName) };
      case "apply":
        return plan ? { ...plan, dryRun: false } : undefined;
      default:
        return undefined;
    }
  }
}
