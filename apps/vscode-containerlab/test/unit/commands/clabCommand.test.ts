/* global describe, it, before, after, beforeEach, afterEach */
/**
 * Tests covering the `ClabCommand` helper class.
 *
 * The suite verifies that lifecycle actions reach the lab backend with the
 * right target and options, and how errors are surfaced. The `vscode` module
 * and the lab backend are replaced so the tests run outside of the editor.
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

describe("ClabCommand", () => {
  let ClabCommand: any;
  let ClabLabTreeNode: any;
  let vscodeStub: any;
  let backendStub: any;
  let globals: any;

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
      return originalResolve.call(this, request, parent, isMain, options);
    };
    vscodeStub = require("../../helpers/vscode-stub");
    backendStub = require("../../helpers/labBackends-stub");
    globals = require("../../../src/globals");
    ClabCommand = require("../../../src/commands/clabCommand").ClabCommand;
    ClabLabTreeNode = require("../../../src/treeView/common").ClabLabTreeNode;
  });

  after(() => {
    (Module as any)._resolveFilename = originalResolve;
    clearModuleCache();
  });

  beforeEach(() => {
    backendStub.reset();
    globals.setOutputChannel(vscodeStub.window.createOutputChannel("test", { log: true }));
    vscodeStub.window.lastErrorMessage = "";
    vscodeStub.window.activeTextEditor = undefined;
    sinon.spy(vscodeStub.window, "showErrorMessage");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("streams the action from the backend for the node's topology", async () => {
    const node = new ClabLabTreeNode("lab", vscodeStub.TreeItemCollapsibleState.None, {
      absolute: "/home/user/lab.clab.yml",
      relative: "lab.clab.yml"
    });
    const lines: string[] = [];
    const onSuccess = sinon.spy(async () => {});
    backendStub.setLifecycleEvents([
      { type: "log", line: "12:00:00 INFO Creating lab", stream: "stdout" },
      { type: "done" }
    ]);
    const clab = new ClabCommand("deploy", node, undefined, onSuccess, undefined, (line: string) =>
      lines.push(line)
    );
    await clab.run({ cleanup: true, lifecycleOptions: { nodeFilter: ["r1"] } });

    expect(backendStub.calls).to.have.lengthOf(1);
    const [action, target, options] = backendStub.calls[0].args;
    expect(action).to.equal("deploy");
    expect(target).to.deep.equal({ labName: "", path: "/home/user/lab.clab.yml" });
    expect(options.cleanup).to.equal(true);
    expect(options.lifecycleOptions).to.deep.equal({ nodeFilter: ["r1"] });
    expect(options.signal).to.be.instanceOf(AbortSignal);
    expect(lines).to.deep.equal(["12:00:00 INFO Creating lab"]);
    expect(onSuccess.calledOnce).to.be.true;
  });

  it("reports an error event as a failure", async () => {
    const node = new ClabLabTreeNode("lab", vscodeStub.TreeItemCollapsibleState.None, {
      absolute: "/home/user/lab.clab.yml",
      relative: "lab.clab.yml"
    });
    const onFailure = sinon.spy(async () => {});
    backendStub.setLifecycleEvents([{ type: "error", error: "Failed to deploy lab 'lab': boom" }]);
    await new ClabCommand("deploy", node, undefined, undefined, onFailure).run();

    const msgSpy = vscodeStub.window.showErrorMessage as sinon.SinonSpy;
    expect(msgSpy.firstCall.args[0]).to.equal("Deploy failed: Failed to deploy lab 'lab': boom");
    expect(onFailure.calledOnce).to.be.true;
  });

  // Should report an error if neither a node nor an active editor is present.
  it("shows an error when no node or editor provided", async () => {
    const clab = new ClabCommand("deploy", undefined);
    await clab.run();

    const msgSpy = vscodeStub.window.showErrorMessage as sinon.SinonSpy;
    expect(msgSpy.calledOnceWith("No lab node or topology file selected")).to.be.true;
    expect(backendStub.calls).to.have.lengthOf(0);
  });

  // Should report an error when the labPath property is empty.
  it("shows an error when labPath is missing", async () => {
    const node = new ClabLabTreeNode("lab", vscodeStub.TreeItemCollapsibleState.None, {
      absolute: "",
      relative: ""
    });
    const clab = new ClabCommand("destroy", node);
    await clab.run();

    const msgSpy = vscodeStub.window.showErrorMessage as sinon.SinonSpy;
    expect(msgSpy.calledOnceWith('No labPath found for command "destroy".')).to.be.true;
    expect(backendStub.calls).to.have.lengthOf(0);
  });
});
