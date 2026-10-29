/* global describe, it */
import "../../helpers/clab-ui-esm";
/**
 * Captures on lab hosts that capture lab links as one stream (c9s): where a
 * capture can go, and the terminal pipe into Wireshark.
 */
import Module from "module";
import path from "path";

import { expect } from "chai";

const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options: any
) {
  if (request === "vscode") {
    return path.join(__dirname, "..", "..", "helpers", "vscode-stub.js");
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

import {
  captureTerminalCommand,
  streamCaptureDeliveries
} from "../../../src/commands/captureStream";

describe("stream capture deliveries", () => {
  const vnc = { support: { wiresharkVnc: true } };
  const noVnc = { support: { wiresharkVnc: false } };
  const order = (...args: Parameters<typeof streamCaptureDeliveries>) =>
    streamCaptureDeliveries(...args).deliveries;

  it("pipes into Wireshark in a terminal on a cluster on this machine, or saves", () => {
    expect(order(true, noVnc, undefined)).to.deep.equal(["terminal", "save"]);
  });

  it("Automatic: a found Wireshark first, Wireshark VNC next, then saving", () => {
    expect(order(true, vnc, undefined, true)).to.deep.equal(["terminal", "vnc", "save"]);
    expect(order(true, vnc, "Automatic", true)).to.deep.equal(["terminal", "vnc", "save"]);
    expect(order(false, vnc, "Automatic", true)).to.deep.equal(["wireshark", "vnc", "save"]);
  });

  it("Automatic without Wireshark here: Wireshark VNC first, Wireshark still offered", () => {
    expect(order(true, vnc, "Automatic", false)).to.deep.equal(["vnc", "terminal", "save"]);
    expect(order(false, vnc, undefined, false)).to.deep.equal(["vnc", "wireshark", "save"]);
    // Nothing else: picking Wireshark says it was not found and offers saving.
    expect(order(false, noVnc, undefined, false)).to.deep.equal(["wireshark", "save"]);
  });

  it("opens the picked method first, quietly, where the lab host has it", () => {
    expect(streamCaptureDeliveries(true, vnc, "Wireshark VNC", true)).to.deep.equal({
      deliveries: ["vnc", "terminal", "save"]
    });
    expect(streamCaptureDeliveries(false, vnc, "Wireshark on this computer", true)).to.deep.equal({
      deliveries: ["wireshark", "vnc", "save"]
    });
  });

  it("falls back from a method the lab host lacks, and says why", () => {
    // Edgeshark, a value from before capture streams: c9s has none.
    const edgeshark = streamCaptureDeliveries(true, vnc, "Edgeshark", true);
    expect(edgeshark.deliveries).to.deep.equal(["terminal", "vnc", "save"]);
    expect(edgeshark.notice).to.match(/^Edgeshark, your default capture method, is not available here: .*Kubernetes \(c9s\)/);

    const notFound = streamCaptureDeliveries(false, vnc, "Wireshark on this computer", false);
    expect(notFound.deliveries).to.deep.equal(["vnc", "wireshark", "save"]);
    expect(notFound.notice).to.match(/Wireshark was not found on this computer\. Using Wireshark VNC instead\.$/);

    const noDocker = streamCaptureDeliveries(
      true,
      { support: { wiresharkVnc: false }, profile: { wiresharkVncUnavailable: "Wireshark in the browser needs Docker on this computer" } },
      "Wireshark VNC",
      true
    );
    expect(noDocker.deliveries).to.deep.equal(["terminal", "save"]);
    expect(noDocker.notice).to.equal(
      "Wireshark VNC, your default capture method, is not available here: Wireshark in the browser needs Docker on this computer. Using Wireshark on this computer instead."
    );
  });

  it("pipes the capture's stdout into wireshark -k -i -", () => {
    expect(
      captureTerminalCommand(
        "containerlab -r c9s capture --name demo --target n1:eth1 -w -",
        "/usr/bin/wireshark"
      )
    ).to.equal(
      "containerlab -r c9s capture --name demo --target n1:eth1 -w - | /usr/bin/wireshark -k -i -"
    );
    expect(
      captureTerminalCommand("clab", "/Applications/Wire shark.app/Contents/MacOS/Wireshark")
    ).to.equal("clab | '/Applications/Wire shark.app/Contents/MacOS/Wireshark' -k -i -");
    // A Windows Wireshark under WSL, run through interop.
    expect(captureTerminalCommand("clab", "/mnt/c/Program Files/Wireshark/Wireshark.exe")).to.equal(
      "clab | '/mnt/c/Program Files/Wireshark/Wireshark.exe' -k -i -"
    );
  });
});
