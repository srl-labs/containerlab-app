/** One resource change of a c9s deploy plan (`deploy --dry-run -f json -r c9s`, or clab-api-server's `runtimePlan`). */
export interface C9sPlanChange {
  action: "create" | "update" | "delete" | "recreate";
  kind: string;
  namespace?: string;
  name: string;
}

const C9S_PLAN_ACTIONS = new Set(["create", "update", "delete", "recreate"]);

function planChanges(value: unknown): C9sPlanChange[] {
  if (!Array.isArray(value)) return [];
  const changes: C9sPlanChange[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const action = typeof record.action === "string" ? record.action.toLowerCase() : "";
    const name = typeof record.name === "string" ? record.name : "";
    if (!C9S_PLAN_ACTIONS.has(action) || !name) continue;
    changes.push({
      action: action as C9sPlanChange["action"],
      kind: typeof record.kind === "string" ? record.kind : "",
      ...(typeof record.namespace === "string" && record.namespace ? { namespace: record.namespace } : {}),
      name
    });
  }
  return changes;
}

/**
 * The fields of an `ApplyLabResponse` that a c9s plan fills: its resource
 * changes, and the node lists from Node creations, deletions and recreations
 * (which restart the node).
 */
export function c9sPlanFields(plan: { namespace?: unknown; changes?: unknown }) {
  const changes = planChanges(plan.changes);
  const nodes = (action: C9sPlanChange["action"]) =>
    changes.filter((change) => change.action === action && change.kind.toLowerCase() === "node").map((change) => change.name);
  return {
    // Creating the Topology means the lab is not running yet: apply deploys all of it.
    deployedLab: changes.some((change) => change.kind.toLowerCase() === "topology" && change.action === "create"),
    addedNodes: nodes("create"),
    deletedNodes: nodes("delete"),
    recreatedNodes: nodes("recreate"),
    ...(typeof plan.namespace === "string" && plan.namespace ? { namespace: plan.namespace } : {}),
    changes
  };
}
