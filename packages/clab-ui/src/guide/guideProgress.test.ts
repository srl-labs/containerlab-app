import assert from "node:assert/strict";
import test from "node:test";

import { readGuideProgress, writeGuideProgress } from "./guideProgress";

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
