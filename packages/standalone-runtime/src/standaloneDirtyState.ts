/**
 * Topology sync (dirty) state refresh for standalone mode.
 *
 * Runs a `containerlab apply` dry-run through the app server, which reports
 * whether applying the on-disk topology would change the running lab. The app
 * server also stamps the result onto its topology sessions so subsequent
 * snapshots carry the same flag.
 */
import { useTopoViewerStore } from "@srl-labs/clab-ui";
import type { TopologyRef } from "@srl-labs/clab-ui/session";

import { standaloneServerUrl } from "./standaloneServerOrigin";

export interface DirtyStateTarget {
  sessionId?: string;
  topologyRef: TopologyRef;
}

export async function refreshTopologyDirtyState(
  target: DirtyStateTarget
): Promise<boolean | undefined> {
  let dirty: boolean | undefined;
  try {
    const payload: { dryRun: true; sessionId?: string; topologyRef: TopologyRef } = {
      dryRun: true,
      topologyRef: target.topologyRef
    };
    if (target.sessionId) {
      payload.sessionId = target.sessionId;
    }
    const response = await fetch(standaloneServerUrl("/api/lab/apply"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      const body = (await response.json()) as { changesPending?: unknown };
      if (typeof body.changesPending === "boolean") {
        dirty = body.changesPending;
      }
    }
  } catch {
    // Leave the sync state unknown when the dry-run cannot run.
  }

  useTopoViewerStore.getState().setDirty(dirty);
  return dirty;
}

export function resetTopologyDirtyState(): void {
  useTopoViewerStore.getState().setDirty(undefined);
}
