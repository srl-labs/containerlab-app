import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeTerminalRequest } from "@containerlab/clab-ui/workspace/state";

import {
  buildDetachedTerminalUrl,
  decodeDetachedTerminalTarget,
  encodeDetachedTerminalTarget
} from "./runtimeDetachedTerminal";

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

test("detached terminals stay in the app directory and preserve their target", () => {
  for (const [baseUri, expectedPath] of [
    ["https://app.test/", "/terminal.html"],
    ["https://app.test/tools/clab/", "/tools/clab/terminal.html"],
    ["https://app.test/tools/clab/index.html", "/tools/clab/terminal.html"]
  ]) {
    const url = new URL(buildDetachedTerminalUrl(target, baseUri));
    assert.equal(url.pathname, expectedPath);
    assert.deepEqual(decodeDetachedTerminalTarget(url.searchParams.get("target")), target);
  }
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
