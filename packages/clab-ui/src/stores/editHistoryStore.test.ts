import assert from "node:assert/strict";
import test from "node:test";

import { NO_DRAFT } from "../services/editHistory";

import {
  applyEditStepSources,
  editSourceDraft,
  markSourceDraftSaved,
  settleEditStep,
  syncEditHistory,
  takeEditStep,
  useEditHistoryStore
} from "./editHistoryStore";

const FILE = "name: lab\n";

let labCount = 0;

/** A fresh topology, so each test starts without drafts or steps. */
function openLab(undo: number[] = []): { fileName: string; scope: string } {
  labCount += 1;
  const lab = { fileName: `lab${labCount}.clab.yml`, scope: `core-${labCount}` };
  syncLab(lab, undo);
  return lab;
}

function syncLab(lab: { fileName: string; scope: string }, undo: number[], redo: number[] = []): void {
  syncEditHistory({
    canUndo: undo.length > 0,
    canRedo: redo.length > 0,
    history: { scope: lab.scope, undo, redo },
    yamlFileName: lab.fileName,
    annotationsFileName: `${lab.fileName}.annotations.json`
  });
}

test("text typed back to the file drops the draft and its step", () => {
  openLab();
  editSourceDraft("yaml", `${FILE}# a\n`, FILE);
  assert.deepEqual(useEditHistoryStore.getState().drafts.yaml, { base: FILE, text: `${FILE}# a\n` });
  editSourceDraft("yaml", FILE, FILE);
  assert.deepEqual(useEditHistoryStore.getState().drafts.yaml, NO_DRAFT);
  assert.equal(useEditHistoryStore.getState().canUndo, false);
});

test("undoing a text step restores the draft and the cursor it started from", () => {
  openLab();
  const cursor = { anchorLine: 2, anchorColumn: 1, line: 2, column: 1 };
  editSourceDraft("yaml", `${FILE}topology: [\n`, FILE, { selectionBefore: cursor });
  const step = takeEditStep("undo");
  assert.ok(step);
  applyEditStepSources("undo", step);
  const state = useEditHistoryStore.getState();
  assert.deepEqual(state.drafts.yaml, NO_DRAFT);
  assert.deepEqual(state.selectionRestore, { file: "yaml", selection: cursor });
  assert.equal(state.canRedo, true);
});

test("undoing a save makes the saved text a draft again", () => {
  const lab = openLab();
  editSourceDraft("yaml", `${FILE}# a\n`, FILE);
  const saved = useEditHistoryStore.getState().drafts.yaml;
  syncLab(lab, [1]);
  markSourceDraftSaved("yaml", saved, 1);
  assert.deepEqual(useEditHistoryStore.getState().drafts.yaml, NO_DRAFT);

  const step = takeEditStep("undo");
  assert.ok(step);
  assert.equal(step.hostStep, 1);
  syncLab(lab, [], [1]);
  settleEditStep("undo", step, true);
  applyEditStepSources("undo", step);
  assert.deepEqual(useEditHistoryStore.getState().drafts.yaml, saved);
});

test("opening another topology drops the drafts", () => {
  openLab();
  editSourceDraft("json", "{ \"x\": ", "{}");
  openLab();
  const state = useEditHistoryStore.getState();
  assert.deepEqual(state.drafts.json, NO_DRAFT);
  assert.equal(state.canUndo, false);
});

test("hosts without history steps keep their own undo", () => {
  syncEditHistory({ canUndo: true, canRedo: false });
  assert.equal(useEditHistoryStore.getState().canUndo, true);
  assert.equal(takeEditStep("undo"), null);
});
