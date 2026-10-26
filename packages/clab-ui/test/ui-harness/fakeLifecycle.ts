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
  healthcheckedNodes,
  planFakeApply,
  planFakeDeployWaves,
  readTopology,
  resolveFakeNode,
  type DeployWave,
  type DesiredLab,
  type FakeLab,
  type FakeNodeRuntime
} from "./fakeLab";

/** Pause between log lines, so the progress dialog is visible. */
const STEP_MS = 250;
/** Pause after each wait-for wave, so the nodes coming up one group at a time are visible. */
const WAVE_MS = 1500;
/** How long a node with a healthcheck reports `health: starting` once a command is done with it. */
const HEALTHCHECK_MS = 2500;

interface FakeLifecycleDeps {
  currentPath(): string;
  readYaml(path: string): string | undefined;
  /** Show the lab of the current file (or its absence) the way a host refresh would. */
  publish(): Promise<void>;
  /** Show new container data of a running lab, as a periodic host refresh does. */
  refreshRuntime(lab: FakeLab): Promise<void>;
  emit(event: ClabUiTopoViewerEvent): void;
}

interface ActiveRun {
  timer: ReturnType<typeof setTimeout> | undefined;
  cancelled: boolean;
}

/** Part of a staged deploy: log lines, then the lab as it stands afterwards. */
interface DeployStep {
  lines: string[];
  lab: FakeLab;
}

type Outcome =
  | { lines: string[]; next: FakeLab | undefined; steps?: DeployStep[]; trailer?: string[] }
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

function waveLines(wave: DeployWave, watchedHealthy: Set<string>): string[] {
  return [
    ...wave.waitedFor.map((dep) =>
      info(
        `Dependencies met node=${dep.node} stage=${dep.nodeStage} wait-for=${dep.dependsOn}:${dep.dependsOnStage}`
      )
    ),
    ...wave.nodes.map((name) => info(`Creating container name=${name}`)),
    ...wave.nodes
      .filter((name) => watchedHealthy.has(name))
      .map((name) => info(`Node reached stage healthy name=${name}`))
  ];
}

/**
 * Deploy in wait-for order: when nodes wait for others, each wave is published
 * on its own so the canvas shows them coming up one group at a time.
 */
function stagedDeploy(desired: DesiredLab, nodeFilter: string[] | undefined, before: string[]): Outcome {
  const next = deployFakeLab(desired, nodeFilter);
  const plan = planFakeDeployWaves(desired, nodeFilter);
  if ("error" in plan) return { lines: before, error: plan.error };
  if (plan.waves.length < 2) return { lines: [...before, ...deployLines(next)], next };

  const watchedHealthy = new Set(
    plan.waves.flatMap((wave) =>
      wave.waitedFor.filter((dep) => dep.dependsOnStage === "healthy").map((dep) => dep.dependsOn)
    )
  );
  // Only the newest wave is still in its healthcheck; earlier waves passed theirs.
  const started: string[] = [];
  const steps = plan.waves.map((wave) => {
    started.push(...wave.nodes);
    return {
      lines: waveLines(wave, watchedHealthy),
      lab: withStartingNodes(deployFakeLab(desired, [...started]), wave.nodes)
    };
  });
  return {
    lines: [...before, info(`Creating lab directory path=./clab-${next.labName}`)],
    steps,
    trailer: [
      ...next.links.map((link) => info(`Created link: ${link.replace(" -- ", " ▪┄┄▪ ")}`)),
      info("Adding host entries path=/etc/hosts")
    ],
    next: withStartingNodes(next, plan.waves.at(-1)?.nodes ?? [])
  };
}

/** The lab with the healthchecks of these nodes, and only these, starting over. */
function withStartingNodes(lab: FakeLab, nodes: Iterable<string>): FakeLab {
  return { ...lab, startingNodes: healthcheckedNodes(lab, nodes) };
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

/** The lab with these nodes stopped, and the healthchecks of `started` starting over. */
function withNodeStates(
  lab: FakeLab,
  stopped: Set<string>,
  started: Iterable<string> = []
): FakeLab {
  const startingNodes = [...lab.startingNodes, ...healthcheckedNodes(lab, started)].filter(
    (name) => !stopped.has(name)
  );
  return {
    ...lab,
    stoppedNodes: stopped,
    startingNodes: new Set(startingNodes),
    runtimeOverrides: new Map()
  };
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
  return stagedDeploy(desired, options?.nodeFilter, []);
};

const applyOutcome: OutcomeHandler = (running, desired) => {
  if (!running) return stagedDeploy(desired, undefined, []);
  const plan = planFakeApply(running, desired);
  const touched = [
    ...plan.addedNodes,
    ...plan.recreatedNodes,
    ...plan.startedNodes,
    ...plan.restartedNodes
  ];
  return {
    lines: applyLines(plan),
    next: withStartingNodes(deployFakeLab(desired), [...running.startingNodes, ...touched])
  };
};

const redeployOutcome: OutcomeHandler = (running, desired, _options, cleanup) => {
  if (!running) return notRunning(desired.labName);
  return stagedDeploy(
    desired,
    undefined,
    destroyLines(running, [...running.nodes.keys()], cleanup)
  );
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
    return { lines, next: withNodeStates(running, stopped, stop ? [] : running.nodes.keys()) };
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
  const healthchecks = new Map<string, ReturnType<typeof setTimeout>>();
  let active: ActiveRun | undefined;

  function cancelHealthchecks(path: string): void {
    clearTimeout(healthchecks.get(path));
    healthchecks.delete(path);
  }

  /** Let the healthchecks of the lab's starting nodes pass after a while. */
  function scheduleHealthchecks(path: string): void {
    cancelHealthchecks(path);
    if ((labs.get(path)?.startingNodes.size ?? 0) === 0) return;
    healthchecks.set(
      path,
      setTimeout(() => {
        healthchecks.delete(path);
        const lab = labs.get(path);
        if (!lab) return;
        const healthy = { ...lab, startingNodes: new Set<string>() };
        labs.set(path, healthy);
        if (deps.currentPath() === path) void deps.refreshRuntime(healthy);
      }, HEALTHCHECK_MS)
    );
  }

  const desiredFor = (path: string): DesiredLab | undefined => {
    const yaml = deps.readYaml(path);
    return yaml === undefined ? undefined : readTopology(yaml);
  };

  const status = (event: Extract<ClabUiTopoViewerEvent, { type: "lifecycleStatus" }>) =>
    deps.emit(event);

  async function pause(ms: number, run: ActiveRun): Promise<boolean> {
    await new Promise<void>((resolve) => {
      run.timer = setTimeout(resolve, ms);
    });
    return !run.cancelled;
  }

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

  /** Publish each wave of a staged deploy, then stream what follows it. */
  async function runSteps(
    path: string,
    outcome: { steps?: DeployStep[]; trailer?: string[] },
    run: ActiveRun
  ): Promise<boolean> {
    for (const step of outcome.steps ?? []) {
      if (!(await stream(step.lines, run))) return false;
      labs.set(path, step.lab);
      await deps.publish();
      if (!(await pause(WAVE_MS, run))) return false;
    }
    return stream(outcome.trailer ?? [], run);
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
      for (const path of healthchecks.keys()) cancelHealthchecks(path);
      labs.clear();
    },

    async run(action: TopoViewerLifecycleAction, options?: LabLifecycleOptions): Promise<void> {
      if (active) return;
      const path = deps.currentPath();
      const desired = desiredFor(path);
      if (!desired) return;
      cancelHealthchecks(path);
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
      let finished = await stream([...header, ...outcome.lines], run);
      if (finished && "steps" in outcome) finished = await runSteps(path, outcome, run);
      if (active === run) active = undefined;
      if (!finished || "error" in outcome) {
        // Whatever came up before the command stopped finishes its healthchecks.
        scheduleHealthchecks(path);
        if (finished && "error" in outcome) {
          status({ type: "lifecycleStatus", status: "error", errorMessage: outcome.error });
        }
        return;
      }
      if (outcome.next) {
        labs.set(path, outcome.next);
      } else {
        labs.delete(path);
      }
      await deps.publish();
      status({ type: "lifecycleStatus", status: "success" });
      scheduleHealthchecks(path);
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
      labs.set(path, withNodeStates(lab, stopped, action === "stop" ? [] : [nodeName]));
      await deps.publish();
      scheduleHealthchecks(path);
    },

    /**
     * Force a node's state and status, e.g. `{ status: "Up 1 minute (unhealthy)" }`,
     * until the next lifecycle command; `null` goes back to what the fake lab reports.
     */
    async setNodeRuntime(name: string, runtime: FakeNodeRuntime | null): Promise<void> {
      const path = deps.currentPath();
      const lab = labs.get(path);
      const nodeName = lab ? resolveFakeNode(lab, name) : undefined;
      if (!lab || nodeName === undefined) {
        throw new Error(`No running fake node "${name}" in ${path}`);
      }
      const runtimeOverrides = new Map(lab.runtimeOverrides);
      if (runtime) runtimeOverrides.set(nodeName, runtime);
      else runtimeOverrides.delete(nodeName);
      const next = { ...lab, runtimeOverrides };
      labs.set(path, next);
      await deps.refreshRuntime(next);
    }
  };
}
