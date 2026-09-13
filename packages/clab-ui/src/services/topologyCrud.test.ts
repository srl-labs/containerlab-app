import assert from "node:assert/strict";
import test from "node:test";

import { buildSavePositionsCommand } from "./topologyCrud";

test("builds undoable savePositions commands for explicit layout persistence", () => {
  const command = buildSavePositionsCommand([
    { id: "leaf1", position: { x: 10, y: 20 } },
    { id: "mgmt", position: { x: 30, y: 40 } }
  ]);

  assert.deepEqual(command, {
    command: "savePositions",
    payload: [
      { id: "leaf1", position: { x: 10, y: 20 } },
      { id: "mgmt", position: { x: 30, y: 40 } }
    ]
  });
  assert.equal("skipHistory" in command, false);
});
