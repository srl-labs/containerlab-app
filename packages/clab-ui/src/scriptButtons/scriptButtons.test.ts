import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";

import {
  SCRIPT_BUTTON_NODE_TYPE,
  annotationsToNodes,
  isAnnotationNodeType,
  nodesToAnnotations,
  scriptButtonToNode
} from "../annotations/annotationNodeConverters";
import type { TopoNode } from "../core/types/graph";
import type { ScriptButtonAnnotation } from "../core/types/topology";
import {
  hostScriptUnavailableMessage,
  parseHostScriptDescription,
  parseHostScriptResponse,
  parseLabOperationSupport
} from "../host/labOperations";
import { buildAnnotationSaveCommand, splitNodeIdsByType } from "../services/deleteSelectionCommands";

import { revealHiddenCharacters } from "./ScriptButtonDialogs";
import { needsConfirmation, trustScript } from "./scriptButtonPolicy";

const BUTTON: ScriptButtonAnnotation = {
  id: "script-button-1",
  label: "Reset lab",
  position: { x: 40, y: 80 },
  scriptPath: "scripts/reset.sh",
  output: "dialog",
  timeoutSeconds: 30,
  icon: "refresh",
  groupId: "rack1"
};

test("script buttons survive a trip through the canvas", () => {
  const nodes = annotationsToNodes([], [], [], [], [BUTTON]);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, SCRIPT_BUTTON_NODE_TYPE);
  assert.equal(isAnnotationNodeType(nodes[0].type), true);
  assert.deepEqual(nodesToAnnotations(nodes).scriptButtonAnnotations, [BUTTON]);
});

test("unknown output modes and empty fields are dropped", () => {
  const node = scriptButtonToNode({
    id: "b",
    label: "x",
    position: { x: 0, y: 0 },
    script: "",
    output: "printer" as ScriptButtonAnnotation["output"],
    timeoutSeconds: Number.NaN
  });
  assert.deepEqual(nodesToAnnotations([node]).scriptButtonAnnotations, [
    { id: "b", label: "x", position: { x: 0, y: 0 } }
  ]);
});

test("deleting a script button never deletes a topology node", () => {
  const button = scriptButtonToNode(BUTTON) as unknown as Node;
  const router = { id: "r1", type: "topology-node", position: { x: 0, y: 0 }, data: {} } as Node;
  const nodesById = new Map([button, router].map((node) => [node.id, node]));
  const split = splitNodeIdsByType(new Set([button.id, router.id]), nodesById);
  assert.deepEqual(split.scriptButtonIds, [BUTTON.id]);
  assert.deepEqual(split.graphNodeIds, ["r1"]);
});

test("saving annotations after a delete keeps the remaining script buttons", () => {
  const command = buildAnnotationSaveCommand([scriptButtonToNode(BUTTON) as unknown as TopoNode]);
  assert.equal(command.command, "setAnnotationsWithMemberships");
  const payload = command.payload as { annotations: { scriptButtonAnnotations?: unknown[] } };
  assert.equal(payload.annotations.scriptButtonAnnotations?.length, 1);
});

test("host script results are parsed defensively", () => {
  assert.deepEqual(parseHostScriptResponse({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false, durationMs: 12 }), {
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    durationMs: 12
  });
  assert.deepEqual(parseHostScriptResponse("nonsense"), {
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 0
  });
  assert.equal(parseLabOperationSupport({ hostScript: true }).hostScript, true);
  assert.equal(parseLabOperationSupport({}).hostScript, false);
});

test("first-run confirmation asks once per exact script on a host and topology", () => {
  const storage = new Map<string, string>();
  const previous = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value)
  };
  try {
    const script = { foreign: false, trustKey: "key-one" };
    assert.equal(needsConfirmation("firstRun", script), true);
    trustScript(script.trustKey);
    assert.equal(needsConfirmation("firstRun", script), false);
    assert.equal(needsConfirmation("always", script), true);
    // A changed script, or the same one elsewhere, has another key.
    assert.equal(needsConfirmation("firstRun", { foreign: false, trustKey: "key-two" }), true);
    assert.equal(needsConfirmation("never", { foreign: false, trustKey: "key-two" }), false);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = previous;
  }
});

test("a script the user may not have written asks in every mode, even when trusted", () => {
  const storage = new Map<string, string>();
  const previous = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value)
  };
  try {
    const script = { foreign: true, trustKey: "shared" };
    trustScript(script.trustKey);
    for (const mode of ["firstRun", "always", "never"] as const) {
      assert.equal(needsConfirmation(mode, script), true, mode);
    }
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = previous;
  }
});

test("a description that says too little is refused, and unclear ownership counts as foreign", () => {
  assert.throws(() => parseHostScriptDescription({ kind: "inline" }));
  assert.equal(parseHostScriptDescription({ sha256: "a", trustKey: "b" }).foreign, true);
  assert.equal(parseHostScriptDescription({ sha256: "a", trustKey: "b", foreign: false }).foreign, false);
});

test("hidden characters in a script show as codes", () => {
  assert.equal(revealHiddenCharacters("rm\u202e -rf"), "rm\u27e6U+202E\u27e7 -rf");
  assert.equal(revealHiddenCharacters("a\tb\nc"), "a\tb\nc");
});

test("the reason a host cannot run scripts reaches the message", () => {
  assert.equal(parseLabOperationSupport({ hostScriptUnavailable: "c9s" }).hostScriptUnavailable, "c9s");
  assert.equal(parseLabOperationSupport({ hostScriptUnavailable: "x" }).hostScriptUnavailable, undefined);
  assert.match(hostScriptUnavailableMessage("c9s"), /Kubernetes/);
  assert.match(hostScriptUnavailableMessage("unsupported-server"), /API_HOST_SCRIPTS/);
});
