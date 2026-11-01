import assert from "node:assert/strict";
import test from "node:test";

import { validationErrorLine } from "./useHostTopologyValidation";
import { parseHostValidation, parseManifestExport } from "../../host/labOperations";

test("the line containerlab names becomes the marker's line", () => {
  assert.equal(validationErrorLine("yaml: line 12: did not find expected key"), 12);
  assert.equal(validationErrorLine("node n1: macvlan endpoints are not supported"), undefined);
  assert.equal(validationErrorLine("line 0 is not a line"), undefined);
});

test("validate and manifest results from a lab host are read defensively", () => {
  assert.deepEqual(parseHostValidation({ valid: true, path: "x" }), { valid: true });
  assert.deepEqual(parseHostValidation({ valid: false, error: " bad " }), { valid: false, error: "bad" });
  assert.deepEqual(parseHostValidation("nope"), { valid: false, error: "The lab host sent no validation result." });
  assert.deepEqual(parseManifestExport({ yaml: "kind: Topology\n" }), { yaml: "kind: Topology\n" });
  assert.deepEqual(parseManifestExport(undefined), { yaml: "" });
});
