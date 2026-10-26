/**
 * Source tab drafts and the undo history they share with the canvas.
 *
 * Unsaved YAML and JSON edits live here rather than in the source tab, so
 * undo from the canvas or the navbar can put them back while the tab is closed.
 */
import { create } from "zustand";

import type { TopologySnapshot } from "../core/types/messages";
import {
  EditHistory,
  NO_DRAFT,
  type EditHistoryDirection,
  type EditHistoryStep,
  type SourceDraft,
  type SourceFile,
  type SourceSelection
} from "../services/editHistory";

/** A cursor the source editor moves to after undo or redo put its text back. */
interface SourceSelectionRestore {
  file: SourceFile;
  selection: SourceSelection;
}

interface EditHistoryState {
  drafts: Record<SourceFile, SourceDraft>;
  /** A new object each time, so the same cursor can be restored twice. */
  selectionRestore: SourceSelectionRestore | null;
  canUndo: boolean;
  canRedo: boolean;
}

export const useEditHistoryStore = create<EditHistoryState>(() => ({
  drafts: { yaml: NO_DRAFT, json: NO_DRAFT },
  selectionRestore: null,
  canUndo: false,
  canRedo: false
}));

const history = new EditHistory();
/** Hosts that report no history steps fall back to their own undo and redo. */
let hostHistory: { known: boolean; canUndo: boolean; canRedo: boolean } = {
  known: false,
  canUndo: false,
  canRedo: false
};
let fileNames: Record<SourceFile, string> | null = null;

function refresh(update: Partial<EditHistoryState> = {}): void {
  const fallback = !hostHistory.known;
  useEditHistoryStore.setState({
    ...update,
    canUndo: history.canUndo || (fallback && hostHistory.canUndo),
    canRedo: history.canRedo || (fallback && hostHistory.canRedo)
  });
}

function setDraft(file: SourceFile, draft: SourceDraft): Record<SourceFile, SourceDraft> {
  return { ...useEditHistoryStore.getState().drafts, [file]: draft };
}

/** Follows a host snapshot: its history steps, and the files the drafts belong to. */
export function syncEditHistory(
  snapshot: Pick<TopologySnapshot, "canUndo" | "canRedo" | "history"> &
    Partial<Pick<TopologySnapshot, "yamlFileName" | "annotationsFileName">>
): void {
  const update: Partial<EditHistoryState> = {};
  if (snapshot.yamlFileName !== undefined && snapshot.annotationsFileName !== undefined) {
    const next = { yaml: snapshot.yamlFileName, json: snapshot.annotationsFileName };
    if (fileNames && (fileNames.yaml !== next.yaml || fileNames.json !== next.json)) {
      // Another topology: its drafts and steps are not this one's.
      history.clear();
      update.drafts = { yaml: NO_DRAFT, json: NO_DRAFT };
      update.selectionRestore = null;
    }
    fileNames = next;
  }
  hostHistory = {
    known: snapshot.history !== undefined,
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo
  };
  if (snapshot.history) history.syncHost(snapshot.history);
  refresh(update);
}

/**
 * Records text typed into a source tab. Text back at the file's content drops
 * the draft, so there is nothing left to save.
 */
export function editSourceDraft(
  file: SourceFile,
  text: string,
  fileContent: string,
  edit: { selectionBefore?: SourceSelection; selectionAfter?: SourceSelection; separate?: boolean } = {}
): void {
  const before = useEditHistoryStore.getState().drafts[file];
  const after: SourceDraft =
    text === fileContent ? NO_DRAFT : { base: before.base ?? fileContent, text };
  const { selectionBefore, selectionAfter, separate = false } = edit;
  history.recordSourceEdit(
    file,
    { before, after, selectionBefore, selectionAfter },
    Date.now(),
    !separate
  );
  refresh({ drafts: setDraft(file, after) });
}

/** Drops a source tab's unsaved edits, as its own step. */
export function discardSourceDraft(file: SourceFile): void {
  const before = useEditHistoryStore.getState().drafts[file];
  if (before.base === null) return;
  history.recordSourceEdit(file, { before, after: NO_DRAFT }, Date.now(), false);
  refresh({ drafts: setDraft(file, NO_DRAFT) });
}

/** Ends the step typing merges into. */
export function closeSourceStep(): void {
  history.closeSourceStep();
}

/** The draft became the file: undoing the save makes it a draft again. */
export function markSourceDraftSaved(
  file: SourceFile,
  saved: SourceDraft,
  hostStep: number | undefined
): void {
  if (hostStep !== undefined) {
    history.attachSources(hostStep, { [file]: { before: saved, after: NO_DRAFT } });
  }
  refresh({ drafts: setDraft(file, NO_DRAFT) });
}

/** Whether only the host can undo or redo, because it reports no steps. */
export function hostOnlyHistory(direction: EditHistoryDirection): boolean {
  if (hostHistory.known) return false;
  return direction === "undo" ? hostHistory.canUndo : hostHistory.canRedo;
}

export function takeEditStep(direction: EditHistoryDirection): EditHistoryStep | null {
  const step = history.take(direction);
  refresh();
  return step;
}

export function settleEditStep(direction: EditHistoryDirection, step: EditHistoryStep, ok: boolean): void {
  if (!ok) history.putBack(direction, step);
  history.settle();
  refresh();
}

/** Puts back the drafts a step changed, with the cursor of text steps. */
export function applyEditStepSources(direction: EditHistoryDirection, step: EditHistoryStep): void {
  const drafts = { ...useEditHistoryStore.getState().drafts };
  let selectionRestore: SourceSelectionRestore | null = null;
  for (const file of ["yaml", "json"] as const) {
    const change = step.sources[file];
    if (!change) continue;
    drafts[file] = direction === "undo" ? change.before : change.after;
    const selection = direction === "undo" ? change.selectionBefore : change.selectionAfter;
    if (selection) selectionRestore = { file, selection };
  }
  refresh(selectionRestore ? { drafts, selectionRestore } : { drafts });
}
