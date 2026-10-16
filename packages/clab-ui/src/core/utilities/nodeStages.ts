/**
 * Node deployment stages (`stages`): wait-for dependencies and per-stage exec
 * commands, read and written the way containerlab does it.
 */

import { getString, isRecord } from "./typeHelpers";

/** Stages a node goes through, in deployment order */
export const STAGE_NAMES = ["create", "create-links", "configure", "healthy", "exit"] as const;

export type StageName = (typeof STAGE_NAMES)[number];

/** When a stage exec runs; containerlab defaults to on-enter */
const STAGE_EXEC_PHASES = ["on-enter", "on-exit"] as const;

/** Where a stage exec runs; containerlab defaults to the container */
export const STAGE_EXEC_TARGET_HOST = "host";

/** One `wait-for` entry: the node must wait until `node` has finished `stage` */
export interface StageWaitFor {
  node: string;
  stage: string;
}

/** One stage exec command */
export interface StageExec {
  command: string;
  phase?: string;
  target?: string;
}

export interface StageConfig {
  waitFor?: StageWaitFor[];
  exec?: StageExec[];
}

export type NodeStages = Partial<Record<StageName, StageConfig>>;

/** Stages a node inherits from one level (defaults, kind or group) */
export interface InheritedStages {
  level: string;
  stages: NodeStages;
}

/** Node data key with the stages each inheritance level adds */
export const INHERITED_STAGES_KEY = "inheritedStages";

function parseWaitFor(value: unknown): StageWaitFor[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    node: getString(entry.node) ?? "",
    stage: getString(entry.stage) ?? ""
  }));
}

function parseExecEntry(entry: Record<string, unknown>): StageExec {
  const exec: StageExec = { command: getString(entry.command) ?? "" };
  const phase = getString(entry.phase);
  if (phase !== undefined) exec.phase = phase;
  const target = getString(entry.target);
  if (target !== undefined) exec.target = target;
  return exec;
}

/**
 * Read a stage exec list. The schema also allows a map of phase to commands
 * (`on-enter: [...]`); containerlab only reads the list, so the map is turned
 * into list entries.
 */
function parseExec(value: unknown): StageExec[] {
  if (Array.isArray(value)) return value.filter(isRecord).map(parseExecEntry);
  if (!isRecord(value)) return [];
  const result: StageExec[] = [];
  for (const phase of STAGE_EXEC_PHASES) {
    const commands = value[phase];
    if (!Array.isArray(commands)) continue;
    for (const command of commands) {
      if (typeof command === "string") result.push({ command, phase });
    }
  }
  return result;
}

/** Read a `stages` map from YAML; returns undefined when it holds nothing */
export function parseNodeStages(value: unknown): NodeStages | undefined {
  if (!isRecord(value)) return undefined;
  const stages: NodeStages = {};
  for (const name of STAGE_NAMES) {
    const raw = value[name];
    if (!isRecord(raw)) continue;
    const waitFor = parseWaitFor(raw["wait-for"]);
    const exec = parseExec(raw.exec);
    const stage: StageConfig = {};
    if (waitFor.length > 0) stage.waitFor = waitFor;
    if (exec.length > 0) stage.exec = exec;
    if (stage.waitFor || stage.exec) stages[name] = stage;
  }
  return Object.keys(stages).length > 0 ? stages : undefined;
}

/** Read the per-level inherited stages stored on a node */
export function parseInheritedStages(value: unknown): InheritedStages[] {
  if (!Array.isArray(value)) return [];
  const result: InheritedStages[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const level = getString(entry.level);
    const stages = parseNodeStages(entry.stages);
    if (level !== undefined && stages) result.push({ level, stages });
  }
  return result;
}

function serializeWaitFor(value: unknown): Record<string, string>[] {
  if (!Array.isArray(value)) return [];
  const result: Record<string, string>[] = [];
  for (const entry of value.filter(isRecord)) {
    const node = getString(entry.node)?.trim() ?? "";
    if (node === "") continue;
    const item: Record<string, string> = { node };
    const stage = getString(entry.stage) ?? "";
    if (stage !== "") item.stage = stage;
    result.push(item);
  }
  return result;
}

function serializeExec(value: unknown): Record<string, string>[] {
  if (!Array.isArray(value)) return [];
  const result: Record<string, string>[] = [];
  for (const entry of value.filter(isRecord)) {
    const command = getString(entry.command) ?? "";
    if (command.trim() === "") continue;
    const item: Record<string, string> = { command };
    const phase = getString(entry.phase) ?? "";
    if (phase !== "") item.phase = phase;
    const target = getString(entry.target) ?? "";
    if (target !== "") item.target = target;
    result.push(item);
  }
  return result;
}

/**
 * Write editor stages (NodeStages) as containerlab YAML. Rows without a node or
 * command are dropped; null means there is nothing left and the key should be
 * removed.
 */
export function serializeNodeStages(stages: unknown): Record<string, unknown> | null {
  if (!isRecord(stages)) return null;
  const result: Record<string, unknown> = {};
  for (const name of STAGE_NAMES) {
    const config = stages[name];
    if (!isRecord(config)) continue;
    const waitFor = serializeWaitFor(config.waitFor);
    const exec = serializeExec(config.exec);
    const stage: Record<string, unknown> = {};
    if (waitFor.length > 0) stage["wait-for"] = waitFor;
    if (exec.length > 0) stage.exec = exec;
    if (Object.keys(stage).length > 0) result[name] = stage;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function isSameWaitFor(a: StageWaitFor, b: StageWaitFor): boolean {
  return a.node === b.node && a.stage === b.stage;
}

/**
 * Merge stages like containerlab: defaults, kind, group and node each add their
 * wait-for entries (skipping duplicates) and exec commands to the stage.
 */
export function mergeNodeStages(levels: Array<NodeStages | undefined>): NodeStages {
  const merged: NodeStages = {};
  for (const level of levels) {
    if (!level) continue;
    for (const name of STAGE_NAMES) {
      const source = level[name];
      if (!source) continue;
      const target = (merged[name] ??= {});
      for (const entry of source.waitFor ?? []) {
        target.waitFor ??= [];
        if (!target.waitFor.some((existing) => isSameWaitFor(existing, entry))) {
          target.waitFor.push(entry);
        }
      }
      if (source.exec && source.exec.length > 0) {
        target.exec = [...(target.exec ?? []), ...source.exec];
      }
    }
  }
  return merged;
}

/** A wait-for dependency between two nodes */
export interface WaitForDependency {
  /** Node that waits */
  node: string;
  /** Stage of the waiting node that is held back */
  nodeStage: StageName;
  /** Node that is waited for */
  dependsOn: string;
  /** Stage the waited-for node must finish */
  dependsOnStage: string;
}

/** All wait-for dependencies of one node, with blank rows left out */
export function listWaitForDependencies(node: string, stages: NodeStages): WaitForDependency[] {
  const result: WaitForDependency[] = [];
  for (const name of STAGE_NAMES) {
    for (const entry of stages[name]?.waitFor ?? []) {
      const dependsOn = entry.node.trim();
      if (dependsOn === "") continue;
      result.push({ node, nodeStage: name, dependsOn, dependsOnStage: entry.stage });
    }
  }
  return result;
}

/**
 * Find a cycle in the wait-for graph. containerlab refuses to deploy a lab when
 * nodes wait on each other in a loop, whatever stages are involved. Returns the
 * nodes of one cycle (first node repeated at the end), or null. With `from`,
 * only cycles reachable from that node are looked for.
 */
export function findWaitForCycle(
  dependencies: WaitForDependency[],
  from?: string
): string[] | null {
  const edges = new Map<string, Set<string>>();
  for (const dep of dependencies) {
    const targets = edges.get(dep.node) ?? new Set<string>();
    targets.add(dep.dependsOn);
    edges.set(dep.node, targets);
  }

  const done = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();

  const visit = (node: string): string[] | null => {
    if (onPath.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (done.has(node)) return null;
    onPath.add(node);
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    onPath.delete(node);
    done.add(node);
    return null;
  };

  for (const node of from === undefined ? edges.keys() : [from]) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

/** Stages a node ends up with: what defaults, kind and group add, then its own */
export function resolveEffectiveStages(
  own: NodeStages | undefined,
  inherited: InheritedStages[]
): NodeStages {
  return mergeNodeStages([...inherited.map((entry) => entry.stages), own]);
}

/** Effective wait-for dependencies of a graph node, read from its extraData */
export function getNodeWaitForDependencies(
  node: string,
  extraData: Record<string, unknown> | undefined
): WaitForDependency[] {
  if (!extraData) return [];
  const stages = resolveEffectiveStages(
    parseNodeStages(extraData.stages),
    parseInheritedStages(extraData[INHERITED_STAGES_KEY])
  );
  return listWaitForDependencies(node, stages);
}
