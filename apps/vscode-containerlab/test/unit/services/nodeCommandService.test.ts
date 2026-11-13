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

/**
 * A distributed SR-SIM node is no container of its own: its CPM and line card
 * run as sub-containers. Data recorded from a lab with containerlab 0.83.0:
 * dist is an SR-7s (CPM A and card 1), integ an SR-1, linked on 1/1/c1/1.
 */
const SRSIM_YAML_PATH = "/labs/srsimcap.clab.yml";

function srsimContainer(name: string, nameShort: string, rootNodeName: string | undefined, link: string) {
  return {
    name,
    name_short: nameShort,
    label: nameShort,
    cID: `id-${nameShort}`,
    kind: "nokia_srsim",
    labName: "srsimcap",
    ...(rootNodeName ? { rootNodeName } : {}),
    interfaces: [port("_nokia_fabric", ""), port(link, "1/1/c1/1"), port("eth0", "")]
  };
}

const SRSIM_LAB = {
  labPath: { absolute: SRSIM_YAML_PATH, relative: "srsimcap.clab.yml" },
  containers: [
    srsimContainer("clab-srsimcap-dist-1", "dist-1", "dist", "clab-s-c3905c8d"),
    srsimContainer("clab-srsimcap-dist-a", "dist-a", "dist", "clab-s-c3905c8d"),
    srsimContainer("clab-srsimcap-integ", "integ", undefined, "clab-s-3d65afcd")
  ]
};

async function interfaceEndpoint(
  endpoint: string,
  payload: Parameters<typeof nodeCommandService.handleInterfaceEndpoint>[1]
) {
  vscodeStub.commands.executed.length = 0;
  const result = await nodeCommandService.handleInterfaceEndpoint(endpoint, payload, SRSIM_YAML_PATH);
  expect(result.error).to.equal(null);
  return vscodeStub.commands.executed as Array<{ command: string; args: any[] }>;
}

describe("canvas ports of a distributed SR-SIM node", () => {
  beforeEach(() => {
    setRunningLabsProvider({
      discoverInspectLabs: async () => ({ srsimcap: SRSIM_LAB })
    } as any);
  });

  for (const nodeName of ["dist", "clab-srsimcap-dist"]) {
    it(`captures in a container of the node when the canvas names it ${nodeName}`, async () => {
      const [call] = await interfaceEndpoint("clab-interface-capture", {
        nodeName,
        interfaceName: "1/1/c1/1"
      });

      expect(call.args[0]).to.include({
        parentName: "clab-srsimcap-dist-a",
        name: "clab-s-c3905c8d",
        alias: "1/1/c1/1",
        labName: "srsimcap"
      });
    });
  }

  it("keeps the sub-container the canvas names", async () => {
    const [call] = await interfaceEndpoint("clab-interface-capture", {
      nodeName: "clab-srsimcap-dist-1",
      interfaceName: "1/1/c1/1"
    });

    expect(call.args[0]).to.include({ parentName: "clab-srsimcap-dist-1", name: "clab-s-c3905c8d" });
  });

  it("captures ports inside the node in its CPM container, unresolved", async () => {
    const [call] = await interfaceEndpoint("clab-interface-capture", {
      nodeName: "dist",
      interfaceName: "eth0",
      interfaceNames: ["eth0", "e1-1-c1-1"],
      nodeNamespace: true
    });

    expect(
      call.args[1].map((iface: { parentName: string; name: string }) => [iface.parentName, iface.name])
    ).to.deep.equal([
      ["clab-srsimcap-dist-a", "eth0"],
      ["clab-srsimcap-dist-a", "e1-1-c1-1"]
    ]);
  });

  it("captures both ends of the link by their containers", async () => {
    const [call] = await interfaceEndpoint("clab-interface-capture", {
      nodeName: "dist",
      interfaceName: "1/1/c1/1",
      targets: [
        { nodeName: "dist", interfaceName: "1/1/c1/1" },
        { nodeName: "integ", interfaceName: "1/1/c1/1" }
      ]
    });

    expect(
      call.args[1].map((iface: { parentName: string; name: string }) => [iface.parentName, iface.name])
    ).to.deep.equal([
      ["clab-srsimcap-dist-a", "clab-s-c3905c8d"],
      ["clab-srsimcap-integ", "clab-s-3d65afcd"]
    ]);
  });

  it("sets link impairments on the node's container", async () => {
    const [call] = await interfaceEndpoint("clab-link-impairment", {
      nodeName: "dist",
      interfaceName: "1/1/c1/1",
      data: { delay: "10ms" }
    });

    expect(call.command).to.equal("containerlab.interface.setImpairment");
    expect(call.args[0]).to.include({ parentName: "clab-srsimcap-dist-a", name: "clab-s-c3905c8d" });
  });
});
