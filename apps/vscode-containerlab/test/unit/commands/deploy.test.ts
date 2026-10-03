/* global describe, it, before, after, beforeEach, afterEach */
/**
 * Tests for the `deploy` command.
 *
 * The suite verifies that a {@link ClabCommand} instance receives the
 * correct arguments when deploying a topology. By stubbing the `vscode`
 * module and the command implementation we can exercise the logic in a
 * plain Node environment without invoking containerlab.
 */
import Module from "module";
import path from "path";

import { expect } from "chai";
import sinon from "sinon";

const originalResolve = (Module as any)._resolveFilename;

// Helper to clear module cache for all vscode-containerlab modules
function clearModuleCache() {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes("vscode-containerlab") && !key.includes("node_modules")) {
      delete require.cache[key];
    }
  });
}

// Helper to resolve stub paths for module interception
function getStubPath(request: string): string | null {
  if (request === "vscode") {
    return path.join(__dirname, "..", "..", "helpers", "vscode-stub.js");
  }
  if (request.includes("clabCommand") && !request.includes("stub")) {
    return path.join(__dirname, "..", "..", "helpers", "clabCommand-stub.js");
  }
  if (request.includes("utils") && !request.includes("stub")) {
    return path.join(__dirname, "..", "..", "helpers", "utils-stub.js");
  }
  if ((request === "./graph" || request.endsWith("/graph")) && !request.includes("stub")) {
    return path.join(__dirname, "..", "..", "helpers", "graph-stub.js");
  }
  return null;
}

describe("deploy command", () => {
  let deploy: Function;
  let clabStub: any;
  let graphStub: any;

  before(() => {
    clearModuleCache();

    (Module as any)._resolveFilename = function (
      request: string,
      parent: any,
      isMain: boolean,
      options: any
    ) {
      const stubPath = getStubPath(request);
      if (stubPath !== null) {
        return stubPath;
      }
      return originalResolve.call(this, request, parent, isMain, options);
    };

    clabStub = require("../../helpers/clabCommand-stub");
    graphStub = require("../../helpers/graph-stub");
    const deployModule = require("../../../src/commands/deploy");
    deploy = deployModule.deploy;
  });

  after(() => {
    (Module as any)._resolveFilename = originalResolve;
    clearModuleCache();
  });

  beforeEach(() => {
    clabStub.instances.length = 0;
    graphStub.createdHandlers.length = 0;
    sinon.spy(clabStub.ClabCommand.prototype, "run");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("runs containerlab deploy for the node with TopoViewer lifecycle handlers", async () => {
    const node = { labPath: { absolute: "/home/user/lab.yml" } } as any;
    await deploy(node);

    expect(clabStub.instances).to.have.lengthOf(1);
    const [action, commandNode, , , , onSuccess, onFailure, onOutputLine] =
      clabStub.instances[0].args;
    expect(action).to.equal("deploy");
    expect(commandNode).to.equal(node);

    expect(graphStub.createdHandlers).to.have.lengthOf(1);
    const { commandType, handlers } = graphStub.createdHandlers[0];
    expect(commandType).to.equal("deploy");
    expect(onSuccess).to.equal(handlers.onSuccess);
    expect(onFailure).to.equal(handlers.onFailure);
    expect(onOutputLine).to.equal(handlers.onOutputLine);

    const spy = clabStub.ClabCommand.prototype.run as sinon.SinonSpy;
    expect(spy.calledOnceWithExactly()).to.be.true;
  });
});
