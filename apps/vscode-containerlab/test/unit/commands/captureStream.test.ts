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
  it("pipes into Wireshark in a terminal on a cluster on this machine, or saves", () => {
    expect(
      streamCaptureDeliveries(true, { captureTickets: false, wiresharkVnc: false }, undefined)
    ).to.deep.equal(["terminal", "save"]);
  });

  it("opens a packetflix link first on a clab-api-server, then VNC, then saves", () => {
    expect(
      streamCaptureDeliveries(false, { captureTickets: true, wiresharkVnc: true }, undefined)
    ).to.deep.equal(["packetflix", "vnc", "save"]);
    expect(
      streamCaptureDeliveries(false, { captureTickets: true, wiresharkVnc: true }, "Edgeshark")
    ).to.deep.equal(["packetflix", "vnc", "save"]);
  });

  it("respects a capture.preferredAction of Wireshark VNC, and offers only what the host has", () => {
    expect(
      streamCaptureDeliveries(false, { captureTickets: true, wiresharkVnc: true }, "Wireshark VNC")
    ).to.deep.equal(["vnc", "packetflix", "save"]);
    expect(
      streamCaptureDeliveries(false, { captureTickets: true, wiresharkVnc: false }, "Wireshark VNC")
    ).to.deep.equal(["packetflix", "save"]);
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
  });
});
