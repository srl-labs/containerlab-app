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
  useRuntimeUiStore.setState({ terminals: [] });
});

test("setTerminalSession stores runtime terminal session separately from topology session", () => {
  const terminalId = useRuntimeUiStore.getState().openTerminal({
    endpointId: "ep-1",
    sessionId: "topology-session-1",
    topologyRef: makeTopologyRef("/labs/demo.clab.yml", "demo", "ep-1"),
    nodeName: "srl1",
    protocol: "ssh",
    title: "SSH: srl1"
  });

  useRuntimeUiStore.getState().setTerminalSession(terminalId, "runtime-terminal-session-1");
  const terminal = useRuntimeUiStore.getState().terminals.find((item) => item.id === terminalId);

  assert.ok(terminal);
  assert.equal(terminal.sessionId, "topology-session-1");
  assert.equal(terminal.terminalSessionId, "runtime-terminal-session-1");
});
