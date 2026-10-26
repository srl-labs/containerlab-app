/**
 * Undo, redo and source saves over the history shared by the canvas and the
 * source tabs. Moves run one at a time, so quick presses walk it in order.
 */

import type { TopologyHostCommand } from "../core/types/messages";
import type { TopologySessionClient } from "../session/client";
import {
  applyEditStepSources,
  closeSourceStep,
  hostOnlyHistory,
  markSourceDraftSaved,
  settleEditStep,
  takeEditStep,
  useEditHistoryStore
} from "../stores/editHistoryStore";
import { log } from "../utils/logger";

import type { EditHistoryDirection, SourceFile } from "./editHistory";
import { executeTopologyCommand } from "./topologyHostCommands";

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

async function moveHistory(
  direction: EditHistoryDirection,
  client: TopologySessionClient
): Promise<void> {
  const step = takeEditStep(direction);
  if (!step) {
    if (hostOnlyHistory(direction)) {
      await executeTopologyCommand({ command: direction }, {}, client);
    }
    return;
  }
  if (step.hostStep !== undefined) {
    let ok = false;
    try {
      const response = await executeTopologyCommand({ command: direction }, {}, client);
      ok = response.type === "topology-host:ack";
    } catch (err) {
      log.warn(`[EditHistory] ${direction} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      settleEditStep(direction, step, ok);
    }
    if (!ok) return;
  }
  applyEditStepSources(direction, step);
}

export function undoEdit(client: TopologySessionClient): Promise<void> {
  return enqueue(() => moveHistory("undo", client));
}

export function redoEdit(client: TopologySessionClient): Promise<void> {
  return enqueue(() => moveHistory("redo", client));
}

/** Writes a source tab's draft to its file; throws what the host rejected it for. */
export function saveSourceDraft(file: SourceFile, client: TopologySessionClient): Promise<void> {
  return enqueue(async () => {
    const draft = useEditHistoryStore.getState().drafts[file];
    if (draft.base === null) return;
    closeSourceStep();
    const command: TopologyHostCommand =
      file === "yaml"
        ? { command: "setYamlContent", payload: { content: draft.text } }
        : { command: "setAnnotationsContent", payload: { content: draft.text } };
    const response = await executeTopologyCommand(command, {}, client);
    // A stale save changed nothing; the draft stays, now marked as stale.
    if (response.type !== "topology-host:ack") return;
    markSourceDraftSaved(file, draft, response.snapshot?.history?.undo.at(-1));
  });
}
