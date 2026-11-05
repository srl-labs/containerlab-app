import assert from "node:assert/strict";
import test from "node:test";

import { ago, formatBps, fullValue, hasValue, keyText, natural, plural, shortValue } from "./fabricFormat";

test("names sort the way people read them", () => {
  assert.deepEqual(["leaf10", "leaf2", "leaf1"].sort(natural), ["leaf1", "leaf2", "leaf10"]);
});

test("a time ago picks its unit", () => {
  const now = 100_000;
  assert.equal(ago(now - 30, now), "30s ago");
  assert.equal(ago(now - 300, now), "5m ago");
  assert.equal(ago(now - 5400, now), "1.5h ago");
  assert.equal(ago(now - 2 * 86400, now), "2d ago");
  assert.equal(ago(undefined, now), "");
});

test("a rate picks its unit, and says when there is none yet", () => {
  assert.equal(formatBps(null), "—");
  assert.equal(formatBps(0), "0 bps");
  assert.equal(formatBps(300), "300 bps");
  assert.equal(formatBps(1_500), "1.5 Kbps");
  assert.equal(formatBps(25_000_000), "25 Mbps");
  assert.equal(formatBps(2_000_000_000), "2.0 Gbps");
});

test("a key is read as words", () => {
  assert.equal(keyText('["default","192.168.1.0/31","bgp"]'), "default 192.168.1.0/31 bgp");
  assert.equal(keyText('["", "x", null]'), "x");
  assert.equal(keyText("not json"), "not json");
});

test("values are cut in a summary and whole when opened", () => {
  assert.equal(shortValue(""), "—");
  assert.equal(shortValue("x".repeat(80)).length, 60);
  assert.equal(fullValue({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(hasValue([]), false);
  assert.equal(hasValue(0), true);
  assert.equal(plural(1, "node"), "1 node");
  assert.equal(plural(2, "node"), "2 nodes");
});
