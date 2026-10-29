import assert from "node:assert/strict";
import test from "node:test";

import { captureRoutePlan, parseCaptureMethod, type CaptureMethodHost } from "./captureMethod";

const docker: CaptureMethodHost = { stream: false, localWireshark: false, wiresharkVnc: true, edgeshark: true };
const cluster: CaptureMethodHost = { stream: true, localWireshark: true, wiresharkVnc: true, edgeshark: false };

test("settings values and ids both name a method; anything else is automatic", () => {
  assert.equal(parseCaptureMethod("Wireshark VNC"), "wireshark-vnc");
  assert.equal(parseCaptureMethod("Edgeshark"), "edgeshark");
  assert.equal(parseCaptureMethod("Wireshark on this computer"), "local-wireshark");
  assert.equal(parseCaptureMethod("local-wireshark"), "local-wireshark");
  assert.equal(parseCaptureMethod("Automatic"), "auto");
  assert.equal(parseCaptureMethod(undefined), "auto");
  assert.equal(parseCaptureMethod("packetflix"), "auto");
});

test("automatic: Wireshark VNC on Docker, Wireshark on this computer on a cluster", () => {
  assert.deepEqual(captureRoutePlan("auto", docker), { routes: ["wireshark-vnc", "edgeshark"] });
  assert.deepEqual(captureRoutePlan("auto", cluster), {
    routes: ["local-wireshark", "wireshark-vnc", "download"]
  });
  assert.deepEqual(captureRoutePlan("auto", { ...cluster, localWireshark: false }), {
    routes: ["wireshark-vnc", "download"]
  });
});

test("the picked method opens first where the lab host has it", () => {
  assert.deepEqual(captureRoutePlan("edgeshark", docker).routes, ["edgeshark", "wireshark-vnc"]);
  assert.deepEqual(captureRoutePlan("wireshark-vnc", cluster).routes, [
    "wireshark-vnc",
    "local-wireshark",
    "download"
  ]);
  // Docker: Edgeshark's packetflix link opens Wireshark on this computer.
  assert.deepEqual(captureRoutePlan("local-wireshark", docker), { routes: ["edgeshark", "wireshark-vnc"] });
});

test("a picked method the lab host lacks falls back and says why", () => {
  const edgeshark = captureRoutePlan("edgeshark", cluster);
  assert.deepEqual(edgeshark.routes, ["local-wireshark", "wireshark-vnc", "download"]);
  assert.match(edgeshark.notice ?? "", /^Edgeshark, your default capture method, is not available here: .*Kubernetes \(c9s\).*Using Wireshark on this computer instead\.$/);

  const noDocker = captureRoutePlan("wireshark-vnc", {
    ...cluster,
    localWireshark: false,
    wiresharkVnc: false,
    wiresharkVncUnavailable: "Wireshark in the browser needs Docker on this computer"
  });
  assert.deepEqual(noDocker.routes, ["download"]);
  assert.equal(
    noDocker.notice,
    "Wireshark VNC, your default capture method, is not available here: Wireshark in the browser needs Docker on this computer. Using a .pcapng file instead."
  );

  const notFound = captureRoutePlan("local-wireshark", {
    ...cluster,
    localWireshark: false,
    localWiresharkUnavailable: "Wireshark was not found on this computer"
  });
  assert.deepEqual(notFound.routes, ["wireshark-vnc", "download"]);
  assert.match(notFound.notice ?? "", /Wireshark was not found on this computer\. Using Wireshark VNC instead\.$/);
});
