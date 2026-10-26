import assert from "node:assert/strict";
import test from "node:test";

import type { TopologyHistoryState } from "../core/types/messages";

import {
  EditHistory,
  NO_DRAFT,
  TEXT_MERGE_WINDOW_MS,
  type EditHistoryDirection,
  type EditHistoryStep,
  type SourceChange,
  type SourceDraft
} from "./editHistory";

const FILE = "name: lab\n";

function draft(text: string): SourceDraft {
  return { base: FILE, text };
}

function edit(before: SourceDraft, text: string): SourceChange {
  return { before, after: text === FILE ? NO_DRAFT : { base: before.base ?? FILE, text } };
}

function host(undo: number[], redo: number[] = [], scope = "core-1"): TopologyHistoryState {
  return { scope, undo, redo };
}

/** Steps as the host would see them: text steps by their final draft, host steps by number. */
function describe(step: EditHistoryStep | null): string {
  if (!step) return "none";
  if (step.hostStep !== undefined) return `host ${step.hostStep}`;
  const change = step.sources.yaml ?? step.sources.json;
  return `text ${JSON.stringify(change?.after.base === null ? "" : change?.after.text)}`;
}

/** Takes a step and, for host steps, plays the host's part. */
function move(
  history: EditHistory,
  direction: EditHistoryDirection,
  hostAfter: TopologyHistoryState
): string {
  const step = history.take(direction);
  if (step?.hostStep !== undefined) {
    history.syncHost(hostAfter);
    history.settle();
  }
  return describe(step);
}

test("typing within the merge window is one step, a pause starts the next", () => {
  const history = new EditHistory();
  history.recordSourceEdit("yaml", edit(NO_DRAFT, `${FILE}a`), 0);
  history.recordSourceEdit("yaml", edit(draft(`${FILE}a`), `${FILE}ab`), 400);
  history.recordSourceEdit("yaml", edit(draft(`${FILE}ab`), `${FILE}abc`), 1300);
  history.recordSourceEdit(
    "yaml",
    edit(draft(`${FILE}abc`), `${FILE}abcd`),
    1300 + TEXT_MERGE_WINDOW_MS + 1
  );

  const last = history.take("undo");
  assert.deepEqual(last?.sources.yaml?.before, draft(`${FILE}abc`));
  const first = history.take("undo")?.sources.yaml;
  assert.ok(first);
  assert.deepEqual(first.before, NO_DRAFT);
  assert.deepEqual(first.after, draft(`${FILE}abc`));
  assert.equal(history.canUndo, false);
});

test("leaving the editor ends the step even inside the merge window", () => {
  const history = new EditHistory();
  history.recordSourceEdit("yaml", edit(NO_DRAFT, `${FILE}a`), 0);
  history.closeSourceStep();
  history.recordSourceEdit("yaml", edit(draft(`${FILE}a`), `${FILE}ab`), 10);
  // Another file's text never merges into this one's step either.
  history.recordSourceEdit("json", edit(NO_DRAFT, "{}"), 20);

  assert.equal(history.take("undo")?.sources.json !== undefined, true);
  assert.deepEqual(history.take("undo")?.sources.yaml?.before, draft(`${FILE}a`));
  assert.deepEqual(history.take("undo")?.sources.yaml?.before, NO_DRAFT);
});

test("typing and deleting again inside one step leaves nothing to undo", () => {
  const history = new EditHistory();
  history.recordSourceEdit("yaml", edit(NO_DRAFT, `${FILE}a`), 0);
  history.recordSourceEdit("yaml", edit(draft(`${FILE}a`), FILE), 100);
  assert.equal(history.canUndo, false);
});

test("text and canvas steps undo and redo in the order they happened", () => {
  const history = new EditHistory();
  history.syncHost(host([]));
  history.recordSourceEdit("yaml", edit(NO_DRAFT, `${FILE}# one\n`), 0);
  history.closeSourceStep();
  history.syncHost(host([1]));
  history.recordSourceEdit("yaml", edit(draft(`${FILE}# one\n`), `${FILE}# two\n`), 5000);
  history.syncHost(host([1, 2]));

  assert.equal(move(history, "undo", host([1], [2])), "host 2");
  assert.equal(move(history, "undo", host([1], [2])), `text ${JSON.stringify(`${FILE}# two\n`)}`);
  assert.equal(move(history, "undo", host([], [2, 1])), "host 1");
  assert.equal(move(history, "undo", host([], [2, 1])), `text ${JSON.stringify(`${FILE}# one\n`)}`);
  assert.equal(history.canUndo, false);

  assert.equal(move(history, "redo", host([], [2, 1])), `text ${JSON.stringify(`${FILE}# one\n`)}`);
  assert.equal(move(history, "redo", host([1], [2])), "host 1");
  assert.equal(move(history, "redo", host([1], [2])), `text ${JSON.stringify(`${FILE}# two\n`)}`);
  assert.equal(move(history, "redo", host([1, 2])), "host 2");
  assert.equal(history.canRedo, false);
});

test("drafts of invalid YAML come back exactly as typed", () => {
  const history = new EditHistory();
  const invalid = `${FILE}topology: [unclosed\n`;
  history.recordSourceEdit("yaml", edit(NO_DRAFT, invalid), 0);
  history.closeSourceStep();
  history.recordSourceEdit("yaml", edit(draft(invalid), `${invalid}  more: {`), 100);

  assert.deepEqual(history.take("undo")?.sources.yaml?.before, draft(invalid));
  assert.deepEqual(history.take("redo")?.sources.yaml?.after, draft(`${invalid}  more: {`));
});

test("a new edit after undo clears redo, text and canvas alike", () => {
  const history = new EditHistory();
  history.syncHost(host([1]));
  history.recordSourceEdit("yaml", edit(NO_DRAFT, `${FILE}a`), 0);
  history.take("undo");
  assert.equal(history.canRedo, true);
  history.recordSourceEdit("yaml", edit(NO_DRAFT, `${FILE}b`), 5000);
  assert.equal(history.canRedo, false);

  history.take("undo");
  move(history, "undo", host([], [1]));
  assert.equal(history.canRedo, true);
  // A canvas edit: the host drops its redo and reports a new step.
  history.syncHost(host([3]));
  assert.equal(history.canRedo, false);
  assert.equal(describe(history.take("undo")), "host 3");
});

test("snapshots that arrive while the host moves wait until it settles", () => {
  const history = new EditHistory();
  history.syncHost(host([1, 2]));
  const step = history.take("undo");
  assert.equal(step?.hostStep, 2);
  // Still the host's state from before the undo.
  history.syncHost(host([1, 2]));
  history.syncHost(host([1], [2]));
  history.settle();
  assert.equal(describe(history.take("redo")), "host 2");
});

test("a host move that failed puts its step back", () => {
  const history = new EditHistory();
  history.syncHost(host([1]));
  const step = history.take("undo");
  assert.ok(step);
  history.putBack("undo", step);
  history.settle();
  assert.equal(history.canRedo, false);
  assert.equal(describe(history.take("undo")), "host 1");
});

test("a host that forgot its steps keeps the unsaved text steps", () => {
  const history = new EditHistory();
  history.syncHost(host([1]));
  history.recordSourceEdit("yaml", edit(NO_DRAFT, `${FILE}a`), 0);
  // The file changed elsewhere and the host started its history over.
  history.syncHost(host([]));
  assert.equal(describe(history.take("undo")), `text ${JSON.stringify(`${FILE}a`)}`);
  assert.equal(history.canUndo, false);
});

test("another session starts an empty history", () => {
  const history = new EditHistory();
  history.syncHost(host([1, 2]));
  history.recordSourceEdit("yaml", edit(NO_DRAFT, `${FILE}a`), 0);
  history.syncHost(host([1], [], "core-2"));
  assert.equal(describe(history.take("undo")), "host 1");
  assert.equal(history.canUndo, false);
});

test("a client that meets a host mid-history picks up its steps", () => {
  const history = new EditHistory();
  history.syncHost(host([1, 2], [4, 3]));
  assert.equal(describe(history.take("redo")), "host 3");
  history.syncHost(host([1, 2, 3], [4]));
  history.settle();
  assert.equal(describe(history.take("redo")), "host 4");
});

test("out of step with the host, undo follows what the host has", () => {
  const history = new EditHistory();
  history.syncHost(host([1, 2]));
  history.attachSources(2, { yaml: { before: draft("x"), after: NO_DRAFT } });
  // A snapshot that lost step 2 without saying so.
  (history as unknown as { host: TopologyHistoryState }).host = host([1]);
  assert.equal(describe(history.take("undo")), "host 1");
});

test("a saved draft comes back when the save is undone", () => {
  const history = new EditHistory();
  history.syncHost(host([]));
  history.recordSourceEdit("yaml", edit(NO_DRAFT, `${FILE}a`), 0);
  history.syncHost(host([1]));
  history.attachSources(1, { yaml: { before: draft(`${FILE}a`), after: NO_DRAFT } });

  const save = history.take("undo");
  assert.ok(save);
  assert.equal(save.hostStep, 1);
  assert.deepEqual(save.sources.yaml?.before, draft(`${FILE}a`));
});
