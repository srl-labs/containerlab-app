import assert from "node:assert/strict";
import test from "node:test";

import { containerlabSchema } from "./bundledSchema";
import { parseNodeConfigFields } from "./NodeConfigFields";

function nodeSchema(properties: Record<string, unknown>, definitions: Record<string, unknown> = {}) {
  return { definitions: { ...definitions, "node-config": { type: "object", properties } } };
}

test("node keys without a form of their own come from the bundled schema", () => {
  const fields = parseNodeConfigFields(
    containerlabSchema,
    new Set(["kind", "image", "binds", "env", "labels", "user", "cpu", "exec", "stages"])
  );
  const byPath = new Map(fields.map((field) => [field.path.join("."), field]));
  assert.deepEqual(byPath.get("hostname")?.control, { type: "string" });
  assert.deepEqual(byPath.get("privileged")?.control, { type: "boolean" });
  assert.deepEqual(byPath.get("link-apply-mode")?.control, {
    type: "enum",
    options: ["live", "restart", "recreate"]
  });
  assert.deepEqual(byPath.get("cgroupns-mode")?.control, {
    type: "enum",
    options: ["host", "private"]
  });
  assert.deepEqual(byPath.get("volumes")?.control, { type: "stringList" });
  assert.deepEqual(byPath.get("security-opts")?.control, { type: "stringList" });
  assert.deepEqual(byPath.get("tmpfs")?.control, { type: "map", values: "text" });
  assert.deepEqual(byPath.get("config.vars")?.control, { type: "map", values: "yaml" });
  assert.equal(byPath.get("config.vars")?.label, "Startup Config Variables");
  assert.equal(byPath.get("cgroupns-mode")?.label, "Cgroup Namespace Mode");
  assert.equal(byPath.get("security-opts")?.label, "Security Options");
  // Excluded keys are left to their own forms
  for (const key of ["kind", "image", "binds", "env", "user", "exec", "stages"]) {
    assert.equal(byPath.has(key), false, `${key} should be excluded`);
  }
});

test("a key added upstream gets a field from its schema", () => {
  const schema = nodeSchema(
    {
      image: { type: "string" },
      "future-mode": { type: "string", enum: ["a", "b"], description: "a future mode" },
      "future-flag": {
        type: "boolean",
        markdownDescription: "turn the [future](https://containerlab.dev) on"
      },
      "future-list": { type: "array", items: { type: "string" } },
      "future-map": { type: "object", patternProperties: { ".+": { type: "string" } } },
      "future-block": { $ref: "#/definitions/block" }
    },
    {
      block: {
        type: "object",
        properties: { size: { type: "integer", minimum: 1 }, extra: { type: "object" } }
      }
    }
  );
  assert.deepEqual(parseNodeConfigFields(schema, new Set(["image"])), [
    {
      path: ["future-mode"],
      label: "Future Mode",
      description: "A future mode.",
      control: { type: "enum", options: ["a", "b"] }
    },
    {
      path: ["future-flag"],
      label: "Future Flag",
      description: "Turn the future on.",
      control: { type: "boolean" }
    },
    { path: ["future-list"], label: "Future List", control: { type: "stringList" } },
    { path: ["future-map"], label: "Future Map", control: { type: "map", values: "text" } },
    {
      path: ["future-block", "size"],
      label: "Future Block Size",
      control: { type: "integer", minimum: 1 }
    },
    {
      path: ["future-block", "extra"],
      label: "Future Block Extra",
      control: { type: "map", values: "yaml" }
    }
  ]);
});

test("values without a single form are left out", () => {
  const schema = nodeSchema({
    "object-list": {
      type: "array",
      items: { type: "object", properties: { nested: { type: "array" } } }
    },
    "either-list": { type: "array", items: { anyOf: [{ type: "string" }, { type: "object" }] } }
  });
  assert.deepEqual(parseNodeConfigFields(schema, new Set()), []);
});
