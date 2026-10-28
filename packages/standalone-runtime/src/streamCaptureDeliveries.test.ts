import assert from "node:assert/strict";
import test from "node:test";

import { streamCaptureDeliveries, unavailableStreamCaptureDeliveries } from "./streamCaptureDeliveries";

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
  // A cluster the web app reaches itself (WEB_LOCAL_LABS) with Docker next to it: Wireshark VNC, else a download.
  assert.deepEqual(streamCaptureDeliveries({ wiresharkVnc: false }, { localWireshark: false }), ["download"]);
});

test("Wireshark VNC that needs Docker on this computer is listed as unavailable, with why", () => {
  const reason = "Wireshark in the browser needs Docker on this computer";
  assert.deepEqual(
    unavailableStreamCaptureDeliveries({
      profile: { runtime: "c9s", wiresharkVncUnavailable: reason },
      support: { wiresharkVnc: false } as never
    }),
    { "wireshark-vnc": reason }
  );
  assert.deepEqual(
    unavailableStreamCaptureDeliveries({ profile: { runtime: "c9s" }, support: { wiresharkVnc: false } as never }),
    {}
  );
  assert.deepEqual(
    unavailableStreamCaptureDeliveries({
      profile: { runtime: "c9s", wiresharkVncUnavailable: reason },
      support: { wiresharkVnc: true } as never
    }),
    {}
  );
});
