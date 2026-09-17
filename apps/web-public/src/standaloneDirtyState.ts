/**
 * Topology sync (dirty) state for the editor sandbox.
 * There is no running lab, so apply dry-run is always unknown.
 */
import { useTopoViewerStore } from "@containerlab/clab-ui";
import type { TopologyRef } from "@containerlab/clab-ui/session";

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

export async function refreshTopologyDirtyState(
  _target: DirtyStateTarget
): Promise<boolean | undefined> {
  setTopologyDirtyState(undefined);
  return undefined;
}

export function resetTopologyDirtyState(): void {
  setTopologyDirtyState(undefined);
}
