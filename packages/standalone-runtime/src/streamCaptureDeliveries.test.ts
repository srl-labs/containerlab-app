import assert from "node:assert/strict";
import test from "node:test";

import {
  edgesharkCaptureRoute,
  streamCaptureDeliveries,
  unavailableStreamCaptureDeliveries
} from "./streamCaptureDeliveries";

const order = (...args: Parameters<typeof streamCaptureDeliveries>) => streamCaptureDeliveries(...args).deliveries;

test("the desktop app opens Wireshark on this machine first", () => {
  assert.deepEqual(order({ support: { wiresharkVnc: false } }, { localWireshark: true }), [
    "local-wireshark",
    "download"
  ]);
  // A c9s clab-api-server from the desktop app: its stream into local Wireshark, or its VNC.
  assert.deepEqual(order({ support: { wiresharkVnc: true } }, { localWireshark: true }), [
    "local-wireshark",
    "wireshark-vnc",
    "download"
  ]);
});

test("the web app opens Wireshark VNC by default, a download otherwise", () => {
  assert.deepEqual(order({ support: { wiresharkVnc: true } }, { localWireshark: false }), [
    "wireshark-vnc",
    "download"
  ]);
  // A cluster the web app reaches itself (WEB_LOCAL_LABS) with Docker next to it: Wireshark VNC, else a download.
  assert.deepEqual(order({ support: { wiresharkVnc: false } }, { localWireshark: false }), ["download"]);
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

test("the endpoint's default capture method comes first, or the dialog says why not", () => {
  assert.deepEqual(streamCaptureDeliveries({ support: { wiresharkVnc: true } }, { localWireshark: true }, "wireshark-vnc"), {
    deliveries: ["wireshark-vnc", "local-wireshark", "download"]
  });
  const web = streamCaptureDeliveries({ support: { wiresharkVnc: true } }, { localWireshark: false }, "local-wireshark");
  assert.deepEqual(web.deliveries, ["wireshark-vnc", "download"]);
  assert.match(web.notice ?? "", /the web app cannot start Wireshark on your computer\. Using Wireshark VNC instead\.$/);
  const edgeshark = streamCaptureDeliveries({ support: { wiresharkVnc: false } }, { localWireshark: false }, "edgeshark");
  assert.deepEqual(edgeshark.deliveries, ["download"]);
  assert.match(edgeshark.notice ?? "", /Kubernetes \(c9s\).*Using a \.pcapng file instead\.$/);
});

test("Docker and Podman lab hosts: Wireshark VNC by default, Edgeshark when picked", () => {
  const both = { wiresharkVnc: true, edgeshark: true };
  assert.deepEqual(edgesharkCaptureRoute("auto", both), { route: "wireshark-vnc" });
  assert.deepEqual(edgesharkCaptureRoute("wireshark-vnc", both), { route: "wireshark-vnc" });
  assert.deepEqual(edgesharkCaptureRoute("edgeshark", both), { route: "edgeshark" });
  // Edgeshark's packetflix link starts Wireshark on this computer.
  assert.deepEqual(edgesharkCaptureRoute("local-wireshark", both), { route: "edgeshark" });
  assert.deepEqual(edgesharkCaptureRoute("auto", undefined), { route: "wireshark-vnc" });
  const noVnc = edgesharkCaptureRoute("wireshark-vnc", { wiresharkVnc: false, edgeshark: true });
  assert.equal(noVnc.route, "edgeshark");
  assert.match(noVnc.notice ?? "", /this lab host has no Wireshark VNC\. Using Edgeshark instead\.$/);
});
