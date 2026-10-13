/* global describe, it, after, beforeEach */
import "../../helpers/clab-ui-esm";
/**
 * Tests for multi-interface Edgeshark captures.
 *
 * Edgeshark streams one network namespace per capture, so a selection that
 * mixes host-side link interfaces (clab-s-*) with a node's own interfaces
 * must open one capture per namespace.
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

import { setExtensionContext, setOutputChannel } from "../../../src/globals";
import {
  captureInterfaceWithPacketflix,
  captureNodeInterfaces
} from "../../../src/commands/capture";
import {
  ClabContainerGroupTreeNode,
  type ClabContainerTreeNode,
  type ClabInterfaceTreeNode
} from "../../../src/treeView/common";

const vscodeStub = require("../../helpers/vscode-stub");

interface PacketflixTarget {
  host: string;
  container: Record<string, unknown>;
  nif: string;
}

function parsePacketflixUri(uri: string): PacketflixTarget {
  const url = new URL(uri.replace(/^packetflix:/, ""));
  return {
    host: url.host,
    container: JSON.parse(url.searchParams.get("container") ?? "{}"),
    nif: url.searchParams.get("nif") ?? ""
  };
}

function iface(parentName: string, name: string, alias = ""): ClabInterfaceTreeNode {
  return { parentName, name, alias, cID: parentName, label: alias || name } as ClabInterfaceTreeNode;
}

describe("multi-interface Edgeshark capture", () => {
  const opened: string[] = [];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    opened.length = 0;
    setOutputChannel(vscodeStub.window.createOutputChannel("test", { log: true }));
    vscodeStub.Uri.parse = (value: string) => ({ toString: () => value });
    vscodeStub.env.openExternal = (uri: { toString(): string }) => {
      opened.push(uri.toString());
      return Promise.resolve(true);
    };
    globalThis.fetch = (async () => ({ ok: true })) as unknown as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    delete vscodeStub.Uri.parse;
    delete vscodeStub.env.openExternal;
  });

  it("captures a single SR-SIM link port in the host namespace", async () => {
    const port = iface("clab-capdist-sr1-a", "clab-s-6b26d4e7", "1/1/c1/1");

    await captureInterfaceWithPacketflix(port);

    expect(opened).to.have.length(1);
    const target = parsePacketflixUri(opened[0]);
    expect(target.container).to.deep.equal({
      "network-interfaces": ["clab-s-6b26d4e7"],
      name: "systemd(1)",
      prefix: ""
    });
    expect(target.nif).to.equal("clab-s-6b26d4e7");
  });

  it("streams several link ports of a node together in the host namespace", async () => {
    const ports = [
      iface("clab-capdist-sr1-a", "clab-s-6b26d4e7", "1/1/c1/1"),
      iface("clab-capdist-sr1-a", "clab-s-8b54dd8d", "2/1/c1/1")
    ];

    await captureInterfaceWithPacketflix(ports[0], ports);

    expect(opened).to.have.length(1);
    const target = parsePacketflixUri(opened[0]);
    expect(target.container).to.deep.equal({
      "network-interfaces": ["clab-s-6b26d4e7", "clab-s-8b54dd8d"],
      name: "systemd(1)",
      prefix: ""
    });
    expect(target.nif).to.equal("clab-s-6b26d4e7/clab-s-8b54dd8d");
  });

  it("captures the node's own interfaces by container name, without a made-up namespace", async () => {
    const ports = [iface("clab-demo-r1", "eth0"), iface("clab-demo-r1", "eth1")];

    await captureInterfaceWithPacketflix(ports[0], ports);

    expect(opened).to.have.length(1);
    expect(parsePacketflixUri(opened[0]).container).to.deep.equal({
      "network-interfaces": ["eth0", "eth1"],
      name: "clab-demo-r1",
      type: "docker"
    });
  });

  it("streams both host-side ends of a link together, though they belong to two nodes", async () => {
    const ends = [
      iface("clab-capui-sr1-a", "clab-s-f8b759fc", "1/1/c1/1"),
      iface("clab-capui-srl1", "clab-s-ee384f82", "e1-1")
    ];

    await captureInterfaceWithPacketflix(ends[0], ends);

    expect(opened).to.have.length(1);
    expect(parsePacketflixUri(opened[0]).container).to.deep.equal({
      "network-interfaces": ["clab-s-f8b759fc", "clab-s-ee384f82"],
      name: "systemd(1)",
      prefix: ""
    });
  });

  it("opens one capture per node for link ends inside the nodes", async () => {
    const ends = [iface("clab-capui-srl1", "e1-3"), iface("clab-capui-client2", "eth1")];

    await captureInterfaceWithPacketflix(ends[0], ends);

    expect(opened.map((uri) => parsePacketflixUri(uri).container.name)).to.deep.equal([
      "clab-capui-srl1",
      "clab-capui-client2"
    ]);
  });

  it("opens one capture per namespace when eth0 and link ports are mixed", async () => {
    const ports = [
      iface("clab-capdist-sr1-a", "eth0"),
      iface("clab-capdist-sr1-a", "clab-s-6b26d4e7", "1/1/c1/1"),
      iface("clab-capdist-sr1-a", "clab-s-9ded930f", "1/1/c2/1")
    ];

    await captureInterfaceWithPacketflix(ports[0], ports);

    expect(opened.map((uri) => parsePacketflixUri(uri).container)).to.deep.equal([
      { "network-interfaces": ["eth0"], name: "clab-capdist-sr1-a", type: "docker" },
      {
        "network-interfaces": ["clab-s-6b26d4e7", "clab-s-9ded930f"],
        name: "systemd(1)",
        prefix: ""
      }
    ]);
  });
});

describe("Capture Interfaces… from the explorer", () => {
  const opened: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalGetConfiguration = vscodeStub.workspace.getConfiguration;
  let offered: Array<{ label: string; description?: string; picked?: boolean }> = [];
  let modes: Array<{ label: string; description?: string; separate: boolean }> = [];
  let chooseSeparate = false;
  const stored = new Map<string, unknown>();

  // First call: the interface list, accepted with its preselection. Second: the open-as step.
  async function fakeShowQuickPick(items: any[], options: { canPickMany?: boolean }) {
    if (options.canPickMany === true) {
      offered = items;
      return items.filter((item) => item.picked);
    }
    modes = items;
    return items.find((item) => item.separate === chooseSeparate);
  }

  beforeEach(() => {
    opened.length = 0;
    offered = [];
    setOutputChannel(vscodeStub.window.createOutputChannel("test", { log: true }));
    vscodeStub.Uri.parse = (value: string) => ({ toString: () => value });
    vscodeStub.env.openExternal = (uri: { toString(): string }) => {
      opened.push(uri.toString());
      return Promise.resolve(true);
    };
    vscodeStub.workspace.getConfiguration = () => ({
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        key === "capture.preferredAction" ? ("Edgeshark" as T) : defaultValue
    });
    vscodeStub.window.showQuickPick = fakeShowQuickPick;
    chooseSeparate = false;
    modes = [];
    stored.clear();
    setExtensionContext({
      globalState: {
        get: (key: string, fallback?: unknown) => (stored.has(key) ? stored.get(key) : fallback),
        update: async (key: string, value: unknown) => void stored.set(key, value)
      }
    } as any);
    globalThis.fetch = (async () => ({ ok: true })) as unknown as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    vscodeStub.workspace.getConfiguration = originalGetConfiguration;
    delete vscodeStub.window.showQuickPick;
    delete vscodeStub.Uri.parse;
    delete vscodeStub.env.openExternal;
  });

  // A distributed SR-SIM node as `inspect --all --details` reports it: every
  // sub-container shares one network namespace and lists the same ports.
  function srsimGroup(): ClabContainerGroupTreeNode {
    const subContainer = (suffix: string) =>
      ({
        name: `clab-capture-sr1-${suffix}`,
        name_short: `sr1-${suffix}`,
        kind: "nokia_srsim",
        interfaces: [
          iface(`clab-capture-sr1-${suffix}`, "_nokia_fabric"),
          iface(`clab-capture-sr1-${suffix}`, "clab-s-681a8e9b", "1/1/c1/1"),
          iface(`clab-capture-sr1-${suffix}`, "clab-s-4c58f31b", "2/1/c1/1"),
          iface(`clab-capture-sr1-${suffix}`, "eth0")
        ].map((port) => Object.assign(port, { state: "up" }))
      }) as unknown as ClabContainerTreeNode;
    const group = new ClabContainerGroupTreeNode(
      "sr1",
      { absolute: "/labs/capture.clab.yml", relative: "capture.clab.yml" },
      ["1", "2", "a", "netns"].map(subContainer)
    );
    group.name = "clab-capture-sr1-a";
    group.kind = "nokia_srsim";
    return group;
  }

  it("lists a distributed node's ports once and captures them inside the node", async () => {
    await captureNodeInterfaces(srsimGroup());

    expect(offered.map((item) => [item.label, item.description, item.picked])).to.deep.equal([
      ["$(circle-filled) eth0", "management · up", false],
      ["$(circle-filled) 1/1/c1/1", "e1-1-c1-1 · up", true],
      ["$(circle-filled) 2/1/c1/1", "e2-1-c1-1 · up", true]
    ]);
    expect(opened.map((uri) => parsePacketflixUri(uri).container)).to.deep.equal([
      {
        "network-interfaces": ["e1-1-c1-1", "e2-1-c1-1"],
        name: "clab-capture-sr1-a",
        type: "docker"
      }
    ]);
  });

  it("asks how to open several interfaces, with one Wireshark first", async () => {
    await captureNodeInterfaces(srsimGroup());

    expect(modes.map((item) => [item.label, item.description])).to.deep.equal([
      ["$(layers) One Wireshark", "all 2 interfaces together"],
      ["$(multiple-windows) One Wireshark per interface", "2 separate windows"]
    ]);
  });

  it("opens one capture per interface when chosen, and offers it first next time", async () => {
    chooseSeparate = true;
    await captureNodeInterfaces(srsimGroup());

    expect(opened.map((uri) => parsePacketflixUri(uri).nif)).to.deep.equal([
      "e1-1-c1-1",
      "e2-1-c1-1"
    ]);
    expect(stored.get("containerlab.capture.separateSessions")).to.equal(true);

    await captureNodeInterfaces(srsimGroup());
    expect(modes[0].separate).to.equal(true);
  });
});
