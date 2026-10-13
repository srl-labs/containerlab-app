import assert from "node:assert/strict";
import test from "node:test";

import { readWiresharkVncLayout, sideBySideGrid, writeWiresharkVncLayout } from "./wiresharkVncLayout";

test("side by side uses two columns up to four sessions and three beyond", () => {
  assert.deepEqual(sideBySideGrid(1), { columns: 1, rows: 1, lastSpan: 1 });
  assert.deepEqual(sideBySideGrid(2), { columns: 2, rows: 1, lastSpan: 1 });
  assert.deepEqual(sideBySideGrid(3), { columns: 2, rows: 2, lastSpan: 2 });
  assert.deepEqual(sideBySideGrid(4), { columns: 2, rows: 2, lastSpan: 1 });
  assert.deepEqual(sideBySideGrid(5), { columns: 3, rows: 2, lastSpan: 2 });
  assert.deepEqual(sideBySideGrid(7), { columns: 3, rows: 3, lastSpan: 3 });
  assert.deepEqual(sideBySideGrid(9), { columns: 3, rows: 3, lastSpan: 1 });
});

test("layout choice falls back to tabs when storage is unavailable", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      }
    });
    assert.equal(readWiresharkVncLayout(), "tabs");
    assert.doesNotThrow(() => writeWiresharkVncLayout("side-by-side"));

    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    assert.equal(readWiresharkVncLayout(), "tabs");
    writeWiresharkVncLayout("side-by-side");
    assert.equal(readWiresharkVncLayout(), "side-by-side");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
