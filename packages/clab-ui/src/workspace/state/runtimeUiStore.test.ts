import assert from "node:assert/strict";
import test from "node:test";

import type { TopologyRef } from "../../session";

import {
  resumableTerminalState,
  runtimeUiActions,
  subscribeTerminalInput,
  useRuntimeUiStore,
  type RuntimeTerminalPane
} from "./runtimeUiStore";

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

function paneOf(paneId: string): RuntimeTerminalPane | undefined {
  return useRuntimeUiStore
    .getState()
    .terminals.flatMap((group) => group.panes)
    .find((pane) => pane.id === paneId);
}

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

test("setTerminalSession stores the terminal session separately from the topology session", () => {
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

test("only open, resumable terminal panes come back after a reload", () => {
  const pane = (id: string, extra: Partial<RuntimeTerminalPane>): RuntimeTerminalPane => ({
    id,
    nodeName: id,
    protocol: "shell",
    title: id,
    state: "ready",
    terminalSessionId: `session-${id}`,
    resumable: true,
    ...extra
  });
  const restored = resumableTerminalState({
    activeTerminalGroupId: "gone",
    terminalShell: { id: "shell", x: 0, y: 0, width: 800, height: 400, zIndex: 1401, minimized: false },
    terminals: [
      {
        id: "group-1",
        title: "Shell",
        activePaneId: "exited",
        panes: [
          pane("live", { state: "reconnecting", error: "Connection lost." }),
          pane("exited", { state: "exited" }),
          pane("old-server", { resumable: undefined }),
          pane("elsewhere", { state: "detached" })
        ]
      },
      { id: "group-2", title: "Expired", activePaneId: "expired", panes: [pane("expired", { state: "expired" })] }
    ]
  });
  assert.deepEqual(
    restored?.terminals.map((group) => ({
      id: group.id,
      activePaneId: group.activePaneId,
      panes: group.panes.map((entry) => [entry.id, entry.state, entry.error])
    })),
    [{ id: "group-1", activePaneId: "live", panes: [["live", "connecting", undefined]] }]
  );
  assert.equal(restored?.activeTerminalGroupId, "group-1");
});

test("text for a pane waits until its session connects, in order", () => {
  const paneId = openSshTerminal();
  runtimeUiActions.sendTerminalInput(paneId, "enter candidate");
  runtimeUiActions.sendTerminalInput(paneId, "commit now");

  const typed: string[] = [];
  const unsubscribe = subscribeTerminalInput(paneId, (text) => typed.push(text));
  runtimeUiActions.sendTerminalInput(paneId, "show version");
  unsubscribe();
  runtimeUiActions.sendTerminalInput(paneId, "later");

  assert.deepEqual(typed, ["enter candidate\ncommit now", "show version"]);
});

test("text for a pane whose session is over starts a new one for it", () => {
  const paneId = openSshTerminal();
  const store = useRuntimeUiStore.getState();
  store.setTerminalSession(paneId, "session-1");
  store.setTerminalReady(paneId);
  store.setTerminalExited(paneId, 0);

  // Nothing happens, so the reader sends the block again.
  runtimeUiActions.sendTerminalInput(paneId, "enter candidate");
  runtimeUiActions.sendTerminalInput(paneId, "enter candidate");
  const restarted = paneOf(paneId);
  assert.equal(restarted?.state, "creating");
  assert.equal(restarted?.terminalSessionId, undefined);

  const typed: string[] = [];
  subscribeTerminalInput(paneId, (text) => typed.push(text))();
  assert.deepEqual(typed, ["enter candidate\nenter candidate"]);
});

test("a listener left on an ended session gets no text", () => {
  const paneId = openSshTerminal();
  const store = useRuntimeUiStore.getState();
  store.setTerminalSession(paneId, "session-1");
  const old: string[] = [];
  subscribeTerminalInput(paneId, (text) => old.push(text));
  store.setTerminalError(paneId, "Connection failed.");

  runtimeUiActions.sendTerminalInput(paneId, "uptime");
  assert.deepEqual(old, []);
  assert.equal(paneOf(paneId)?.state, "creating");
});

test("text waiting for a session that ends before it connects is dropped", () => {
  for (const end of ["exited", "error", "expired"] as const) {
    const paneId = openSshTerminal(`node-${end}`);
    runtimeUiActions.sendTerminalInput(paneId, "reboot");
    const store = useRuntimeUiStore.getState();
    if (end === "exited") store.setTerminalExited(paneId, 1);
    if (end === "error") store.setTerminalError(paneId, "No such container.");
    if (end === "expired") store.setTerminalExpired(paneId);

    // "Start new session" on the pane: a new shell, not the old text.
    store.restartTerminal(paneId);
    const typed: string[] = [];
    subscribeTerminalInput(paneId, (text) => typed.push(text))();
    assert.deepEqual(typed, [], end);
  }
});

test("text for a session that moved to another window takes it back", () => {
  const paneId = openSshTerminal();
  const store = useRuntimeUiStore.getState();
  store.setTerminalSession(paneId, "session-1");
  store.setTerminalDetached(paneId);

  runtimeUiActions.sendTerminalInput(paneId, "show version");
  assert.equal(paneOf(paneId)?.state, "connecting");
  const typed: string[] = [];
  subscribeTerminalInput(paneId, (text) => typed.push(text))();
  assert.deepEqual(typed, ["show version"]);
});

test("lines a dropped connection had not typed go first when the pane is back", () => {
  const paneId = openSshTerminal();
  const store = useRuntimeUiStore.getState();
  store.setTerminalSession(paneId, "session-1");
  store.setTerminalReady(paneId);

  store.setTerminalReconnecting(paneId, "Connection lost.");
  runtimeUiActions.sendTerminalInput(paneId, "show version");
  runtimeUiActions.requeueTerminalInput(paneId, "session-1", ["set / interface ethernet-1/1", "commit now"]);
  // Lines of another session, or of none, are not this session's to type.
  runtimeUiActions.requeueTerminalInput(paneId, "session-0", ["reboot"]);
  runtimeUiActions.requeueTerminalInput(paneId, "session-1", []);

  const typed: string[] = [];
  subscribeTerminalInput(paneId, (text) => typed.push(text))();
  assert.deepEqual(typed, ["set / interface ethernet-1/1\ncommit now\nshow version"]);
});

test("lines of a session that is over or taken are not kept", () => {
  for (const end of ["exited", "detached"] as const) {
    const paneId = openSshTerminal(`node-${end}`);
    const store = useRuntimeUiStore.getState();
    store.setTerminalSession(paneId, "session-1");
    if (end === "exited") store.setTerminalExited(paneId, 0);
    else store.setTerminalDetached(paneId);
    runtimeUiActions.requeueTerminalInput(paneId, "session-1", ["commit now"]);

    store.setTerminalConnecting(paneId);
    const typed: string[] = [];
    subscribeTerminalInput(paneId, (text) => typed.push(text))();
    assert.deepEqual(typed, [], end);
  }
});

test("text for a closed pane is dropped", () => {
  const paneId = openSshTerminal();
  runtimeUiActions.sendTerminalInput(paneId, "uptime");
  useRuntimeUiStore.getState().closeTerminal(paneId);

  const typed: string[] = [];
  subscribeTerminalInput(paneId, (text) => typed.push(text))();
  runtimeUiActions.sendTerminalInput("no-such-pane", "uptime");
  subscribeTerminalInput("no-such-pane", (text) => typed.push(text))();
  assert.deepEqual(typed, []);
});
