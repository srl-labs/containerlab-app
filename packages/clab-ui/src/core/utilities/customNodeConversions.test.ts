import assert from "node:assert/strict";
import test from "node:test";

import {
  createNewTemplateEditorData,
  missingTemplateFields,
  templateNodeBaseName
} from "./customNodeConversions";

test("a template needs a name and a kind before a host will save it", () => {
  assert.deepEqual(missingTemplateFields({ customName: "leaf", kind: "linux" }), []);
  assert.deepEqual(missingTemplateFields({ customName: "", kind: "linux" }), ["customName"]);
  assert.deepEqual(missingTemplateFields({ customName: "leaf", kind: "" }), ["kind"]);
  assert.deepEqual(missingTemplateFields({}), ["customName", "kind"]);
});

test("spaces do not count as a value", () => {
  assert.deepEqual(missingTemplateFields({ customName: "   ", kind: "\t" }), ["customName", "kind"]);
});

test("a new template starts with its kind set and only its name to fill in", () => {
  assert.deepEqual(missingTemplateFields(createNewTemplateEditorData()), ["customName"]);
});

test("a template's base name names its nodes", () => {
  assert.equal(templateNodeBaseName({ name: "SRLinux Latest", baseName: "srl" }), "srl");
  assert.equal(templateNodeBaseName({ name: "leaf", baseName: "  spine  " }), "spine");
});

test("without a base name, nodes are named after the template", () => {
  assert.equal(templateNodeBaseName({ name: "leaf" }), "leaf");
  assert.equal(templateNodeBaseName({ name: "leaf", baseName: "" }), "leaf");
  assert.equal(templateNodeBaseName({ name: "leaf", baseName: "   " }), "leaf");
});

test("the name is made valid for a topology", () => {
  assert.equal(templateNodeBaseName({ name: "My leaf" }), "My-leaf");
  assert.equal(templateNodeBaseName({ name: "  (old) leaf #2  " }), "old-leaf-2");
  assert.equal(templateNodeBaseName({ name: "srl_24.10-a" }), "srl_24.10-a");
  assert.equal(templateNodeBaseName({ name: "leaf", baseName: "my leaf" }), "my-leaf");
});

test("a name with nothing usable in it still gives a node name", () => {
  assert.equal(templateNodeBaseName({ name: "!!!" }), "node");
});
