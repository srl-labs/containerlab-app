import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";

import { useGraphStore } from "./graphStore";
import {
  isNodeActionSettled,
  pendingNodeAction,
  readNodeRuntimeFields,
  trackNodeActions,
  useNodeLifecycleStore
} from "./nodeLifecycleStore";

function topologyNode(id: string, state: string, status: string): Node {
  return {
    id,
    type: "topology-node",
    position: { x: 0, y: 0 },
    data: { label: id, role: "router", state, extraData: { state, status } }
  };
}

test("node actions wait for nothing when the node is already where they take it", () => {
  assert.equal(pendingNodeAction("start", { state: "running", status: "Up" }), undefined);
  assert.equal(pendingNodeAction("stop", { state: "exited", status: "Exited" }), undefined);
  assert.equal(pendingNodeAction("start", { state: "exited", status: "Exited" })?.direction, "up");
  assert.equal(pendingNodeAction("restart", { state: "running", status: "Up" })?.direction, "up");
  assert.equal(pendingNodeAction("stop", { state: "running", status: "Up" })?.direction, "down");
});

test("node actions settle once the node shows their outcome", () => {
  const stop = pendingNodeAction("stop", { state: "running", status: "Up 2 hours" });
  assert.ok(stop);
  assert.equal(isNodeActionSettled(stop, { state: "running", status: "Up 2 hours" }), false);
  assert.equal(isNodeActionSettled(stop, { state: "exited", status: "Exited" }), true);

  // A restart is through once the node runs again with anything changed.
  const restart = pendingNodeAction("restart", { state: "running", status: "Up 2 hours" });
  assert.ok(restart);
  assert.equal(isNodeActionSettled(restart, { state: "running", status: "Up 2 hours" }), false);
  assert.equal(isNodeActionSettled(restart, { state: "exited", status: "Exited" }), false);
  assert.equal(isNodeActionSettled(restart, { state: "running", status: "Up" }), true);
});

test("readNodeRuntimeFields falls back to the node's extraData", () => {
  assert.deepEqual(
    readNodeRuntimeFields({ extraData: { state: "running", status: "Up (healthy)" } }),
    { state: "running", status: "Up (healthy)" }
  );
  assert.deepEqual(readNodeRuntimeFields(undefined), { state: "", status: "" });
});

test("trackNodeActions remembers actions on topology nodes until they time out", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  useGraphStore.getState().setGraph(
    [
      topologyNode("srl1", "exited", "Exited"),
      topologyNode("srl2", "running", "Up"),
      { id: "host", type: "network-node", position: { x: 0, y: 0 }, data: { label: "host" } }
    ],
    []
  );

  trackNodeActions("start", ["srl1", "srl2", "host"]);
  trackNodeActions("logs", ["srl2"]);
  assert.deepEqual(Object.keys(useNodeLifecycleStore.getState().pending), ["srl1"]);

  trackNodeActions("restart", ["srl2"]);
  useNodeLifecycleStore.getState().settleNodeAction("srl1");
  assert.deepEqual(Object.keys(useNodeLifecycleStore.getState().pending), ["srl2"]);

  t.mock.timers.tick(60_000);
  assert.deepEqual(useNodeLifecycleStore.getState().pending, {});
});
