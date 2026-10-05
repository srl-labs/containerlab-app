/* global describe, it, before, after, afterEach */
import "../../helpers/clab-ui-esm";

import Module from "module";
import path from "path";

import { expect } from "chai";
import sinon from "sinon";
import type * as vscode from "vscode";
import {
  createWindowClabUiHost,
  type ClabUiHost,
  type ClabUiTopoViewerEvent,
  type TopoViewerLifecycleAction,
  type TopoViewerNodeAction
} from "@containerlab/clab-ui/host";
import {
  INTERFACE_COMMANDS,
  NODE_COMMANDS,
  TOPOLOGY_HOST_PROTOCOL_VERSION,
  type CustomIconInfo,
  type TopologyHost,
  type TopologyHostResponseMessage,
  type TopologySnapshot
} from "@containerlab/clab-ui/session";

import type * as RouterModule from "../../../src/reactTopoViewer/extension/panel/MessageRouter";
import type * as LifecycleModule from "../../../src/reactTopoViewer/extension/services/LabLifecycleService";
import type * as NodeModule from "../../../src/reactTopoViewer/extension/services/NodeCommandService";
import type * as CustomModule from "../../../src/reactTopoViewer/extension/services/CustomNodeConfigManager";
import type * as IconModule from "../../../src/reactTopoViewer/extension/services/IconService";
import type { SplitViewManager } from "../../../src/reactTopoViewer/extension/services/SplitViewManager";

type ModuleWithResolve = typeof Module & { _resolveFilename: Function };

const moduleWithResolve = Module as unknown as ModuleWithResolve;
const originalResolve = moduleWithResolve._resolveFilename;
const EXTENSION_SRC = "../../../src/reactTopoViewer/extension";
const YAML_PATH = "/labs/demo.clab.yml";

const SNAPSHOT: TopologySnapshot = {
  revision: 4,
  nodes: [],
  edges: [],
  annotations: {},
  yamlFileName: "demo.clab.yml",
  annotationsFileName: "demo.clab.yml.annotations.json",
  yamlContent: "name: demo\n",
  annotationsContent: "{}",
  labName: "demo",
  mode: "edit",
  deploymentState: "undeployed",
  canUndo: true,
  canRedo: false
};

// Every action the webview host can send; `satisfies` keeps these in step with clab-ui.
const LIFECYCLE_ACTIONS = Object.keys({
  deployLab: true,
  deployLabCleanup: true,
  destroyLab: true,
  destroyLabCleanup: true,
  redeployLab: true,
  redeployLabCleanup: true,
  applyLab: true,
  startLab: true,
  stopLab: true,
  restartLab: true
} satisfies Record<TopoViewerLifecycleAction, true>) as TopoViewerLifecycleAction[];
const NODE_ACTIONS = Object.keys({
  ssh: true,
  shell: true,
  logs: true,
  start: true,
  stop: true,
  restart: true
} satisfies Record<TopoViewerNodeAction, true>) as TopoViewerNodeAction[];

let MessageRouter: typeof RouterModule.MessageRouter;
let labLifecycleService: typeof LifecycleModule.labLifecycleService;
let nodeCommandService: typeof NodeModule.nodeCommandService;
let customNodeConfigManager: typeof CustomModule.customNodeConfigManager;
let iconService: typeof IconModule.iconService;

interface WebviewHarness {
  host: ClabUiHost;
  panel: vscode.WebviewPanel;
  sent: Record<string, unknown>[];
  events: ClabUiTopoViewerEvent[];
  topologyHost: { getSnapshot: sinon.SinonStub; applyCommand: sinon.SinonStub };
  toggleSplitView: sinon.SinonStub;
  onHostSnapshot: sinon.SinonSpy;
  settle: () => Promise<void>;
}

/**
 * Connects the real clab-ui webview host to a MessageRouter the way a VS Code
 * webview panel does: messages are structured-cloned in both directions.
 */
function connectWebview(): WebviewHarness {
  const webviewWindow = new EventTarget();
  const inFlight: Promise<void>[] = [];
  const sent: Record<string, unknown>[] = [];
  const events: ClabUiTopoViewerEvent[] = [];
  const topologyHost = {
    getSnapshot: sinon.stub().resolves(SNAPSHOT),
    applyCommand: sinon.stub()
  };
  const toggleSplitView = sinon.stub().resolves(true);
  const onHostSnapshot = sinon.spy();
  const panel = {
    webview: {
      postMessage: async (message: unknown) => {
        webviewWindow.dispatchEvent(
          new MessageEvent("message", { data: structuredClone(message) })
        );
        return true;
      }
    }
  } as unknown as vscode.WebviewPanel;

  const router = new MessageRouter({
    yamlFilePath: YAML_PATH,
    splitViewManager: { toggleSplitView } as unknown as SplitViewManager,
    topologyHost: topologyHost as unknown as TopologyHost,
    setInternalUpdate: () => {},
    onHostSnapshot
  });

  const host = createWindowClabUiHost({
    targetWindow: webviewWindow as unknown as Window,
    vscodeApi: {
      postMessage(message: unknown) {
        const delivered = structuredClone(message) as Record<string, unknown>;
        sent.push(delivered);
        inFlight.push(router.handleMessage(delivered, panel));
      }
    }
  });
  host.topoViewer.subscribe((event) => events.push(event));

  return {
    host,
    panel,
    sent,
    events,
    topologyHost,
    toggleSplitView,
    onHostSnapshot,
    settle: async () => {
      await Promise.all(inFlight.splice(0));
    }
  };
}

describe("MessageRouter with the clab-ui webview host", () => {
  before(() => {
    moduleWithResolve._resolveFilename = function (
      request: string,
      parent: unknown,
      isMain: boolean,
      options: unknown
    ) {
      if (request === "vscode") {
        return path.join(__dirname, "..", "..", "helpers", "vscode-stub.js");
      }
      return originalResolve.call(this, request, parent, isMain, options);
    };

    const load = (modulePath: string): unknown => require(`${EXTENSION_SRC}/${modulePath}`);
    ({ MessageRouter } = load("panel/MessageRouter") as typeof RouterModule);
    ({ labLifecycleService } = load("services/LabLifecycleService") as typeof LifecycleModule);
    ({ nodeCommandService } = load("services/NodeCommandService") as typeof NodeModule);
    ({ customNodeConfigManager } = load("services/CustomNodeConfigManager") as typeof CustomModule);
    ({ iconService } = load("services/IconService") as typeof IconModule);
  });

  after(() => {
    moduleWithResolve._resolveFilename = originalResolve;
  });

  afterEach(() => {
    sinon.restore();
  });

  it("serves the webview's initial snapshot request from the topology host", async () => {
    const webview = connectWebview();

    const snapshot = await webview.host.topology.requestSnapshot({});

    expect(snapshot).to.deep.equal(SNAPSHOT);
    expect(webview.topologyHost.getSnapshot.calledOnce).to.equal(true);
    expect(webview.onHostSnapshot.calledOnceWithExactly(SNAPSHOT)).to.equal(true);
  });

  for (const command of ["undo", "redo"] as const) {
    it(`forwards payload-less '${command}' with the webview's base revision`, async () => {
      const webview = connectWebview();
      const ack: TopologyHostResponseMessage = {
        type: "topology-host:ack",
        protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
        requestId: "",
        revision: 8
      };
      webview.topologyHost.applyCommand.resolves(ack);

      const response = await webview.host.topology.dispatchCommand({}, 7, { command });

      expect(webview.topologyHost.applyCommand.calledOnceWithExactly({ command }, 7)).to.equal(
        true
      );
      expect(response).to.deep.equal({ ...ack, requestId: webview.sent[0].requestId });
    });
  }

  it("shows a single error modal when the topology files cannot be read", async () => {
    const vscodeStub = require("../../helpers/vscode-stub");
    const showErrorMessage = sinon.stub(vscodeStub.window, "showErrorMessage");
    const webview = connectWebview();
    webview.topologyHost.getSnapshot.rejects(new Error("EACCES: permission denied"));

    const outcome = () =>
      webview.host.topology.requestSnapshot({}).then(
        () => "resolved",
        () => "rejected"
      );

    expect([await outcome(), await outcome()]).to.deep.equal(["rejected", "rejected"]);
    expect(webview.onHostSnapshot.notCalled).to.equal(true);
    expect(showErrorMessage.calledOnce).to.equal(true);
    expect(showErrorMessage.firstCall.args[0])
      .to.contain(YAML_PATH)
      .and.to.contain("EACCES: permission denied");
    expect(showErrorMessage.firstCall.args[1]).to.deep.equal({ modal: true });
  });

  it("routes every webview lifecycle, node and interface action to the extension services", async () => {
    const lifecycle = sinon
      .stub(labLifecycleService, "handleLabLifecycleEndpoint")
      .resolves({ result: null, error: null });
    const nodeEndpoint = sinon
      .stub(nodeCommandService, "handleNodeEndpoint")
      .resolves({ result: null, error: null });
    const interfaceEndpoint = sinon
      .stub(nodeCommandService, "handleInterfaceEndpoint")
      .resolves({ result: null, error: null });
    const webview = connectWebview();

    LIFECYCLE_ACTIONS.forEach((action) => webview.host.topoViewer.runLifecycle(action));
    NODE_ACTIONS.forEach((action) => webview.host.topoViewer.runNodeAction(action, "r1"));
    webview.host.topoViewer.captureInterface("r1", "e1-1");
    await webview.settle();

    expect(lifecycle.args).to.deep.equal(LIFECYCLE_ACTIONS.map((action) => [action, YAML_PATH]));
    expect(nodeEndpoint.args.map(([command]) => command)).to.have.members(
      Object.values(NODE_COMMANDS)
    );
    expect(
      nodeEndpoint.args.every(([, node, yaml]) => node === "r1" && yaml === YAML_PATH)
    ).to.equal(true);
    expect(
      interfaceEndpoint.calledOnceWithExactly(
        INTERFACE_COMMANDS.INTERFACE_CAPTURE,
        { nodeName: "r1", interfaceName: "e1-1", data: undefined },
        YAML_PATH
      )
    ).to.equal(true);
  });

  it("toggles the split view for the panel's topology file", async () => {
    const webview = connectWebview();

    webview.host.topoViewer.toggleSplitView();
    await webview.settle();

    expect(webview.toggleSplitView.calledOnceWithExactly(YAML_PATH, webview.panel)).to.equal(true);
  });

  it("reports a cancel request without a running lifecycle command as an error", async () => {
    const webview = connectWebview();

    webview.host.topoViewer.cancelLifecycle();
    await webview.settle();

    expect(webview.events).to.deep.equal([
      {
        type: "lifecycleStatus",
        status: "error",
        errorMessage: "No active lifecycle command to cancel."
      }
    ]);
  });

  it("saves custom node templates and publishes the result to the webview", async () => {
    const template = { name: "srl", kind: "nokia_srlinux", type: "ixr-d2l" };
    const saveCustomNode = sinon
      .stub(customNodeConfigManager, "saveCustomNode")
      .resolves({ result: { customNodes: [template], defaultNode: "srl" }, error: null });
    const deleteCustomNode = sinon
      .stub(customNodeConfigManager, "deleteCustomNode")
      .resolves({ result: null, error: "Custom node ghost not found" });
    const webview = connectWebview();

    webview.host.topoViewer.saveCustomNode(template);
    webview.host.topoViewer.deleteCustomNode("ghost");
    await webview.settle();

    expect(saveCustomNode.calledOnceWithExactly(template)).to.equal(true);
    expect(deleteCustomNode.calledOnceWithExactly("ghost")).to.equal(true);
    expect(webview.events).to.deep.equal([
      { type: "customNodesUpdated", customNodes: [template], defaultNode: "srl" },
      { type: "customNodeError", error: "Custom node ghost not found" }
    ]);
  });

  it("answers icon list requests with the icons available to the topology", async () => {
    const icons: CustomIconInfo[] = [
      { name: "router-blue", source: "global", dataUri: "data:image/svg+xml,", format: "svg" }
    ];
    const loadAllIcons = sinon.stub(iconService, "loadAllIcons").resolves(icons);
    const webview = connectWebview();

    webview.host.topoViewer.requestIconList();
    await webview.settle();

    expect(loadAllIcons.calledOnceWithExactly(YAML_PATH)).to.equal(true);
    expect(webview.events).to.deep.equal([{ type: "iconList", icons }]);
  });
});
