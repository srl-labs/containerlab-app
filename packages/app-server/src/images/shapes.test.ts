import assert from "node:assert/strict";
import test from "node:test";

import { parseIndex, parseRecord, parseRecords } from "./shapes.ts";

test("records with the vendor fields and legacy records both pass", () => {
  const [modern, unbuildable, legacy] = parseRecords([
    { key: "labhub:a", source: "labhub", status: "available", kind: "cisco_vios", vendor: "Cisco", folder: "Cisco/IOSv", model: "IOSv" },
    { key: "labhub:h3c", source: "labhub", status: "unbuildable", kind: null, vendor: "H3C", folder: "H3C/vSR", model: null },
    { key: "local:b", source: "local", status: "cached" }
  ]);
  assert.equal(modern.vendor, "Cisco");
  assert.equal(unbuildable.kind, null);
  assert.equal(unbuildable.model, null);
  assert.equal("vendor" in legacy, false);
  assert.equal(parseRecord({ key: "k", status: "built", folder: null }).folder, null);
});

test("a vendor field of the wrong type is dropped and a missing key is still incompatible", () => {
  const [row] = parseRecords([{ key: "k", status: "built", vendor: 3, folder: ["x"] }]);
  assert.equal("vendor" in row, false);
  assert.equal("folder" in row, false);
  assert.throws(() => parseRecords([{ status: "built" }]));
});

test("index vendors are kept when well formed and absent for an older climg", () => {
  assert.deepEqual(parseIndex({ release: "R", vendors: [{ vendor: "H3C", entries: 2, buildable: 0 }, { vendor: 1 }, "x"] }).vendors, [
    { vendor: "H3C", entries: 2, buildable: 0 }
  ]);
  assert.equal("vendors" in parseIndex({ release: "R" }), false);
  assert.equal("vendors" in parseIndex({ release: "R", vendors: "nope" }), false);
});
