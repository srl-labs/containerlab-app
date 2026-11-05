import assert from "node:assert/strict";
import test from "node:test";

import { cellPlain, cellTest, columnLines, filterRows, isRxActTx, isStateColumn, sortRows, stateTone } from "./fabricTable";

const COUNTS = { kind: "bgp-rx-act-tx", family: "evpn", node: "leaf1", peer: "10.0.0.1", rx: 4, act: 3, tx: 2 };

function matches(expression: string, cell: unknown): boolean {
  const check = cellTest(expression);
  assert.ok(check, expression);
  return check(cell);
}

test("a route count reads as Rx/Act/Tx", () => {
  assert.equal(isRxActTx(COUNTS), true);
  assert.equal(cellPlain(COUNTS), "4/3/2");
  assert.equal(cellPlain(null), "");
  assert.equal(cellPlain(5), "5");
});

test("a filter's syntax", () => {
  assert.equal(matches("UP", "up"), true);
  assert.equal(matches("!fe80", "fe80::1"), false);
  assert.equal(matches("!fe80", "10.0.0.1"), true);
  assert.equal(matches("=up", "up"), true);
  assert.equal(matches("=up", "upgrade"), false);
  assert.equal(matches("=b", "a, b"), true);
  assert.equal(matches(">10", "11"), true);
  assert.equal(matches(">10", "9"), false);
  assert.equal(matches(">=10", "10"), true);
  assert.equal(matches("<=5", "1,000"), false);
  assert.equal(matches(">10", "n/a"), false);
  assert.equal(matches("=leaf1|=leaf2", "leaf2"), true);
  assert.equal(matches("=leaf1|=leaf2", "leaf3"), false);
  assert.equal(cellTest("  "), undefined);
  assert.equal(cellTest("!"), undefined);
});

test("rows are filtered by every word and every column", () => {
  const columns = ["Node", "state", "peer"];
  const rows = [
    ["leaf1", "up", "10.0.0.1"],
    ["leaf2", "down", "10.0.0.2"],
    ["spine1", "up", "10.0.0.3"]
  ];
  assert.equal(filterRows(columns, rows, { text: "", columns: {} }).length, 3);
  assert.deepEqual(filterRows(columns, rows, { text: "leaf up", columns: {} }), [rows[0]]);
  assert.deepEqual(filterRows(columns, rows, { text: "", columns: { state: "!up" } }), [rows[1]]);
  assert.deepEqual(filterRows(columns, rows, { text: "spine", columns: { state: "=up" } }), [rows[2]]);
});

test("rows sort naturally, either way, empty cells last", () => {
  const rows = [["leaf10"], ["leaf2"], [""], ["leaf1"]];
  const first = (sorted: unknown[][]) => sorted.map((row) => row[0]);
  assert.deepEqual(first(sortRows(rows, { column: 0, descending: false })), ["leaf1", "leaf2", "leaf10", ""]);
  assert.deepEqual(first(sortRows(rows, { column: 0, descending: true })), ["leaf10", "leaf2", "leaf1", ""]);
  assert.deepEqual(first(sortRows(rows, undefined)), ["leaf10", "leaf2", "", "leaf1"]);
});

test("column names and state words", () => {
  assert.deepEqual(columnLines("evpn\nRx/Act/Tx"), ["evpn", "Rx/Act/Tx"]);
  assert.equal(stateTone("up"), "good");
  assert.equal(stateTone("DOWN"), "bad");
  assert.equal(stateTone("mixed"), undefined);
  assert.equal(isStateColumn("oper-state"), true);
  assert.equal(isStateColumn("peer"), false);
});
