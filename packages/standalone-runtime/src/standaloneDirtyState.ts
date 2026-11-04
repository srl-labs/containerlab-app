import { runtimeFetch } from "./backend";
/**
 * Topology sync (dirty) state refresh for standalone mode.
 *
 * Runs a `containerlab apply` dry-run through the app server, which reports
 * whether applying the on-disk topology would change the running lab. The app
 * server also stamps the result onto its topology sessions so subsequent
 * snapshots carry the same flag.
 */
import { useTopoViewerStore } from "@containerlab/clab-ui";
import {
  applyPlanHasChanges,
  parseApplyPlan,
  type ApplyPlan,
  type LabLifecycleOptions
} from "@containerlab/clab-ui/host";
import type { TopologyRef } from "@containerlab/clab-ui/session";

import { lifecycleOptionsWithLabSettings } from "./standaloneLabSettings";
import { standaloneServerUrl } from "./standaloneServerOrigin";

export interface DirtyStateTarget {
  sessionId?: string;
  topologyRef: TopologyRef;
}

interface DirtyStateStoreCompat {
  setDirty?: (dirty: boolean | undefined) => void;
  setInitialData?: (data: { isDirty?: boolean }) => void;
}

function setTopologyDirtyState(dirty: boolean | undefined): void {
  const store = useTopoViewerStore.getState() as DirtyStateStoreCompat;
  if (store.setDirty) {
    store.setDirty(dirty);
    return;
  }
  store.setInitialData?.(dirty === undefined ? {} : { isDirty: dirty });
}

/** Run `containerlab apply --dry-run` for the topology and return the server's answer. */
async function requestDryRunApply(
  target: DirtyStateTarget
): Promise<{ result?: unknown; changesPending?: unknown; error?: unknown }> {
  // The plan uses the lab's settings, e.g. its namespace, as the apply will.
  const options = lifecycleOptionsWithLabSettings("apply", undefined, { topologyRef: target.topologyRef });
  const payload: { dryRun: true; sessionId?: string; topologyRef: TopologyRef; options?: LabLifecycleOptions } = {
    dryRun: true,
    topologyRef: target.topologyRef,
    ...(options ? { options } : {})
  };
  if (target.sessionId) {
    payload.sessionId = target.sessionId;
  }
  const response = await runtimeFetch(standaloneServerUrl("/api/lab/apply"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = (await response.json().catch(() => ({}))) as {
    result?: unknown;
    changesPending?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string" && body.error
        ? body.error
        : `Dry run failed: ${response.status} ${response.statusText}`
    );
  }
  return body;
}

export async function refreshTopologyDirtyState(
  target: DirtyStateTarget
): Promise<boolean | undefined> {
  let dirty: boolean | undefined;
  try {
    const body = await requestDryRunApply(target);
    if (typeof body.changesPending === "boolean") {
      dirty = body.changesPending;
    }
  } catch {
    // Leave the sync state unknown when the dry-run cannot run.
  }

  setTopologyDirtyState(dirty);
  return dirty;
}

/** The changes applying the topology would make; refreshes the sync state on the way. */
export async function planTopologyApply(target: DirtyStateTarget): Promise<ApplyPlan> {
  const body = await requestDryRunApply(target);
  const plan = parseApplyPlan(body.result);
  if (!plan) {
    throw new Error("The dry run returned no plan");
  }
  setTopologyDirtyState(applyPlanHasChanges(plan));
  return plan;
}

export function resetTopologyDirtyState(): void {
  setTopologyDirtyState(undefined);
}
