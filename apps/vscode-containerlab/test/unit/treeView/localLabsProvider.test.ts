/* global describe, it, after, beforeEach, afterEach */
/**
 * Unit tests for `LocalLabTreeDataProvider`.
 *
 * The provider scans the workspace for clab topology files and exposes them as
 * tree nodes. These tests stub the VS Code APIs so the provider can execute in
 * a plain Node.js environment.
 */
import Module from "module";
import path from "path";

import { expect } from "chai";
import sinon from "sinon";

// Stub the vscode module before importing the provider
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

import { LocalLabTreeDataProvider } from "../../../src/treeView/localLabsProvider";
import type { ClabLabTreeNode } from "../../../src/treeView/common";
import * as ins from "../../../src/treeView/inspector";
import * as globals from "../../../src/globals";
import * as labBackends from "../../../src/backend/labBackends";

const vscodeStub = require("../../helpers/vscode-stub");

const LAB_B = "/workspace/b/lab2.clab.yaml";
const LAB_A = "/workspace/a/lab1.clab.yml";

const noop = () => {};
const fileWatcherStub = {
  onDidCreate: noop,
  onDidDelete: noop,
  onDidChange: noop
};
function createFileWatcher() {
  return fileWatcherStub;
}
async function emptyFindFiles() {
  return [];
}
class EventEmitterStub {
  public event = noop;
  fire() {}
}

describe("LocalLabTreeDataProvider", () => {
  after(() => {
    (Module as any)._resolveFilename = originalResolve;
  });

  beforeEach(() => {
    vscodeStub.commands.executed.length = 0;
    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: "/workspace", path: "/workspace" } }];
    vscodeStub.workspace.createFileSystemWatcher = createFileWatcher;
    vscodeStub.workspace.findFiles = emptyFindFiles;
    vscodeStub.EventEmitter = EventEmitterStub as any;
    globals.setFavoriteLabs(new Set());
    globals.setExtensionContext({ globalState: { update: sinon.stub().resolves() } } as any);
    // Stub outputChannel with log methods
    globals.setOutputChannel({ debug: noop, info: noop, warn: noop, error: noop } as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  // When no topology files are present the provider should return `undefined`.
  it("returns undefined when no labs are discovered", async () => {
    sinon.stub(vscodeStub.workspace, "findFiles").resolves([]);
    const provider = new LocalLabTreeDataProvider();
    const nodes = await provider.getChildren(undefined);
    expect(nodes).to.be.undefined;
  });

  it("hides dot-prefixed lab files while keeping visible labs in dot-prefixed folders", async () => {
    sinon
      .stub(vscodeStub.workspace, "findFiles")
      .resolves([
        vscodeStub.Uri.file("/workspace/.state.clab.yaml"),
        vscodeStub.Uri.file("/workspace/.hidden.clab.yml"),
        vscodeStub.Uri.file("/workspace/nested/.state.clab.yaml"),
        vscodeStub.Uri.file("/workspace/visible.clab.yaml"),
        vscodeStub.Uri.file("/workspace/visible.clab.yml"),
        vscodeStub.Uri.file("/workspace/.clab/visible.clab.yml")
      ]);

    const provider = new LocalLabTreeDataProvider();
    const nodes = await provider.getChildren(undefined);

    expect(nodes!.map((node) => node.label)).to.deep.equal([
      "visible.clab.yaml",
      "visible.clab.yml",
      ".clab"
    ]);
    const children = await provider.getChildren(nodes![2]);
    expect(children!.map((node) => node.label)).to.deep.equal(["visible.clab.yml"]);
  });

  it("hides dot-prefixed lab files added by the file watcher", async () => {
    const onDidCreate = sinon.stub();
    sinon.stub(vscodeStub.workspace, "createFileSystemWatcher").returns({
      ...fileWatcherStub,
      onDidCreate
    });

    const provider = new LocalLabTreeDataProvider();
    expect(await provider.getChildren(undefined)).to.be.undefined;

    const createFile = onDidCreate.firstCall.args[0];
    createFile(vscodeStub.Uri.file("/workspace/.state.clab.yaml"));
    createFile(vscodeStub.Uri.file("/workspace/nested/.hidden.clab.yml"));
    expect(await provider.getChildren(undefined)).to.be.undefined;

    createFile(vscodeStub.Uri.file("/workspace/new.clab.yml"));
    const nodes = await provider.getChildren(undefined);
    expect(nodes!.map((node) => node.label)).to.deep.equal(["new.clab.yml"]);
  });

  it("hides dot-prefixed favorite lab files outside the workspace", async () => {
    globals.favoriteLabs.add("/outside/.state.clab.yaml");
    globals.favoriteLabs.add("/outside/.hidden.clab.yml");

    const provider = new LocalLabTreeDataProvider();
    expect(await provider.getChildren(undefined)).to.be.undefined;
  });

  // Labs that are currently running are listed by the running labs view instead.
  it("hides labs that are already deployed", async () => {
    sinon
      .stub(vscodeStub.workspace, "findFiles")
      .resolves([vscodeStub.Uri.file(LAB_B), vscodeStub.Uri.file(LAB_A)]);
    sinon.stub(ins, "labsOf").returns({ b: [{ Labels: { "clab-topo-file": LAB_B } }] } as any);

    const provider = new LocalLabTreeDataProvider();
    const nodes = await provider.getChildren(undefined);

    expect(nodes).to.have.lengthOf(1);
    const folder = nodes![0];
    expect(folder.label).to.equal("a");
    const children = await provider.getChildren(folder);
    expect(children).to.have.lengthOf(1);
    const node = children![0] as ClabLabTreeNode;
    expect(node.label).to.equal("lab1.clab.yml");
    expect(node.labPath.absolute).to.equal(LAB_A);
    expect(node.description).to.equal("a");
  });

  // A topology opened or run from a cluster's section runs on that cluster.
  it("lists topology files under each local host with that host's connection", async () => {
    sinon
      .stub(vscodeStub.workspace, "findFiles")
      .resolves([vscodeStub.Uri.file(LAB_B), vscodeStub.Uri.file(LAB_A)]);
    const cluster = { id: "kind", label: "kind", kind: "local", runtime: "c9s", kubeContext: "kind" };
    const local = { id: "local", label: "Local", kind: "local" };
    sinon.stub(labBackends, "getConnections").returns({
      grouped: true,
      list: () => [local, cluster],
      status: () => "connected",
      problem: () => undefined
    } as any);
    // LAB_B runs on the cluster, so only Local lists it as undeployed.
    sinon
      .stub(ins, "labsOf")
      .callsFake((id: string) =>
        id === "kind" ? ({ b: [{ Labels: { "clab-topo-file": LAB_B } }] } as any) : undefined
      );

    const provider = new LocalLabTreeDataProvider();
    const roots = (await provider.getChildren(undefined)) as any[];
    const labsUnder = async (root: any) => {
      const labs: ClabLabTreeNode[] = [];
      for (const folder of (await provider.getChildren(root)) ?? []) {
        expect((folder as any).connectionId).to.equal(root.connectionId);
        labs.push(...((await provider.getChildren(folder)) as ClabLabTreeNode[]));
      }
      return labs;
    };
    const localLabs = await labsUnder(roots[0]);
    const clusterLabs = await labsUnder(roots[1]);
    expect(localLabs.map((node) => [node.labPath.absolute, node.connectionId])).to.deep.equal([
      [LAB_A, "local"],
      [LAB_B, "local"]
    ]);
    expect(clusterLabs.map((node) => [node.labPath.absolute, node.connectionId])).to.deep.equal([
      [LAB_A, "kind"]
    ]);
    expect(clusterLabs[0].id).to.equal(`kind|lab:${LAB_A}`);
  });

  it("lists root-level labs before folders", async () => {
    sinon
      .stub(vscodeStub.workspace, "findFiles")
      .resolves([vscodeStub.Uri.file("/workspace/root.clab.yml"), vscodeStub.Uri.file(LAB_A)]);

    const provider = new LocalLabTreeDataProvider();
    const nodes = await provider.getChildren(undefined);

    expect(nodes).to.have.lengthOf(2);
    expect(nodes![0].label).to.equal("root.clab.yml");
    expect(nodes![1].label).to.equal("a");
  });

  it("lists favorite labs before other labs in the same folder", async () => {
    const alpha = "/workspace/a/alpha.clab.yml";
    const zulu = "/workspace/a/zulu.clab.yml";
    sinon
      .stub(vscodeStub.workspace, "findFiles")
      .resolves([vscodeStub.Uri.file(alpha), vscodeStub.Uri.file(zulu)]);
    globals.favoriteLabs.add(zulu);

    const provider = new LocalLabTreeDataProvider();
    const [folder] = (await provider.getChildren(undefined))!;
    const labs = (await provider.getChildren(folder)) as ClabLabTreeNode[];

    expect(labs.map((lab) => lab.labPath.absolute)).to.deep.equal([zulu, alpha]);
    expect(labs.map((lab) => lab.contextValue)).to.deep.equal([
      "containerlabLabUndeployedFavorite",
      "containerlabLabUndeployed"
    ]);
    expect(labs.map((lab) => lab.favorite)).to.deep.equal([true, false]);
  });

  it("keeps favorites that no longer exist and displays them", async () => {
    sinon.stub(vscodeStub.workspace, "findFiles").resolves([]);
    sinon.stub(require("fs"), "existsSync").returns(false);

    globals.favoriteLabs.add("/outside/lab.clab.yml");

    const provider = new LocalLabTreeDataProvider();
    const nodes = await provider.getChildren(undefined);

    expect(nodes).to.have.lengthOf(1);
    const favNode = nodes![0] as ClabLabTreeNode;
    expect(favNode.label).to.equal("lab.clab.yml");
    expect(favNode.favorite).to.be.true;
    expect(globals.favoriteLabs.size).to.equal(1);
  });

  it("filters labs by folder name including nested paths", async () => {
    sinon
      .stub(vscodeStub.workspace, "findFiles")
      .resolves([
        vscodeStub.Uri.file("/workspace/a/nested/lab1.clab.yml"),
        vscodeStub.Uri.file("/workspace/b/lab2.clab.yml")
      ]);

    const provider = new LocalLabTreeDataProvider();
    provider.setTreeFilter("nested");
    const rootNodes = await provider.getChildren(undefined);

    expect(rootNodes).to.have.lengthOf(1);
    const folderA = rootNodes![0];
    expect(folderA.label).to.equal("a");

    const nestedNodes = await provider.getChildren(folderA);
    expect(nestedNodes).to.have.lengthOf(1);
    const nestedFolder = nestedNodes![0];
    expect(nestedFolder.label).to.equal("nested");

    const labs = await provider.getChildren(nestedFolder);
    expect(labs).to.have.lengthOf(1);
    expect(labs![0].label).to.equal("lab1.clab.yml");
  });

  it("starts the file scan on prefetch and reuses it for the first listing", async () => {
    const findFiles = sinon
      .stub(vscodeStub.workspace, "findFiles")
      .resolves([vscodeStub.Uri.file("/workspace/root.clab.yml")]);

    const provider = new LocalLabTreeDataProvider();
    provider.prefetch();
    expect(findFiles.calledOnce).to.be.true;

    const nodes = await provider.getChildren(undefined);
    expect(nodes!.map((node) => node.label)).to.deep.equal(["root.clab.yml"]);
    expect(findFiles.calledOnce).to.be.true;
  });

  it("resolves each lab path once until files change", async () => {
    const onDidCreate = sinon.stub();
    sinon.stub(vscodeStub.workspace, "createFileSystemWatcher").returns({
      ...fileWatcherStub,
      onDidCreate
    });
    sinon
      .stub(vscodeStub.workspace, "findFiles")
      .resolves([
        vscodeStub.Uri.file("/workspace/a/lab1.clab.yml"),
        vscodeStub.Uri.file("/workspace/b/lab2.clab.yml")
      ]);
    const realpathSync = sinon.stub(require("fs"), "realpathSync").callsFake((p: unknown) => p);
    sinon.stub(require("fs"), "existsSync").returns(true);

    const provider = new LocalLabTreeDataProvider();
    const roots = (await provider.getChildren(undefined))!;
    for (const folder of roots) await provider.getChildren(folder);
    await provider.getChildren(undefined);
    expect(realpathSync.callCount).to.equal(2);

    onDidCreate.firstCall.args[0](vscodeStub.Uri.file("/workspace/c/lab3.clab.yml"));
    await provider.getChildren(undefined);
    expect(realpathSync.callCount).to.equal(5);
  });
});
