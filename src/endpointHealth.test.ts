import assert from "node:assert/strict";
import test from "node:test";

import {
  formatEndpointHealthBytes,
  formatEndpointHealthPercent,
  formatEndpointHealthUsedTotal
} from "./endpointHealth";

test("formatEndpointHealthPercent formats finite values", () => {
  assert.equal(formatEndpointHealthPercent(0), "0.0%");
  assert.equal(formatEndpointHealthPercent(4.23), "4.2%");
  assert.equal(formatEndpointHealthPercent(56.78), "57%");
});

test("formatEndpointHealthPercent handles invalid values", () => {
  assert.equal(formatEndpointHealthPercent(undefined), "n/a");
  assert.equal(formatEndpointHealthPercent(Number.NaN), "n/a");
});

test("formatEndpointHealthBytes scales binary units", () => {
  assert.equal(formatEndpointHealthBytes(512), "512 B");
  assert.equal(formatEndpointHealthBytes(1536), "1.5 KiB");
  assert.equal(formatEndpointHealthBytes(10 * 1024 * 1024), "10 MiB");
  assert.equal(formatEndpointHealthBytes(3 * 1024 * 1024 * 1024), "3.0 GiB");
});

test("formatEndpointHealthUsedTotal combines used and total values", () => {
  assert.equal(
    formatEndpointHealthUsedTotal(3 * 1024 * 1024 * 1024, 8 * 1024 * 1024 * 1024),
    "3.0 GiB / 8.0 GiB"
  );
});

