import assert from "node:assert/strict";
import test from "node:test";

import {
  guideProgress,
  guideProgressKey,
  readGuideProgress,
  subscribeGuideProgress,
  updateGuideProgress,
  writeGuideProgress
} from "./guideProgress";

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

test("progress is saved per guide and read back", () => {
  const storage = new MemoryStorage();
  writeGuideProgress("lab/a.clab.md", { step: 2, ticked: ["x-1", "y-1"] }, storage);
  writeGuideProgress("lab/b.clab.md", { step: 1, ticked: [] }, storage);
  assert.deepEqual(readGuideProgress("lab/a.clab.md", storage), { step: 2, ticked: ["x-1", "y-1"] });
  assert.deepEqual(readGuideProgress("lab/b.clab.md", storage), { step: 1, ticked: [] });
  assert.deepEqual(readGuideProgress("lab/c.clab.md", storage), { step: 0, ticked: [] });
});

test("progress back at the start is forgotten", () => {
  const storage = new MemoryStorage();
  writeGuideProgress("lab/a.clab.md", { step: 1, ticked: ["x-1"] }, storage);
  writeGuideProgress("lab/a.clab.md", { step: 0, ticked: [] }, storage);
  assert.equal(storage.items.get("clab-guide-progress-v1"), "{}");
});

test("stored values that are not progress read as the start", () => {
  const storage = new MemoryStorage();
  storage.setItem("clab-guide-progress-v1", "{not json");
  assert.deepEqual(readGuideProgress("lab/a.clab.md", storage), { step: 0, ticked: [] });
  storage.setItem("clab-guide-progress-v1", JSON.stringify({ "lab/b.clab.md": { step: -3, ticked: [1, "ok"] } }));
  assert.deepEqual(readGuideProgress("lab/b.clab.md", storage), { step: 0, ticked: ["ok"] });
});

test("the least recently saved guides are dropped past the limit", () => {
  const storage = new MemoryStorage();
  for (let index = 0; index < 52; index += 1) {
    writeGuideProgress(`lab/${index}.clab.md`, { step: 1, ticked: [] }, storage);
  }
  assert.deepEqual(readGuideProgress("lab/0.clab.md", storage), { step: 0, ticked: [] });
  assert.deepEqual(readGuideProgress("lab/1.clab.md", storage), { step: 0, ticked: [] });
  assert.deepEqual(readGuideProgress("lab/2.clab.md", storage), { step: 1, ticked: [] });
  assert.deepEqual(readGuideProgress("lab/51.clab.md", storage), { step: 1, ticked: [] });
});

test("no storage means no progress, without errors", () => {
  const failing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    }
  };
  assert.deepEqual(readGuideProgress("lab/a.clab.md", failing), { step: 0, ticked: [] });
  assert.doesNotThrow(() => writeGuideProgress("lab/a.clab.md", { step: 1, ticked: [] }, failing));
});

test("progress changes without anything showing it, and is saved", () => {
  const storage = new MemoryStorage();
  const key = guideProgressKey("away", "away.clab.md");
  let notified = 0;
  const unsubscribe = subscribeGuideProgress(() => {
    notified += 1;
  });

  assert.deepEqual(guideProgress(key, storage), { step: 0, ticked: [] });
  updateGuideProgress(key, (current) => ({ ...current, ticked: [...current.ticked, "a-1"] }), storage);
  assert.deepEqual(guideProgress(key, storage), { step: 0, ticked: ["a-1"] });
  assert.deepEqual(readGuideProgress(key, storage), { step: 0, ticked: ["a-1"] });
  assert.equal(notified, 1);

  // The same object back means nothing changed: nobody is told, nothing is written.
  const before = guideProgress(key, storage);
  updateGuideProgress(key, (current) => current, storage);
  assert.equal(guideProgress(key, storage), before);
  assert.equal(notified, 1);

  unsubscribe();
  updateGuideProgress(key, (current) => ({ ...current, step: 2 }), storage);
  assert.equal(notified, 1);
  assert.equal(readGuideProgress(key, storage).step, 2);
});

test("progress works for the page without a browser to keep it in", () => {
  const key = guideProgressKey("no-storage", "no-storage.clab.md");
  updateGuideProgress(key, (current) => ({ ...current, ticked: ["b-1"] }), undefined);
  assert.deepEqual(guideProgress(key, undefined).ticked, ["b-1"]);
});
