import assert from "node:assert/strict";
import test from "node:test";

import {
  formatEndpointHealthTooltip,
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

test("formatEndpointHealthTooltip includes cpu memory and disk details", () => {
  assert.equal(
    formatEndpointHealthTooltip({
      serverInfo: {
        version: "test",
        uptime: "1m",
        startTime: "2026-04-24T00:00:00Z"
      },
      metrics: {
        cpu: { usagePercent: 12.4, numCPU: 8 },
        mem: {
          usagePercent: 45.6,
          usedMem: 4 * 1024 * 1024 * 1024,
          totalMem: 8 * 1024 * 1024 * 1024,
          availableMem: 4 * 1024 * 1024 * 1024
        },
        disk: {
          path: "/",
          usagePercent: 67.8,
          usedDisk: 100 * 1024 * 1024 * 1024,
          totalDisk: 200 * 1024 * 1024 * 1024,
          freeDisk: 100 * 1024 * 1024 * 1024
        }
      }
    }),
    [
      "CPU: 12% (8 cores)",
      "Memory: 46% (4.0 GiB / 8.0 GiB)",
      "Disk: 68% (100 GiB / 200 GiB on /)"
    ].join("\n")
  );
});

test("formatEndpointHealthTooltip handles missing metric groups", () => {
  assert.equal(
    formatEndpointHealthTooltip({
      serverInfo: {
        version: "test",
        uptime: "1m",
        startTime: "2026-04-24T00:00:00Z"
      },
      metrics: {}
    }),
    [
      "CPU: n/a (cores n/a)",
      "Memory: n/a (n/a / n/a)",
      "Disk: n/a (n/a / n/a)"
    ].join("\n")
  );
});
