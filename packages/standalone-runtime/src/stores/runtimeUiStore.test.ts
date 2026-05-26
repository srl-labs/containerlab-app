import assert from "node:assert/strict";
import test from "node:test";

import type { TopologyRef } from "@srl-labs/clab-ui/session";

import { useRuntimeUiStore } from "./runtimeUiStore";

function makeTopologyRef(path: string, labName: string, endpointId: string): TopologyRef {
  return {
    topologyId: `standalone:${endpointId}::${path}`,
    labName,
    yamlPath: path,
    annotationsPath: `${path}.annotations.json`,
    source: "standalone"
  };
}

test.beforeEach(() => {
  useRuntimeUiStore.setState({ activeTerminalGroupId: undefined, terminals: [] });
});

function openSshTerminal(nodeName = "srl1"): string {
  return useRuntimeUiStore.getState().openTerminal({
    endpointId: "ep-1",
    sessionId: "topology-session-1",
    topologyRef: makeTopologyRef("/labs/demo.clab.yml", "demo", "ep-1"),
    nodeName,
    protocol: "ssh",
    title: `SSH: ${nodeName}`
  });
}

test("openTerminal creates a tab with an active pane", () => {
  const terminalId = openSshTerminal();
  const state = useRuntimeUiStore.getState();
  const group = state.terminals[0];

  assert.ok(group);
  assert.equal(state.activeTerminalGroupId, group.id);
  assert.equal(group.activePaneId, terminalId);
  assert.equal(group.panes.length, 1);
  assert.equal(group.panes[0].nodeName, "srl1");
});

test("openTerminal focuses an existing matching pane instead of duplicating it", () => {
  const terminalId = openSshTerminal();
  const duplicateId = openSshTerminal();
  const state = useRuntimeUiStore.getState();

  assert.equal(duplicateId, terminalId);
  assert.equal(state.terminals.length, 1);
  assert.equal(state.terminals[0].panes.length, 1);
  assert.equal(state.terminals[0].activePaneId, terminalId);
});

test("splitTerminal duplicates the active pane target in the same tab", () => {
  const terminalId = openSshTerminal();
  const splitId = useRuntimeUiStore.getState().splitTerminal(terminalId);
  const group = useRuntimeUiStore.getState().terminals[0];

  assert.ok(splitId);
  assert.equal(group.panes.length, 2);
  assert.equal(group.activePaneId, splitId);
  assert.deepEqual(
    group.panes.map((pane) => pane.nodeName),
    ["srl1", "srl1"]
  );
  assert.deepEqual(
    group.panes.map((pane) => pane.protocol),
    ["ssh", "ssh"]
  );
});

test("closeTerminal removes empty terminal tabs", () => {
  const terminalId = openSshTerminal();
  useRuntimeUiStore.getState().closeTerminal(terminalId);

  const state = useRuntimeUiStore.getState();
  assert.equal(state.terminals.length, 0);
  assert.equal(state.activeTerminalGroupId, undefined);
});

test("closeTerminal removes only the requested split pane", () => {
  const terminalId = openSshTerminal();
  const splitId = useRuntimeUiStore.getState().splitTerminal(terminalId);

  assert.ok(splitId);
  useRuntimeUiStore.getState().closeTerminal(splitId);

  const state = useRuntimeUiStore.getState();
  const group = state.terminals[0];

  assert.ok(group);
  assert.equal(group.panes.length, 1);
  assert.equal(group.panes[0].id, terminalId);
  assert.equal(group.activePaneId, terminalId);
});

test("focusTerminal keeps the shell minimized when focusing the shell itself", () => {
  openSshTerminal();

  useRuntimeUiStore.getState().setTerminalMinimized("runtime-terminal-shell", true);
  useRuntimeUiStore.getState().focusTerminal("runtime-terminal-shell");

  assert.equal(useRuntimeUiStore.getState().terminalShell.minimized, true);
});

test("focusTerminal restores the shell when focusing a pane", () => {
  const terminalId = openSshTerminal();

  useRuntimeUiStore.getState().setTerminalMinimized("runtime-terminal-shell", true);
  useRuntimeUiStore.getState().focusTerminal(terminalId);

  assert.equal(useRuntimeUiStore.getState().terminalShell.minimized, false);
});

test("setTerminalSession stores runtime terminal session separately from topology session", () => {
  const terminalId = openSshTerminal();

  useRuntimeUiStore.getState().setTerminalSession(terminalId, "runtime-terminal-session-1");
  const terminal = useRuntimeUiStore
    .getState()
    .terminals.flatMap((group) => group.panes)
    .find((item) => item.id === terminalId);

  assert.ok(terminal);
  assert.equal(terminal.sessionId, "topology-session-1");
  assert.equal(terminal.terminalSessionId, "runtime-terminal-session-1");
});
