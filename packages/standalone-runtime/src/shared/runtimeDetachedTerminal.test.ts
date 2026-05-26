import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeDetachedTerminalTarget,
  encodeDetachedTerminalTarget
} from "../runtimeDetachedTerminal";
import type { RuntimeTerminalRequest } from "../stores/runtimeUiStore";

const target: RuntimeTerminalRequest = {
  endpointId: "ep-1",
  nodeName: "srl1",
  protocol: "ssh",
  sessionId: "topology-session-1",
  title: "SSH: srl1",
  topologyRef: {
    annotationsPath: "/labs/demo.clab.yml.annotations.json",
    labName: "demo",
    source: "standalone",
    topologyId: "standalone:ep-1::/labs/demo.clab.yml",
    yamlPath: "/labs/demo.clab.yml"
  }
};

test("detached terminal target round trips through the URL payload", () => {
  const encoded = encodeDetachedTerminalTarget(target);
  assert.deepEqual(decodeDetachedTerminalTarget(encoded), target);
});

test("detached terminal target strips pane runtime state from duplicate windows", () => {
  const paneLikeTarget: RuntimeTerminalRequest & {
    id: string;
    state: "ready";
    terminalSessionId: string;
  } = {
    ...target,
    id: "pane-1",
    state: "ready",
    terminalSessionId: "runtime-terminal-session-1"
  };
  const encoded = encodeDetachedTerminalTarget(paneLikeTarget);
  assert.deepEqual(decodeDetachedTerminalTarget(encoded), target);
});

test("detached terminal target rejects malformed payloads", () => {
  assert.equal(decodeDetachedTerminalTarget(null), null);
  assert.equal(decodeDetachedTerminalTarget("not-base64"), null);

  const missingNodeName = encodeDetachedTerminalTarget({
    ...target,
    nodeName: ""
  });
  assert.equal(decodeDetachedTerminalTarget(missingNodeName), null);
});
