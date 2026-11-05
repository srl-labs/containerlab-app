import assert from "node:assert/strict";
import test from "node:test";

import {
  barShare,
  baselineStamp,
  changedFields,
  changeKind,
  differingPart,
  listDelta,
  summarizeChange,
  timelineBuckets
} from "./fabricHistory";
import type { FabricChange } from "./fabricTypes";

function change(extra: Partial<FabricChange>): FabricChange {
  return { seq: 1, ts: 100, node: "leaf1", report: "bgp-peers", key: "[\"default\",\"10.0.0.1\"]", op: "change", before: null, after: null, ...extra };
}

test("a change's kind", () => {
  assert.equal(changeKind(change({ finding: "raised" })), "raised");
  assert.equal(changeKind(change({ finding: "escalated" })), "raised");
  assert.equal(changeKind(change({ finding: "cleared" })), "cleared");
  assert.equal(changeKind(change({ finding: "eased" })), "cleared");
  assert.equal(changeKind(change({ report: "config-commits" })), "commit");
  assert.equal(changeKind(change({ origin: "config" })), "config");
  assert.equal(changeKind(change({ origin: "unplanned" })), "change");
});

test("changes land in their slice of the window", () => {
  const buckets = timelineBuckets(
    [change({ ts: 0, origin: "config" }), change({ ts: 99 }), change({ ts: 5000, finding: "raised" }), change({ ts: -5 })],
    0,
    100,
    10
  );
  assert.equal(buckets.length, 10);
  assert.equal(buckets[0]?.total, 2);
  assert.equal(buckets[0]?.counts.config, 1);
  assert.equal(buckets[0]?.counts.change, 1);
  assert.equal(buckets[9]?.total, 2);
  assert.equal(buckets[9]?.counts.raised, 1);
  assert.equal(buckets[5]?.total, 0);
  assert.equal(buckets[1]?.start, 10);
});

test("a burst does not flatten the other bars", () => {
  assert.equal(barShare(0, 100), 0);
  assert.equal(barShare(100, 100), 1);
  assert.equal(barShare(1, 100), 0.1);
  assert.equal(barShare(1, 0), 0);
});

test("the fields that differ, not the node", () => {
  assert.deepEqual(
    changedFields({ node: "a", state: "up", same: [1] }, { node: "b", state: "down", same: [1], fresh: true }),
    [
      { field: "state", before: "up", after: "down" },
      { field: "fresh", before: undefined, after: true }
    ]
  );
});

test("a list's entries that went and came", () => {
  assert.deepEqual(listDelta(["a", "b"], ["b", "c"]), { gone: ["a"], came: ["c"] });
  assert.deepEqual(listDelta(["a", "b"], ["b", "a"]), { gone: [], came: [] });
  assert.deepEqual(listDelta(undefined, ["a"]), { gone: [], came: ["a"] });
});

test("a commit reads as who committed what", () => {
  assert.deepEqual(
    summarizeChange(change({ report: "config-commits", op: "add", after: { id: 3, username: "root", comment: "mtu" } })),
    { type: "commit", id: 3, user: "root", comment: "mtu" }
  );
});

test("a finding reads as which check, on what, and a severity that moved", () => {
  const record = { check: "bgp_down", subject: "default/10.0.0.1", detail: "session is active", severity: "error" };
  assert.deepEqual(summarizeChange(change({ finding: "raised", op: "add", after: record })), {
    type: "finding",
    check: "bgp_down",
    subject: "default/10.0.0.1",
    detail: "session is active",
    severity: "error"
  });
  const cleared = summarizeChange(change({ finding: "cleared", op: "remove", before: record }));
  assert.equal(cleared.type === "finding" && cleared.check, "bgp_down");
  const moved = summarizeChange(change({ finding: "escalated", before: { ...record, severity: "warning" }, after: record }));
  assert.equal(moved.type === "finding" && moved.moved, "warning → error");
});

test("a changed record leads with its key and what moved", () => {
  const summary = summarizeChange(change({
    before: { state: "up", a: 1, b: 1, c: 1, d: 1 },
    after: { state: "down", a: 2, b: 2, c: 2, d: 2 }
  }));
  assert.ok(summary.type === "fields");
  assert.equal(summary.key, "default 10.0.0.1");
  assert.equal(summary.deltas[0], "state up → down");
  assert.equal(summary.deltas.length, 4);
  assert.equal(summary.more, 1);
});

test("a record that came or went reads as its key", () => {
  assert.deepEqual(summarizeChange(change({ op: "add", after: { peer: "x" } })), { type: "record", key: "default 10.0.0.1" });
});

test("a baseline is named after the time", () => {
  assert.equal(baselineStamp(new Date(2026, 9, 18, 14, 2, 11)), "2026-10-18T14:02:11");
});

test("two versions of a line differ in their middle", () => {
  assert.deepEqual(differingPart("admin-state enable", "admin-state disable"), [12, 4]);
  assert.deepEqual(differingPart("same", "same"), [4, 0]);
  assert.deepEqual(differingPart("", "x"), [0, 0]);
});
