/* global describe, it, after */
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
  labsToRuntimeContainers
} from "../../../src/reactTopoViewer/extension/services/runtimeContainers";
import { ClabContainerTreeNode, ClabLabTreeNode } from "../../../src/treeView/common";
import { TreeItemCollapsibleState } from "../../helpers/vscode-stub";

describe("labsToRuntimeContainers", () => {
  after(() => {
    (Module as any)._resolveFilename = originalResolve;
  });

  it("passes the container status on, so the canvas can tell booting nodes apart", () => {
    const labPath = { absolute: "/labs/demo.clab.yml", relative: "demo.clab.yml" };
    const container = new ClabContainerTreeNode(
      "srl1",
      TreeItemCollapsibleState.None,
      "clab-demo-srl1",
      "srl1",
      "abc123",
      "running",
      "nokia_srlinux",
      "ghcr.io/nokia/srlinux",
      [],
      labPath,
      "172.20.20.2/24",
      undefined,
      undefined,
      undefined,
      "Up 4 seconds (health: starting)"
    );
    const lab = new ClabLabTreeNode(
      "demo",
      TreeItemCollapsibleState.Collapsed,
      labPath,
      "demo",
      "user",
      [container]
    );

    const runtime = labsToRuntimeContainers({ demo: lab });

    expect(runtime).to.have.length(1);
    expect(runtime[0].state).to.equal("running");
    expect(runtime[0].status).to.equal("Up 4 seconds (health: starting)");
  });
});
