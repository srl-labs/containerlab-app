import assert from "node:assert/strict";
import test from "node:test";
import Ajv from "ajv";

import { containerlabSchema, defaultSchemaData } from "./bundledSchema";

const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(containerlabSchema);

function topology(node: Record<string, unknown>) {
  return { name: "schema-test", topology: { nodes: { router: node } } };
}

test("bundled schema accepts upstream hostname and volume settings", () => {
  assert.equal(validate(topology({
    kind: "linux",
    image: "alpine",
    hostname: "custom-router",
    volumes: ["router-data:/data"]
  })), true, JSON.stringify(validate.errors));
});

test("bundled schema rejects invalid hostname and volume settings", () => {
  for (const fields of [{ hostname: "" }, { hostname: 42 }, { volumes: "data:/data" }]) {
    assert.equal(validate(topology({ kind: "linux", image: "alpine", ...fields })), false);
  }
});

test("bundled schema exposes FRRouting kinds and daemon options", () => {
  for (const kind of ["frr", "frrouting"]) {
    assert.ok(defaultSchemaData.kinds.includes(kind));
    assert.equal(validate(topology({
      kind,
      image: "quay.io/frrouting/frr",
      extras: { frr: { daemons: ["bgpd", "ospfd"] } }
    })), true, JSON.stringify(validate.errors));
  }
});
