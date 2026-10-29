import assert from "node:assert/strict";
import test from "node:test";

import { streamCaptureDeliveries } from "./streamCaptureDeliveries";

test("the desktop app opens Wireshark on this machine first", () => {
  assert.deepEqual(streamCaptureDeliveries({ wiresharkVnc: false }, { localWireshark: true }), [
    "local-wireshark",
    "download"
  ]);
  // A c9s clab-api-server from the desktop app: its stream into local Wireshark, or its VNC.
  assert.deepEqual(streamCaptureDeliveries({ wiresharkVnc: true }, { localWireshark: true }), [
    "local-wireshark",
    "wireshark-vnc",
    "download"
  ]);
});

test("the web app opens Wireshark VNC by default, a download otherwise", () => {
  assert.deepEqual(streamCaptureDeliveries({ wiresharkVnc: true }, { localWireshark: false }), [
    "wireshark-vnc",
    "download"
  ]);
  // A cluster the web app reaches itself (WEB_LOCAL_LABS): downloads only.
  assert.deepEqual(streamCaptureDeliveries({ wiresharkVnc: false }, { localWireshark: false }), ["download"]);
});
