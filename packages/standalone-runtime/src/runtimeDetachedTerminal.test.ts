import assert from "node:assert/strict";
import test from "node:test";

import { buildDetachedTerminalUrl, decodeDetachedTerminalTarget } from "./runtimeDetachedTerminal";
import type { RuntimeTerminalRequest } from "./stores/runtimeUiStore";

test("detached terminals stay in the app directory and preserve their target", () => {
  const target: RuntimeTerminalRequest = {
    endpointId: "saved-endpoint",
    nodeName: "srl1",
    protocol: "ssh",
    title: "srl1 SSH",
    sessionId: "terminal-session"
  };
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
