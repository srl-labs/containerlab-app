import assert from "node:assert/strict";
import test from "node:test";

import type { CustomNodeTemplate } from "../../core/types/editors";

import { determineType } from "./useNodeCreation";

test("new nodes get containerlab's default type for their kind", () => {
  assert.equal(determineType("nokia_srlinux"), "ixr-d2l");
  assert.equal(determineType("nokia_srsim"), "SR-1");
  assert.equal(determineType("nokia_sros"), "sr-1");
});

test("kinds without a default type get no type", () => {
  assert.equal(determineType("linux"), undefined);
  assert.equal(determineType("juniper_cjunosevolved"), undefined);
  assert.equal(determineType("toString"), undefined);
});

test("a template type wins over the kind default", () => {
  const template = { name: "", kind: "nokia_srsim", type: "SR-7" } as CustomNodeTemplate;
  assert.equal(determineType("nokia_srsim", template), "SR-7");
});

test("named custom templates without a type get no default type", () => {
  const template = { name: "my-sros", kind: "nokia_sros" } as CustomNodeTemplate;
  assert.equal(determineType("nokia_sros", template), undefined);
});
