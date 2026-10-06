import assert from "node:assert/strict";
import test from "node:test";

import type { NodeAnnotation } from "../types/topology";

import { extractIconVisuals } from "./utils";

test("extractIconVisuals passes the box appearance through, normalized", () => {
  const annotation: NodeAnnotation = {
    id: "srl1",
    iconColor: "#ff0000",
    labelPosition: "top",
    // Opacity clamps to its default and is dropped along with the other defaults.
    box: { color: " #112233 ", opacity: 140, blur: 8, borderWidth: 1, shadow: true }
  };

  assert.deepEqual(extractIconVisuals(annotation), {
    iconColor: "#ff0000",
    labelPosition: "top",
    box: { color: "#112233", blur: 8 }
  });
});

test("extractIconVisuals leaves out an empty or invalid box", () => {
  assert.deepEqual(extractIconVisuals({ id: "a", box: { opacity: 100, shadow: true } }), {});
  assert.deepEqual(
    extractIconVisuals({ id: "b", box: "red" as unknown as NodeAnnotation["box"] }),
    {}
  );
  assert.deepEqual(extractIconVisuals(undefined), {});
});
