import assert from "node:assert/strict";
import { test } from "node:test";

import { cpuLoadLevel, formatBitRate, formatBytes, formatPercent } from "./resourceUsage";

test("usage reads in short units", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536 * 1024 ** 2), "1.5 GiB");
  assert.equal(formatBytes(300 * 1024 ** 2), "300 MiB");
  assert.equal(formatPercent(4.25), "4.3 %");
  assert.equal(formatPercent(42.4), "42 %");
  assert.equal(formatPercent(undefined), "–");
});

test("CPU load levels count one busy CPU as full", () => {
  assert.equal(cpuLoadLevel(10), "low");
  assert.equal(cpuLoadLevel(50), "medium");
  assert.equal(cpuLoadLevel(85), "high");
  assert.equal(cpuLoadLevel(350), "high");
});

test("bit rates step by 1000, with one decimal below 100", () => {
  assert.equal(formatBitRate(undefined), "–");
  assert.equal(formatBitRate(800), "800 bps");
  assert.equal(formatBitRate(1500), "1.5 kbps");
  assert.equal(formatBitRate(250_000_000), "250 Mbps");
  assert.equal(formatBitRate(10_000_000_000), "10.0 Gbps");
});
