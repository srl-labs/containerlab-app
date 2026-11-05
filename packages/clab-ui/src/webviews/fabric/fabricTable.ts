/** Filtering and sorting of a table as the engine renders it: columns, and rows of cells. */
import type { FabricCell } from "./fabricTypes";
import { natural } from "./fabricFormat";

export interface FabricRxActTx {
  kind: "bgp-rx-act-tx";
  family: string;
  node: string;
  ni?: string;
  peer: string;
  rx: number;
  act: number;
  tx: number;
}

export function isRxActTx(cell: FabricCell): cell is FabricRxActTx {
  return typeof cell === "object" && cell !== null && (cell as { kind?: unknown }).kind === "bgp-rx-act-tx";
}

export function cellPlain(cell: FabricCell): string {
  if (isRxActTx(cell)) return `${cell.rx}/${cell.act}/${cell.tx}`;
  if (cell === null || cell === undefined) return "";
  return typeof cell === "object" ? JSON.stringify(cell) : String(cell);
}

/** A column's name, which can name a family on one line and what it counts on the next. */
export function columnLines(column: string): string[] {
  return column.split("\n");
}

type CellTest = (cell: FabricCell) => boolean;

function compareTest(op: string, limit: number): CellTest {
  return (cell) => {
    const value = Number.parseFloat(cellPlain(cell).replace(/,/g, ""));
    if (Number.isNaN(value)) return false;
    if (op === ">") return value > limit;
    if (op === ">=") return value >= limit;
    return op === "<" ? value < limit : value <= limit;
  };
}

function exactTest(exact: string): CellTest {
  return (cell) => {
    const value = cellPlain(cell).toLowerCase();
    return value === exact || value.split(/,\s*|\n/).some((item) => item.trim() === exact);
  };
}

/**
 * A filter as a test of one cell: `text` contains, `!text` does not, `=text` is
 * exactly (or one item of a list), `>10` `>=10` `<10` `<=10` compare numbers,
 * `a|b` either. Case does not matter. `undefined` when it filters nothing.
 */
export function cellTest(expression: string): CellTest | undefined {
  const text = expression.trim().toLowerCase();
  if (!text) return undefined;
  if (text.includes("|")) {
    const tests = text.split("|").map(cellTest).filter((test) => test !== undefined);
    return tests.length ? (cell) => tests.some((test) => test(cell)) : undefined;
  }
  const compare = /^(>=|<=|>|<)\s*(-?[\d.]+)$/.exec(text);
  if (compare) return compareTest(compare[1] ?? ">", Number(compare[2]));
  if (text.startsWith("!")) {
    const not = text.slice(1);
    return not ? (cell) => !cellPlain(cell).toLowerCase().includes(not) : undefined;
  }
  if (text.startsWith("=")) return exactTest(text.slice(1));
  return (cell) => cellPlain(cell).toLowerCase().includes(text);
}

export interface FabricTableFilters {
  /** Words that must all be found somewhere in a row. */
  text: string;
  /** A filter per column, by the column's name. */
  columns: Readonly<Record<string, string>>;
}

export function filterRows(
  columns: readonly string[],
  rows: readonly FabricCell[][],
  filters: FabricTableFilters
): FabricCell[][] {
  const words = filters.text.toLowerCase().split(/\s+/).filter(Boolean);
  const tests = columns.flatMap((column, index) => {
    const test = cellTest(filters.columns[column] ?? "");
    return test ? [{ index, test }] : [];
  });
  if (words.length === 0 && tests.length === 0) return [...rows];
  return rows.filter((row) => {
    if (!tests.every(({ index, test }) => test(row[index]))) return false;
    if (words.length === 0) return true;
    const text = row.map(cellPlain).join("\u0001").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export interface FabricTableSort {
  column: number;
  descending: boolean;
}

/** Sorted by a column, numbers as numbers and names as people read them; empty cells last. */
export function sortRows(rows: readonly FabricCell[][], sort: FabricTableSort | undefined): FabricCell[][] {
  if (!sort) return [...rows];
  const direction = sort.descending ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = cellPlain(left[sort.column]);
    const b = cellPlain(right[sort.column]);
    if (a === "") return b === "" ? 0 : 1;
    if (b === "") return -1;
    return natural(a, b) * direction;
  });
}

/** How a state word in a cell reads: good, bad, or nothing to say. */
export function stateTone(cell: FabricCell): "good" | "bad" | undefined {
  const value = cellPlain(cell).toLowerCase();
  if (value === "up" || value === "established" || value === "enable") return "good";
  if (value === "down" || value === "disable" || value === "active" || value === "idle") return "bad";
  return undefined;
}

/** Columns whose words are states, by their name. */
const STATE_COLUMNS = new Set(["state", "oper", "oper-state", "status", "admin", "admin-state"]);

export function isStateColumn(column: string): boolean {
  return STATE_COLUMNS.has(column.toLowerCase());
}
