import assert from "node:assert/strict";
import test from "node:test";

import { streamCaptureDeliveries } from "./streamCaptureDeliveries";

test("the desktop app opens Wireshark on this machine, never a packetflix link", () => {
  assert.deepEqual(
    streamCaptureDeliveries({ wiresharkVnc: false, captureTickets: false }, { localWireshark: true, desktop: true }),
    ["local-wireshark", "download"]
  );
  // A c9s clab-api-server from the desktop app: its stream into local Wireshark, or its VNC.
  assert.deepEqual(
    streamCaptureDeliveries({ wiresharkVnc: true, captureTickets: true }, { localWireshark: true, desktop: true }),
    ["local-wireshark", "wireshark-vnc", "download"]
  );
});

test("the web app opens Wireshark VNC by default, a packetflix link or a download otherwise", () => {
  assert.deepEqual(
    streamCaptureDeliveries({ wiresharkVnc: true, captureTickets: true }, { localWireshark: false, desktop: false }),
    ["wireshark-vnc", "packetflix", "download"]
  );
  assert.deepEqual(
    streamCaptureDeliveries(
      { wiresharkVnc: true, captureTickets: true },
      { localWireshark: false, desktop: false, preferLinks: true }
    ),
    ["packetflix", "wireshark-vnc", "download"]
  );
  // A cluster the web app reaches itself (WEB_LOCAL_LABS): downloads only.
  assert.deepEqual(
    streamCaptureDeliveries({ wiresharkVnc: false, captureTickets: false }, { localWireshark: false, desktop: false }),
    ["download"]
  );
});
