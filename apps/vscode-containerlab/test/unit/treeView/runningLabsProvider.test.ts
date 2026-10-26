/* global describe, it, before, after, beforeEach, afterEach */
/**
 * Unit tests for `RunningLabTreeDataProvider` refreshes.
 *
 * Interface traffic counters arrive every second; the views do not show them,
 * so a soft refresh that only sees new counters must not redraw the tree.
 */
import Module from "module";
import path from "path";

import { expect } from "chai";
import sinon from "sinon";

const originalResolve = (Module as any)._resolveFilename;

function clearModuleCache() {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes("vscode-containerlab") && !key.includes("node_modules")) {
      delete require.cache[key];
    }
  });
}

const noop = () => {};

function container(state: string) {
  return {
    Names: ["clab-demo-srl1"],
    ID: "abc123456789",
    ShortID: "abc123456789",
    Image: "srlinux",
    State: state,
    Status: state === "running" ? "Up" : "Exited",
    Labels: {
      "clab-node-kind": "nokia_srlinux",
      "clab-node-lab-dir": "/labs/clab-demo",
      "clab-node-longname": "clab-demo-srl1",
      "clab-node-name": "srl1",
      "clab-owner": "tester",
      "clab-topo-file": "/labs/demo.clab.yml"
    },
    NetworkSettings: {},
    Mounts: [],
    Ports: []
  };
}

function interfaces(rxBps: number) {
  return [
    {
      name: "clab-demo-srl1",
      interfaces: [
        {
          name: "e1-1",
          type: "veth",
          state: "up",
          alias: "",
          mac: "aa:bb",
          mtu: 9500,
          ifindex: 2,
          rxBps
        }
      ]
    }
  ];
}

describe("RunningLabTreeDataProvider", () => {
  let RunningLabTreeDataProvider: any;
  let ins: any;
  let globals: any;
  let originalUri: unknown;

  /** A Uri class, since the provider compares icons with `instanceof vscode.Uri`. */
  class UriStub {
    constructor(public fsPath: string) {}
    static file(p: string) {
      return new UriStub(p);
    }
    toString() {
      return `file://${this.fsPath}`;
    }
  }

  before(() => {
    clearModuleCache();
    (Module as any)._resolveFilename = function (
      request: string,
      parent: any,
      isMain: boolean,
      options: any
    ) {
      if (request === "vscode") {
        return path.join(__dirname, "..", "..", "helpers", "vscode-stub.js");
      }
      if (request.endsWith("/backend/labBackends")) {
        return path.join(__dirname, "..", "..", "helpers", "labBackends-stub.js");
      }
      if (request.endsWith("/commands/graph")) {
        return path.join(__dirname, "..", "..", "helpers", "graph-stub.js");
      }
      return originalResolve.call(this, request, parent, isMain, options);
    };
    const vscodeStub = require("../../helpers/vscode-stub");
    originalUri = vscodeStub.Uri;
    vscodeStub.Uri = UriStub;
    globals = require("../../../src/globals");
    ins = require("../../../src/treeView/inspector");
    ({ RunningLabTreeDataProvider } = require("../../../src/treeView/runningLabsProvider"));
  });

  after(() => {
    require("../../helpers/vscode-stub").Uri = originalUri;
    (Module as any)._resolveFilename = originalResolve;
    clearModuleCache();
  });

  beforeEach(() => {
    const vscodeStub = require("../../helpers/vscode-stub");
    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: "/labs", path: "/labs" } }];
    globals.setOutputChannel({ debug: noop, info: noop, warn: noop, error: noop } as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  function createProvider() {
    const context = { asAbsolutePath: (p: string) => path.join("/ext", p) };
    const provider = new RunningLabTreeDataProvider(context);
    let fired = 0;
    provider.onDidChangeTreeData(() => {
      fired += 1;
    });
    return { provider, fired: () => fired };
  }

  it("does not redraw for traffic counters alone", async () => {
    sinon.stub(ins, "allLabs").returns(new Map([["local", { demo: [container("running")] }]]));
    const snapshot = sinon.stub(ins, "getInterfacesSnapshot").returns(interfaces(100));
    const { provider, fired } = createProvider();

    await provider.softRefresh();
    expect(fired()).to.equal(1);

    snapshot.returns(interfaces(200));
    await provider.softRefresh();
    expect(fired()).to.equal(1);

    const [lab] = await provider.getChildren();
    const [node] = await provider.getChildren(lab);
    const [iface] = await provider.getChildren(node);
    expect(iface.stats).to.deep.equal({ rxBps: 200 });
  });

  it("redraws when a node changes state", async () => {
    const labs = sinon
      .stub(ins, "allLabs")
      .returns(new Map([["local", { demo: [container("running")] }]]));
    sinon.stub(ins, "getInterfacesSnapshot").returns(interfaces(100));
    const { provider, fired } = createProvider();

    await provider.softRefresh();
    labs.returns(new Map([["local", { demo: [container("exited")] }]]));
    await provider.softRefresh();
    expect(fired()).to.equal(2);
  });

  it("always redraws on a full refresh", async () => {
    sinon.stub(ins, "update").resolves();
    sinon.stub(ins, "allLabs").returns(new Map([["local", { demo: [container("running")] }]]));
    sinon.stub(ins, "getInterfacesSnapshot").returns(interfaces(100));
    const { provider, fired } = createProvider();

    await provider.refresh();
    await provider.refresh();
    expect(fired()).to.equal(2);
  });
});
