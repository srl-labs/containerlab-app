import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalExportFileName,
  extractTerminalText,
  resolveTerminalCopyText,
  type TerminalTextSource
} from "./runtimeTerminalActions";

function createSource(input: {
  lines: string[];
  viewportY: number;
  rows: number;
  selection?: string;
}): TerminalTextSource {
  const { lines, viewportY, rows, selection = "" } = input;
  return {
    rows,
    hasSelection: () => selection.length > 0,
    getSelection: () => selection,
    buffer: {
      active: {
        viewportY,
        length: lines.length,
        getLine: (index: number) => {
          const line = lines[index];
          if (line === undefined) {
            return undefined;
          }
          return {
            translateToString: () => line
          };
        }
      }
    }
  };
}

test("extractTerminalText returns visible viewport lines for screen export", () => {
  const source = createSource({
    lines: ["line-0", "line-1", "line-2", "line-3", "line-4"],
    viewportY: 2,
    rows: 2
  });

  assert.equal(extractTerminalText(source, "screen"), "line-2\nline-3");
});

test("extractTerminalText returns full buffer for log export", () => {
  const source = createSource({
    lines: ["line-0", "line-1", "line-2"],
    viewportY: 1,
    rows: 2
  });

  assert.equal(extractTerminalText(source, "log"), "line-0\nline-1\nline-2");
});

test("resolveTerminalCopyText prefers explicit selection", () => {
  const source = createSource({
    lines: ["line-0", "line-1", "line-2"],
    viewportY: 1,
    rows: 2,
    selection: "selected-value"
  });

  assert.equal(resolveTerminalCopyText(source), "selected-value");
});

test("resolveTerminalCopyText falls back to visible viewport when selection is empty", () => {
  const source = createSource({
    lines: ["line-0", "line-1", "line-2"],
    viewportY: 1,
    rows: 2
  });

  assert.equal(resolveTerminalCopyText(source), "line-1\nline-2");
});

test("createTerminalExportFileName builds sanitized deterministic names", () => {
  const name = createTerminalExportFileName({
    nodeName: "Node 01 / Core",
    protocol: "SSH",
    scope: "log",
    now: new Date(2026, 3, 7, 9, 8, 6)
  });

  assert.equal(name, "clab-terminal-node-01-core-ssh-20260407-090806-log.txt");
});
