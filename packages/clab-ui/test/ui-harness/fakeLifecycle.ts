// Fake lab lifecycle for the harness: deploy, apply, destroy and friends stream
// containerlab-like log lines, then change the pretend lab.
import { applyPlanHasChanges, type ApplyPlan } from "../../src/host/applyPlan";
import type {
  ClabUiTopoViewerEvent,
  TopoViewerLifecycleAction,
  TopoViewerNodeAction
} from "../../src/host/contracts";
import type { LabLifecycleOptions } from "../../src/host/lifecycleOptions";

import {
  deployFakeLab,
  destroyFakeNodes,
  fakeContainerName,
  planFakeApply,
  readTopology,
  resolveFakeNode,
  type DesiredLab,
  type FakeLab
} from "./fakeLab";

/** Pause between log lines, so the progress dialog is visible. */
const STEP_MS = 250;

interface FakeLifecycleDeps {
  currentPath(): string;
  readYaml(path: string): string | undefined;
  /** Show the lab of the current file (or its absence) the way a host refresh would. */
  publish(): Promise<void>;
  emit(event: ClabUiTopoViewerEvent): void;
}

interface ActiveRun {
  timer: ReturnType<typeof setTimeout> | undefined;
  cancelled: boolean;
}

type Outcome =
  | { lines: string[]; next: FakeLab | undefined }
  | { lines: string[]; error: string };

const info = (message: string) => `INFO ${message}`;

function deployLines(lab: FakeLab): string[] {
  return [
    info(`Creating lab directory path=./clab-${lab.labName}`),
    ...[...lab.nodes.keys()].map((name) => info(`Creating container name=${name}`)),
    ...lab.links.map((link) => info(`Created link: ${link.replace(" -- ", " ▪┄┄▪ ")}`)),
    info("Adding host entries path=/etc/hosts")
  ];
}

function destroyLines(lab: FakeLab, nodes: string[], cleanup: boolean): string[] {
  return [
    info(`Destroying lab name=${lab.labName}`),
    ...nodes.map((name) => info(`Removed container name=${fakeContainerName(lab, name)}`)),
    ...(cleanup ? [info(`Removing lab directory path=./clab-${lab.labName}`)] : [])
  ];
}

function applyLines(plan: ApplyPlan): string[] {
  if (!applyPlanHasChanges(plan)) return [info("Nothing to apply, the lab is in sync")];
  const reason = (name: string) => plan.nodeChangeReasons[name] ?? "";
  return [
    ...plan.deletedNodes.map((name) => info(`Removing container name=${name}`)),
    ...plan.deletedEndpoints.map((endpoint) => info(`Deleted link end endpoint=${endpoint}`)),
    ...plan.recreatedNodes.map((name) => info(`Recreating container name=${name} reason="${reason(name)}"`)),
    ...plan.addedNodes.map((name) => info(`Creating container name=${name}`)),
    ...plan.startedNodes.map((name) => info(`Starting container name=${name}`)),
    ...plan.addedLinks.map((link) => info(`Created link: ${link.replace(" -- ", " ▪┄┄▪ ")}`)),
    ...plan.restartedNodes.map((name) => info(`Restarting container name=${name} reason="${reason(name)}"`))
  ];
}

function notRunning(labName: string): Outcome {
  return { lines: [], error: `no containers found for lab "${labName}"` };
}

function withNodeStates(lab: FakeLab, stopped: Set<string>): FakeLab {
  return { ...lab, stoppedNodes: stopped };
}

type OutcomeHandler = (
  running: FakeLab | undefined,
  desired: DesiredLab,
  options: LabLifecycleOptions | undefined,
  cleanup: boolean
) => Outcome;

const deployOutcome: OutcomeHandler = (running, desired, options, cleanup) => {
  if (running && !cleanup) {
    return {
      lines: [],
      error: `the "${desired.labName}" lab has already been deployed. Destroy it before deploying it again`
    };
  }
  const next = deployFakeLab(desired, options?.nodeFilter);
  return { lines: deployLines(next), next };
};

const applyOutcome: OutcomeHandler = (running, desired) => {
  const next = deployFakeLab(desired);
  if (!running) return { lines: deployLines(next), next };
  return { lines: applyLines(planFakeApply(running, desired)), next };
};

const redeployOutcome: OutcomeHandler = (running, desired, _options, cleanup) => {
  if (!running) return notRunning(desired.labName);
  const next = deployFakeLab(desired);
  return {
    lines: [...destroyLines(running, [...running.nodes.keys()], cleanup), ...deployLines(next)],
    next
  };
};

const destroyOutcome: OutcomeHandler = (running, desired, options, cleanup) => {
  if (!running) return notRunning(desired.labName);
  const nodeFilter = options?.nodeFilter ?? [];
  const nodes = nodeFilter.length > 0 ? nodeFilter : [...running.nodes.keys()];
  return { lines: destroyLines(running, nodes, cleanup), next: destroyFakeNodes(running, nodeFilter) };
};

function nodeStateOutcome(verb: string, stop: boolean): OutcomeHandler {
  return (running, desired) => {
    if (!running) return notRunning(desired.labName);
    const lines = [...running.nodes.keys()].map((name) => info(`${verb} container name=${name}`));
    const stopped = stop ? new Set(running.nodes.keys()) : new Set<string>();
    return { lines, next: withNodeStates(running, stopped) };
  };
}

const LIFECYCLE_OUTCOMES: Record<TopoViewerLifecycleAction, OutcomeHandler> = {
  deployLab: deployOutcome,
  deployLabCleanup: deployOutcome,
  applyLab: applyOutcome,
  redeployLab: redeployOutcome,
  redeployLabCleanup: redeployOutcome,
  destroyLab: destroyOutcome,
  destroyLabCleanup: destroyOutcome,
  startLab: nodeStateOutcome("Starting", false),
  stopLab: nodeStateOutcome("Stopping", true),
  restartLab: nodeStateOutcome("Restarting", false)
};

export function createFakeLifecycle(deps: FakeLifecycleDeps) {
  const labs = new Map<string, FakeLab>();
  let active: ActiveRun | undefined;

  const desiredFor = (path: string): DesiredLab | undefined => {
    const yaml = deps.readYaml(path);
    return yaml === undefined ? undefined : readTopology(yaml);
  };

  const status = (event: Extract<ClabUiTopoViewerEvent, { type: "lifecycleStatus" }>) =>
    deps.emit(event);

  async function stream(lines: string[], run: ActiveRun): Promise<boolean> {
    for (const line of lines) {
      await new Promise<void>((resolve) => {
        run.timer = setTimeout(resolve, STEP_MS);
      });
      if (run.cancelled) return false;
      deps.emit({ type: "lifecycleLog", line, stream: "stdout" });
    }
    return true;
  }

  return {
    labFor(path: string): FakeLab | undefined {
      return labs.get(path);
    },

    /** Whether the file differs from its running lab; undefined when nothing runs. */
    dirtyFor(path: string): boolean | undefined {
      const running = labs.get(path);
      const desired = desiredFor(path);
      if (!running || !desired) return undefined;
      return applyPlanHasChanges(planFakeApply(running, desired));
    },

    planFor(path: string): ApplyPlan {
      const desired = desiredFor(path);
      if (!desired) throw new Error(`No topology file at ${path}`);
      return planFakeApply(labs.get(path), desired);
    },

    reset(): void {
      if (active) {
        active.cancelled = true;
        clearTimeout(active.timer);
        active = undefined;
      }
      labs.clear();
    },

    async run(action: TopoViewerLifecycleAction, options?: LabLifecycleOptions): Promise<void> {
      if (active) return;
      const path = deps.currentPath();
      const desired = desiredFor(path);
      if (!desired) return;
      const run: ActiveRun = { timer: undefined, cancelled: false };
      active = run;
      const outcome = LIFECYCLE_OUTCOMES[action](
        labs.get(path),
        desired,
        options,
        action.endsWith("Cleanup")
      );
      const header = [
        info("Containerlab started version=0.81.1 (harness)"),
        info(`Parsing & checking topology file=${path.split("/").pop() ?? path}`)
      ];
      const finished = await stream([...header, ...outcome.lines], run);
      if (active === run) active = undefined;
      if (!finished) return;

      if ("error" in outcome) {
        status({ type: "lifecycleStatus", status: "error", errorMessage: outcome.error });
        return;
      }
      if (outcome.next) {
        labs.set(path, outcome.next);
      } else {
        labs.delete(path);
      }
      await deps.publish();
      status({ type: "lifecycleStatus", status: "success" });
    },

    cancel(): void {
      if (!active) {
        status({
          type: "lifecycleStatus",
          status: "error",
          errorMessage: "No active lifecycle command to cancel."
        });
        return;
      }
      active.cancelled = true;
      clearTimeout(active.timer);
      active = undefined;
      status({
        type: "lifecycleStatus",
        status: "error",
        errorMessage: "Lifecycle command cancelled by user."
      });
    },

    /** Start, stop or restart one node; other node actions do nothing here. */
    async nodeAction(action: TopoViewerNodeAction, name: string): Promise<void> {
      const path = deps.currentPath();
      const lab = labs.get(path);
      const nodeName = lab ? resolveFakeNode(lab, name) : undefined;
      if (!lab || nodeName === undefined || (action !== "start" && action !== "stop" && action !== "restart")) {
        return;
      }
      const stopped = new Set(lab.stoppedNodes);
      if (action === "stop") stopped.add(nodeName);
      else stopped.delete(nodeName);
      labs.set(path, withNodeStates(lab, stopped));
      await deps.publish();
    }
  };
}
