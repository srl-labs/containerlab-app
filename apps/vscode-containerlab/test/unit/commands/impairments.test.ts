/* global describe, it, before, after, beforeEach */
/**
 * Tests for `setImpairment`: impairments with values set netem, and clearing
 * every value resets netem instead of setting zeros.
 */
import Module from "module";
import path from "path";

import { expect } from "chai";

const originalResolve = (Module as any)._resolveFilename;

function clearModuleCache() {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes("vscode-containerlab") && !key.includes("node_modules")) {
      delete require.cache[key];
    }
  });
}

describe("setImpairment", () => {
  let setImpairment: any;
  let ClabInterfaceTreeNode: any;
  let vscodeStub: any;
  let backendStub: any;

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
    setImpairment = require("../../../src/commands/impairments").setImpairment;
    ClabInterfaceTreeNode = require("../../../src/treeView/common").ClabInterfaceTreeNode;
  });

  after(() => {
    (Module as any)._resolveFilename = originalResolve;
    clearModuleCache();
  });

  beforeEach(() => {
    backendStub.reset();
  });

  function iface() {
    return new ClabInterfaceTreeNode(
      "e1-1",
      vscodeStub.TreeItemCollapsibleState.None,
      "clab-demo-srl1",
      "abc",
      "e1-1",
      "veth",
      "",
      "aa:bb:cc:dd:ee:ff",
      9500,
      1,
      "up"
    );
  }

  it("sets the given values", async () => {
    await setImpairment(iface(), { delay: "10ms", jitter: "0ms", loss: "5%", rate: "", corruption: "0" });

    expect(backendStub.calls).to.deep.equal([
      {
        method: "netemSet",
        args: [
          {
            containerName: "clab-demo-srl1",
            interface: "e1-1",
            delay: "10ms",
            jitter: "0ms",
            loss: 5,
            corruption: 0
          }
        ]
      }
    ]);
  });

  it("resets netem when every value is cleared", async () => {
    await setImpairment(iface(), { delay: "0ms", jitter: "0ms", loss: "0%", rate: "0", corruption: "" });

    expect(backendStub.calls).to.deep.equal([
      { method: "netemReset", args: [{ containerName: "clab-demo-srl1", interface: "e1-1" }] }
    ]);
  });
});
