// Layout of the multi-session Wireshark page: tabs or a side-by-side grid.
import type { WiresharkVncLayout } from "./types";

// Kept per viewer; storage may be unavailable, so reads fall back to tabs.
const LAYOUT_KEY = "clab.wireshark.layout";

export function readWiresharkVncLayout(): WiresharkVncLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "side-by-side" ? "side-by-side" : "tabs";
  } catch {
    return "tabs";
  }
}

export function writeWiresharkVncLayout(layout: WiresharkVncLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    /* Storage may be unavailable. */
  }
}

export interface SideBySideGrid {
  columns: number;
  rows: number;
  /** Columns the last tile spans so the bottom row has no empty cell. */
  lastSpan: number;
}

/** Two columns for up to four sessions, three beyond. */
export function sideBySideGrid(count: number): SideBySideGrid {
  const total = Math.max(count, 1);
  let columns = 3;
  if (total === 1) columns = 1;
  else if (total <= 4) columns = 2;
  const rows = Math.ceil(total / columns);
  return { columns, rows, lastSpan: columns - ((total - 1) % columns) };
}
