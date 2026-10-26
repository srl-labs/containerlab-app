import assert from "node:assert/strict";
import test from "node:test";

import type { TopoViewerNodeAction } from "../../host";

import { buildEdgeContextMenu, buildNodeContextMenu } from "./contextMenuBuilders";
import type { ContextMenuItem } from "../context-menu/ContextMenu";
import { FREE_TEXT_NODE_TYPE } from "../../annotations/annotationNodeConverters";

type LinkCapture = Parameters<
  NonNullable<Parameters<typeof buildEdgeContextMenu>[0]["renderLinkCapturePanel"]>
>[0];

function buildDeployedNodeMenu(
  runtimeState?: "running" | "stopped" | "paused" | "undeployed",
  isEditMode = false
) {
  const actions: Array<{ action: TopoViewerNodeAction; nodeName: string }> = [];
  const items = buildNodeContextMenu({
    targetId: "srl1",
    targetNodeType: "topology-node",
    targetRuntimeState: runtimeState,
    isEditMode,
    isDeployed: true,
    isLocked: false,
    onNodeAction: (action, nodeName) => actions.push({ action, nodeName }),
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    showNodeInfo: () => {}
  });
  return { actions, items };
}

function itemById(items: ContextMenuItem[], id: string): ContextMenuItem {
  const item = items.find((candidate) => candidate.id === id);
  assert.ok(item, `missing context menu item ${id}`);
  return item;
}

test("deployed node context menu disables running-only actions for stopped nodes", () => {
  const { items } = buildDeployedNodeMenu("stopped");

  assert.equal(itemById(items, "start-node").disabled, undefined);
  assert.equal(itemById(items, "info-node").disabled, undefined);
  assert.equal(itemById(items, "stop-node").disabled, true);
  assert.equal(itemById(items, "restart-node").disabled, true);
  assert.equal(itemById(items, "ssh-node").disabled, true);
  assert.equal(itemById(items, "shell-node").disabled, true);
  assert.equal(itemById(items, "logs-node").disabled, true);
});

test("deployed node context menu keeps runtime actions enabled for running nodes", () => {
  const { items } = buildDeployedNodeMenu("running");

  assert.equal(itemById(items, "stop-node").disabled, false);
  assert.equal(itemById(items, "restart-node").disabled, false);
  assert.equal(itemById(items, "ssh-node").disabled, false);
  assert.equal(itemById(items, "shell-node").disabled, false);
  assert.equal(itemById(items, "logs-node").disabled, false);
});

test("deployed editable node context menu offers runtime and edit actions", () => {
  const { items } = buildDeployedNodeMenu("running", true);

  assert.equal(itemById(items, "ssh-node").disabled, false);
  assert.equal(itemById(items, "edit-node").disabled, false);
  assert.equal(itemById(items, "delete-node").disabled, false);
  assert.equal(itemById(items, "create-link").disabled, false);
  assert.equal(itemById(items, "info-node").disabled, undefined);
});

test("read-only view menus keep runtime actions when deployment state is unknown", () => {
  const nodeItems = buildNodeContextMenu({
    targetId: "srl1",
    targetNodeType: "topology-node",
    isEditMode: false,
    isDeployed: false,
    isLocked: true,
    onNodeAction: () => {},
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    showNodeInfo: () => {}
  });

  assert.notEqual(nodeItems.length, 0);
  assert.equal(itemById(nodeItems, "ssh-node").disabled, false);
  assert.equal(itemById(nodeItems, "info-node").disabled, undefined);
  assert.equal(nodeItems.find((item) => item.id === "edit-node"), undefined);

  const edgeItems = buildEdgeContextMenu({
    targetId: "edge-1",
    sourceNode: "srl1",
    targetNode: "srl2",
    sourceEndpoint: "e1-1",
    targetEndpoint: "e1-1",
    isEditMode: false,
    isDeployed: false,
    isLocked: true,
    closeContextMenu: () => {},
    editEdge: () => {},
    handleDeleteEdge: () => {}
  });

  assert.notEqual(edgeItems.length, 0);
  assert.equal(itemById(edgeItems, "info-edge").disabled, undefined);
  assert.equal(edgeItems.find((item) => item.id === "edit-edge"), undefined);
});

test("undeployed editable node context menu has no runtime actions", () => {
  const items = buildNodeContextMenu({
    targetId: "srl1",
    targetNodeType: "topology-node",
    isEditMode: true,
    isDeployed: false,
    isLocked: false,
    onNodeAction: () => {},
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    showNodeInfo: () => {}
  });

  assert.equal(items.find((item) => item.id === "ssh-node"), undefined);
  assert.equal(items.find((item) => item.id === "info-node"), undefined);
  assert.equal(itemById(items, "edit-node").disabled, false);
  assert.equal(itemById(items, "delete-node").disabled, false);
});

test("edge capture checklist shows topology names and captures in the runtime containers", () => {
  let link: LinkCapture | undefined;
  const items = buildEdgeContextMenu({
    targetId: "edge-1",
    sourceNode: "leaf1",
    targetNode: "leaf2",
    sourceEndpoint: "e1-1",
    targetEndpoint: "e1-50",
    extraData: {
      yamlSourceNodeId: "leaf1",
      yamlTargetNodeId: "leaf2",
      clabSourceLongName: '${LAB_PREFIX:-""}-srl-mirroring-lab-leaf1',
      clabTargetLongName: '${LAB_PREFIX:-""}-srl-mirroring-lab-leaf2'
    },
    isEditMode: false,
    isDeployed: true,
    isLocked: false,
    renderLinkCapturePanel: (params) => {
      link = params;
      return null;
    },
    closeContextMenu: () => {},
    editEdge: () => {},
    handleDeleteEdge: () => {}
  });

  const capture = itemById(items, "capture-link");
  assert.equal(capture.label, "Capture");
  assert.equal(capture.panel?.(() => {}), null);
  assert.deepEqual(link, {
    linkId: "edge-1",
    ends: [
      {
        id: "source",
        nodeId: "leaf1",
        captureName: '${LAB_PREFIX:-""}-srl-mirroring-lab-leaf1',
        displayName: "leaf1",
        endpoint: "e1-1"
      },
      {
        id: "target",
        nodeId: "leaf2",
        captureName: '${LAB_PREFIX:-""}-srl-mirroring-lab-leaf2',
        displayName: "leaf2",
        endpoint: "e1-50"
      }
    ]
  });
});

test("free text Edit Text prefers the drawer+inline handler and falls back to drawer-only", () => {
  const edited: string[] = [];
  const editedWithInline: string[] = [];
  const baseCtx = {
    targetId: "freeText_1",
    targetNodeType: FREE_TEXT_NODE_TYPE,
    isEditMode: true,
    isDeployed: false,
    isLocked: false,
    onNodeAction: () => {},
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    deleteFreeText: () => {},
    duplicateFreeText: () => {}
  };

  const withBoth = buildNodeContextMenu({
    ...baseCtx,
    editFreeText: (id) => edited.push(id),
    editFreeTextWithInline: (id) => editedWithInline.push(id)
  });
  itemById(withBoth, "edit-text").onClick?.();
  assert.deepEqual(editedWithInline, ["freeText_1"]);
  assert.equal(edited.length, 0);

  const withFallback = buildNodeContextMenu({
    ...baseCtx,
    editFreeText: (id) => edited.push(id)
  });
  itemById(withFallback, "edit-text").onClick?.();
  assert.deepEqual(edited, ["freeText_1"]);
});

test("free text context menu offers Duplicate Text that duplicates the target and closes", () => {
  const duplicated: string[] = [];
  let closes = 0;
  const items = buildNodeContextMenu({
    targetId: "freeText_1",
    targetNodeType: FREE_TEXT_NODE_TYPE,
    isEditMode: true,
    isDeployed: false,
    isLocked: false,
    onNodeAction: () => {},
    closeContextMenu: () => {
      closes += 1;
    },
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    editFreeText: () => {},
    deleteFreeText: () => {},
    duplicateFreeText: (id) => duplicated.push(id)
  });

  const duplicateItem = itemById(items, "duplicate-text");
  assert.equal(duplicateItem.label, "Duplicate Text");

  duplicateItem.onClick?.();
  assert.deepEqual(duplicated, ["freeText_1"]);
  assert.equal(closes, 1);
});

test("free text context menu hides Duplicate Text when locked", () => {
  const items = buildNodeContextMenu({
    targetId: "freeText_1",
    targetNodeType: FREE_TEXT_NODE_TYPE,
    isEditMode: true,
    isDeployed: false,
    isLocked: true,
    onNodeAction: () => {},
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    editFreeText: () => {},
    deleteFreeText: () => {},
    duplicateFreeText: () => {}
  });

  assert.equal(
    items.find((item) => item.id === "duplicate-text"),
    undefined
  );
});

function buildCaptureMenu(runtimeState?: "running" | "stopped") {
  const captured: string[] = [];
  const items = buildNodeContextMenu({
    targetId: "srl1",
    targetNodeType: "topology-node",
    targetRuntimeState: runtimeState,
    isEditMode: false,
    isDeployed: true,
    isLocked: false,
    onNodeAction: () => {},
    renderCapturePanel: (nodeId, close) => {
      captured.push(nodeId);
      close();
      return null;
    },
    closeContextMenu: () => {},
    editNode: () => {},
    handleDeleteNode: () => {}
  });
  return { captured, items };
}

test("deployed node context menu offers the interface checklist as a submenu", () => {
  const { captured, items } = buildCaptureMenu("running");
  const capture = itemById(items, "capture-node");
  let menuClosed = false;

  assert.equal(capture.label, "Capture");
  assert.equal(capture.disabled, false);
  assert.equal(capture.onClick, undefined);
  const panel = capture.panel?.(() => {
    menuClosed = true;
  });
  assert.equal(panel, null);
  assert.deepEqual(captured, ["srl1"]);
  assert.equal(menuClosed, true);
});

test("node capture needs a running container", () => {
  const { items } = buildCaptureMenu("stopped");

  assert.equal(itemById(items, "capture-node").disabled, true);
});

test("node context menu leaves capture out when the host offers no picker", () => {
  const { items } = buildDeployedNodeMenu("running");

  assert.equal(
    items.some((item) => item.id === "capture-node"),
    false
  );
});

function buildSelectionMenu(selectedNodeIds: string[], withNodesAction = true) {
  const single: Array<{ action: TopoViewerNodeAction; nodeName: string }> = [];
  const several: Array<{ action: string; nodeNames: string[] }> = [];
  const opened: Array<{ kind: string; nodeNames: string[] }> = [];
  const items = buildNodeContextMenu({
    targetId: "srl1",
    targetNodeType: "topology-node",
    targetRuntimeState: "stopped",
    isEditMode: false,
    isDeployed: true,
    isLocked: false,
    selectedNodeIds,
    onNodeAction: (action, nodeName) => single.push({ action, nodeName }),
    ...(withNodesAction
      ? { onNodesAction: (action: string, nodeNames: string[]) => several.push({ action, nodeNames }) }
      : {}),
    labOperations: {
      support: { execByLabel: true, snapshotSave: true, deployRestore: true, saveCopy: true, inspectDetails: false },
      open: (kind, nodeNames) => opened.push({ kind, nodeNames })
    },
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    showNodeInfo: () => {}
  });
  return { items, single, several, opened };
}

test("runtime actions act on the whole selection when it holds the target", () => {
  const { items, single, several, opened } = buildSelectionMenu(["srl1", "srl2", "srl3"]);

  const stop = itemById(items, "stop-node");
  assert.equal(stop.label, "Stop 3 Nodes");
  // The target is stopped, but the others may run.
  assert.equal(stop.disabled, false);
  stop.onClick?.();
  itemById(items, "exec-node").onClick?.();
  assert.equal(itemById(items, "exec-node").label, "Run Command on 3 Nodes…");
  assert.equal(itemById(items, "save-config-node").label, "Save 3 Configs…");
  assert.equal(items.some((item) => item.id === "details-node"), false);

  assert.deepEqual(single, []);
  assert.deepEqual(several, [{ action: "stop", nodeNames: ["srl1", "srl2", "srl3"] }]);
  assert.deepEqual(opened, [{ kind: "exec", nodeNames: ["srl1", "srl2", "srl3"] }]);
});

test("a selection without the target leaves runtime actions on the target", () => {
  const { items, single } = buildSelectionMenu(["srl2", "srl3"]);

  assert.equal(itemById(items, "start-node").label, "Start");
  assert.equal(itemById(items, "stop-node").disabled, true);
  itemById(items, "start-node").onClick?.();
  assert.deepEqual(single, [{ action: "start", nodeName: "srl1" }]);
});

test("node Files submenu opens the node's files, next to Edit Node or before Info", () => {
  const opened: string[] = [];
  const labFiles = {
    files: [
      { role: "startup-config" as const, request: { path: "configs/srl1.cfg", create: true } },
      { role: "bind" as const, request: { path: "certs/ca.pem", create: true } }
    ],
    open: (request: { path: string }) => opened.push(request.path)
  };
  const ctx = {
    targetId: "srl1",
    targetNodeType: "topology-node",
    isDeployed: false,
    isLocked: true,
    onNodeAction: () => {},
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    labFiles
  };

  const editItems = buildNodeContextMenu({ ...ctx, isEditMode: true });
  const ids = editItems.map((item) => item.id);
  assert.equal(ids.indexOf("files-node"), ids.indexOf("edit-node") + 1);
  const files = itemById(editItems, "files-node");
  assert.deepEqual(
    files.children?.map((child) => child.label),
    ["configs/srl1.cfg", "certs/ca.pem"]
  );
  itemById(files.children ?? [], "files-node-1").onClick?.();
  assert.deepEqual(opened, ["certs/ca.pem"]);

  const viewItems = buildNodeContextMenu({ ...ctx, isEditMode: false });
  const viewIds = viewItems.map((item) => item.id);
  assert.equal(viewIds.indexOf("files-node"), viewIds.indexOf("info-node") - 1);

  const noFiles = buildNodeContextMenu({
    ...ctx,
    isEditMode: true,
    labFiles: { ...labFiles, files: [] }
  });
  assert.equal(noFiles.some((item) => item.id === "files-node"), false);
});

test("annotation menus arrange the annotation and show their shortcuts", () => {
  const changes: Array<[string, string]> = [];
  const base = {
    isDeployed: true,
    onNodeAction: () => {},
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    changeZOrder: (id: string, action: string) => changes.push([id, action])
  };
  const items = buildNodeContextMenu({
    ...base,
    targetId: "freeText_1",
    targetNodeType: FREE_TEXT_NODE_TYPE,
    isEditMode: false,
    isLocked: false,
    editFreeText: () => {},
    deleteFreeText: () => {},
    duplicateFreeText: () => {}
  });

  assert.equal(itemById(items, "duplicate-text").shortcut, "Ctrl+D");
  assert.equal(itemById(items, "delete-text").shortcut, "Del");
  assert.equal(itemById(items, "bring-to-front").shortcut, "Ctrl+Shift+]");
  assert.equal(itemById(items, "send-backward").shortcut, "Ctrl+[");
  itemById(items, "bring-to-front").onClick?.();
  itemById(items, "send-to-back").onClick?.();
  assert.deepEqual(changes, [
    ["freeText_1", "front"],
    ["freeText_1", "back"]
  ]);

  const locked = buildNodeContextMenu({
    ...base,
    targetId: "freeShape_1",
    targetNodeType: "free-shape-node",
    isEditMode: true,
    isLocked: true
  });
  assert.equal(locked.some((item) => item.id === "bring-to-front"), false);
});

test("hosts without multi-node actions get one call per node", () => {
  const { items, single } = buildSelectionMenu(["srl1", "srl2"], false);

  itemById(items, "restart-node").onClick?.();
  assert.deepEqual(single, [
    { action: "restart", nodeName: "srl1" },
    { action: "restart", nodeName: "srl2" }
  ]);
});
