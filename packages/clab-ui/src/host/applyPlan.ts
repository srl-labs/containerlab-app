// The plan of `containerlab apply --dry-run`: what applying the topology would change.
import { isRecord } from "../core/utilities/typeHelpers";

export interface ApplyPlan {
  /** The lab is not running, so apply deploys the whole topology. */
  deploysLab: boolean;
  addedNodes: string[];
  deletedNodes: string[];
  recreatedNodes: string[];
  startedNodes: string[];
  restartedNodes: string[];
  /** Links as `node:iface -- node:iface`. */
  addedLinks: string[];
  /** Link ends as `node:iface`. */
  deletedEndpoints: string[];
  /** Why a node is recreated or restarted, e.g. "config drift: image". */
  nodeChangeReasons: Record<string, string>;
  /** c9s: the Kubernetes resources the apply creates, updates, recreates or deletes. */
  changes?: ApplyPlanChange[];
  /** c9s: the lab's namespace. */
  namespace?: string;
}

/** One resource change of a c9s apply; `recreate` restarts a node. */
export interface ApplyPlanChange {
  action: "create" | "update" | "delete" | "recreate";
  kind: string;
  name: string;
  namespace?: string;
}

const CHANGE_ACTIONS = new Set(["create", "update", "delete", "recreate"]);

function planChanges(value: unknown): ApplyPlanChange[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const changes: ApplyPlanChange[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const action = typeof entry.action === "string" ? entry.action : "";
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!CHANGE_ACTIONS.has(action) || !name) continue;
    changes.push({
      action: action as ApplyPlanChange["action"],
      kind: typeof entry.kind === "string" ? entry.kind : "",
      name,
      ...(typeof entry.namespace === "string" && entry.namespace ? { namespace: entry.namespace } : {})
    });
  }
  return changes;
}

type ApplyPlanListKey = Exclude<keyof ApplyPlan, "deploysLab" | "nodeChangeReasons" | "changes" | "namespace">;

/** The API sends camelCase keys, `containerlab apply --dry-run --format json` sends kebab-case. */
const LIST_KEYS: Record<ApplyPlanListKey, readonly [string, string]> = {
  addedNodes: ["addedNodes", "added-nodes"],
  deletedNodes: ["deletedNodes", "deleted-nodes"],
  recreatedNodes: ["recreatedNodes", "recreated-nodes"],
  startedNodes: ["startedNodes", "started-nodes"],
  restartedNodes: ["restartedNodes", "restarted-nodes"],
  addedLinks: ["addedLinks", "added-links"],
  deletedEndpoints: ["deletedEndpoints", "deleted-endpoints"]
};
const LIST_NAMES = Object.keys(LIST_KEYS) as ApplyPlanListKey[];

function readField(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.length > 0) result[key] = entry;
  }
  return result;
}

/**
 * Read a dry-run apply result. Returns undefined when the value is not an
 * apply plan, so callers can tell "no changes" from "unknown".
 */
export function parseApplyPlan(value: unknown): ApplyPlan | undefined {
  if (!isRecord(value)) return undefined;
  const deployed = readField(value, ["deployedLab", "deployed-lab"]);
  const hasLists = LIST_NAMES.some((name) => Array.isArray(readField(value, LIST_KEYS[name])));
  const changes = planChanges(value.changes);
  if (deployed !== true && !hasLists && !changes) return undefined;

  const plan: ApplyPlan = {
    deploysLab: deployed === true,
    addedNodes: [],
    deletedNodes: [],
    recreatedNodes: [],
    startedNodes: [],
    restartedNodes: [],
    addedLinks: [],
    deletedEndpoints: [],
    nodeChangeReasons: stringMap(readField(value, ["nodeChangeReasons", "node-change-reasons"]))
  };
  for (const name of LIST_NAMES) {
    plan[name] = stringList(readField(value, LIST_KEYS[name]));
  }
  if (changes) plan.changes = changes;
  if (typeof value.namespace === "string" && value.namespace) plan.namespace = value.namespace;
  return plan;
}

/** Whether applying the plan would change the lab. */
export function applyPlanHasChanges(plan: ApplyPlan): boolean {
  return (
    plan.deploysLab ||
    LIST_NAMES.some((name) => plan[name].length > 0) ||
    (plan.changes?.length ?? 0) > 0
  );
}
