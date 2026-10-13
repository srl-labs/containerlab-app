/* global describe, it, beforeEach */
/**
 * Tests for link captures sent from the topology canvas.
 *
 * The canvas names a port the way the topology does (SR OS 1/1/c1/1, Linux
 * eth1); containerlab lists links as host-side clab-s-* interfaces aliased to
 * that name. Data below was recorded from a distributed SR-SIM lab.
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

import { setRunningLabsProvider } from "../../../src/globals";
import { nodeCommandService } from "../../../src/reactTopoViewer/extension/services/NodeCommandService";

const vscodeStub = require("../../helpers/vscode-stub");

const YAML_PATH = "/labs/capdist.clab.yml";

function port(name: string, alias: string) {
  return { name, alias, state: "up" };
}

const LAB = {
  labPath: { absolute: YAML_PATH, relative: "capdist.clab.yml" },
  containers: [
    {
      name: "clab-capdist-sr1-a",
      name_short: "sr1-a",
      label: "sr1-a",
      interfaces: [
        port("_nokia_fabric", ""),
        port("clab-s-6b26d4e7", "1/1/c1/1"),
        port("clab-s-8b54dd8d", "2/1/c1/1"),
        port("clab-s-9ded930f", "1/1/c2/1"),
        port("eth0", "")
      ]
    },
    {
      name: "clab-capdist-client1",
      name_short: "client1",
      label: "client1",
      interfaces: [port("clab-s-82b47fe6", "eth2"), port("clab-s-d2115f7f", "eth1"), port("eth0", "")]
    }
  ]
};

async function captureFromLink(nodeName: string, interfaceName: string) {
  vscodeStub.commands.executed.length = 0;
  const result = await nodeCommandService.handleInterfaceEndpoint(
    "clab-interface-capture",
    { nodeName, interfaceName },
    YAML_PATH
  );
  expect(result.error).to.equal(null);
  return vscodeStub.commands.executed as Array<{ command: string; args: any[] }>;
}

describe("link capture from the topology canvas", () => {
  beforeEach(() => {
    setRunningLabsProvider({
      discoverInspectLabs: async () => ({ capdist: LAB })
    } as any);
  });

  it("resolves an SR OS port to its host-side link interface", async () => {
    const executed = await captureFromLink("clab-capdist-sr1-a", "1/1/c1/1");

    expect(executed).to.have.length(1);
    expect(executed[0].command).to.equal("containerlab.interface.capture");
    expect(executed[0].args).to.have.length(1);
    const [iface] = executed[0].args;
    expect(iface).to.include({
      parentName: "clab-capdist-sr1-a",
      name: "clab-s-6b26d4e7",
      alias: "1/1/c1/1"
    });
  });

  it("resolves the Linux end of the same link", async () => {
    const executed = await captureFromLink("clab-capdist-client1", "eth1");

    expect(executed[0].args[0]).to.include({
      parentName: "clab-capdist-client1",
      name: "clab-s-d2115f7f",
      alias: "eth1"
    });
  });

  it("captures ports named inside the node as-is, together with eth0", async () => {
    vscodeStub.commands.executed.length = 0;
    const result = await nodeCommandService.handleInterfaceEndpoint(
      "clab-interface-capture",
      {
        nodeName: "clab-capdist-sr1-a",
        interfaceName: "eth0",
        interfaceNames: ["eth0", "e1-1-c1-1"],
        nodeNamespace: true
      },
      YAML_PATH
    );

    expect(result.error).to.equal(null);
    const [call] = vscodeStub.commands.executed;
    expect(call.args[1].map((iface: { name: string }) => iface.name)).to.deep.equal([
      "eth0",
      "e1-1-c1-1"
    ]);
  });

  it("captures both ends of a link in one command, each resolved in its own node", async () => {
    vscodeStub.commands.executed.length = 0;
    const result = await nodeCommandService.handleInterfaceEndpoint(
      "clab-interface-capture",
      {
        nodeName: "clab-capdist-sr1-a",
        interfaceName: "1/1/c1/1",
        targets: [
          { nodeName: "clab-capdist-sr1-a", interfaceName: "1/1/c1/1" },
          { nodeName: "clab-capdist-client1", interfaceName: "eth1" }
        ]
      },
      YAML_PATH
    );

    expect(result.error).to.equal(null);
    const [call] = vscodeStub.commands.executed;
    expect(call.command).to.equal("containerlab.interface.capture");
    expect(
      call.args[1].map((iface: { parentName: string; name: string }) => [iface.parentName, iface.name])
    ).to.deep.equal([
      ["clab-capdist-sr1-a", "clab-s-6b26d4e7"],
      ["clab-capdist-client1", "clab-s-d2115f7f"]
    ]);
  });

  it("keeps the requested name when the lab is not running", async () => {
    setRunningLabsProvider({ discoverInspectLabs: async () => ({}) } as any);

    const executed = await captureFromLink("clab-capdist-sr1-a", "1/1/c1/1");

    expect(executed[0].args[0]).to.include({ name: "1/1/c1/1" });
  });
});
