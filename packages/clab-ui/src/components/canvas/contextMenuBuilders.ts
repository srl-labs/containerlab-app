// Context menu item builders for ReactFlowCanvas.
import React from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import AddIcon from "@mui/icons-material/Add";
import ArticleIcon from "@mui/icons-material/Article";
import CategoryIcon from "@mui/icons-material/Category";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import DashboardIcon from "@mui/icons-material/Dashboard";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import InfoIcon from "@mui/icons-material/Info";
import LanIcon from "@mui/icons-material/Lan";
import LayersIcon from "@mui/icons-material/Layers";
import LinkIcon from "@mui/icons-material/Link";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RemoveIcon from "@mui/icons-material/Remove";
import ReplayIcon from "@mui/icons-material/Replay";
import SpeedIcon from "@mui/icons-material/Speed";
import StopIcon from "@mui/icons-material/Stop";
import TerminalIcon from "@mui/icons-material/Terminal";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import TuneIcon from "@mui/icons-material/Tune";

import type { ContextMenuItem } from "../context-menu/ContextMenu";
import { WiresharkIcon } from "../context-menu/WiresharkIcon";
import type { TopoViewerNodeAction } from "../../host";
import { getViewportCenter } from "../../utils/viewportUtils";
import {
  FREE_TEXT_NODE_TYPE,
  FREE_SHAPE_NODE_TYPE,
  TRAFFIC_RATE_NODE_TYPE,
  GROUP_NODE_TYPE
} from "../../annotations/annotationNodeConverters";

import type { ReactFlowCanvasProps } from "./types";

const DIVIDER_ID = "divider-1";
type NodeRuntimeActionState = "running" | "stopped" | "paused" | "undeployed";

interface MenuBuilderContext {
  targetId: string;
  targetNodeType?: string;
  targetRuntimeState?: NodeRuntimeActionState;
  isEditMode: boolean;
  /** Whether the lab is deployed, i.e. runtime node/interface actions apply. */
  isDeployed: boolean;
  isLocked: boolean;
  onNodeAction: (action: TopoViewerNodeAction, nodeName: string) => void;
  closeContextMenu: () => void;
  editNode: (id: string) => void;
  editNetwork?: (id: string) => void;
  handleDeleteNode: (id: string) => void;
  showNodeInfo?: (id: string) => void;
  /** Node ID that link creation started from (if in link creation mode) */
  linkSourceNode?: string | null;
  /** Start link creation from this node */
  startLinkCreation?: (nodeId: string) => void;
  /** Cancel link creation mode */
  cancelLinkCreation?: () => void;
  /** Edit free text annotation (style drawer only) */
  editFreeText?: (id: string) => void;
  /** Edit free text annotation: style drawer plus inline canvas editor */
  editFreeTextWithInline?: (id: string) => void;
  /** Edit free shape annotation */
  editFreeShape?: (id: string) => void;
  /** Delete free text annotation */
  deleteFreeText?: (id: string) => void;
  /** Duplicate free text annotation */
  duplicateFreeText?: (id: string) => void;
  /** Delete free shape annotation */
  deleteFreeShape?: (id: string) => void;
  /** Edit group annotation */
  editGroup?: (id: string) => void;
  /** Delete group annotation */
  deleteGroup?: (id: string) => void;
  /** Edit traffic-rate annotation */
  editTrafficRate?: (id: string) => void;
  /** Delete traffic-rate annotation */
  deleteTrafficRate?: (id: string) => void;
}

interface EdgeMenuBuilderContext {
  targetId: string;
  sourceNode?: string;
  targetNode?: string;
  sourceEndpoint?: string;
  targetEndpoint?: string;
  extraData?: Record<string, unknown>;
  isEditMode: boolean;
  /** Whether the lab is deployed, i.e. capture/impairment actions apply. */
  isDeployed: boolean;
  isLocked: boolean;
  onInterfaceCapture: (nodeName: string, interfaceName: string) => void;
  closeContextMenu: () => void;
  editEdge: (id: string) => void;
  handleDeleteEdge: (id: string) => void;
  showLinkInfo?: (id: string) => void;
  showLinkImpairment?: (id: string) => void;
}

type PaneMenuActions = Pick<
  ReactFlowCanvasProps,
  | "onOpenNodePalette"
  | "onAddGroup"
  | "onAddText"
  | "onAddTextAtPosition"
  | "onAddShapes"
  | "onAddShapeAtPosition"
  | "onAddTrafficRateAtPosition"
>;

interface PaneMenuBuilderContext extends PaneMenuActions {
  isEditMode: boolean;
  isLocked: boolean;
  closeContextMenu: () => void;
  reactFlowInstance: React.RefObject<ReactFlowInstance | null>;
  /** Callback to add a default node at a position */
  onAddDefaultNode?: (position: { x: number; y: number }) => void;
  /** Context menu screen position for coordinate conversion */
  menuPosition?: { x: number; y: number };
}

function isNonEmptyString(value: string | undefined | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function getExtraDataString(
  extraData: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (extraData === undefined) return undefined;
  const value = extraData[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isNodeActionDisabled(
  action: TopoViewerNodeAction,
  runtimeState: NodeRuntimeActionState | undefined
): boolean {
  if (runtimeState === undefined) {
    return false;
  }

  switch (action) {
    case "ssh":
    case "shell":
    case "logs":
    case "stop":
    case "restart":
      return runtimeState !== "running";
    default:
      return false;
  }
}

/**
 * Build context menu for free text annotations
 */
function buildFreeTextContextMenu(ctx: MenuBuilderContext): ContextMenuItem[] {
  const {
    targetId,
    isLocked,
    closeContextMenu,
    editFreeText,
    editFreeTextWithInline,
    duplicateFreeText,
    deleteFreeText
  } = ctx;

  const items: ContextMenuItem[] = [
    {
      id: "edit-text",
      label: "Edit Text",
      icon: React.createElement(EditIcon, { fontSize: "small" }),
      disabled: isLocked,
      onClick: () => {
        // Prefer opening the style drawer together with the inline editor.
        (editFreeTextWithInline ?? editFreeText)?.(targetId);
        closeContextMenu();
      }
    }
  ];
  if (!isLocked) {
    items.push(
      {
        id: "duplicate-text",
        label: "Duplicate Text",
        icon: React.createElement(ContentCopyIcon, { fontSize: "small" }),
        onClick: () => {
          duplicateFreeText?.(targetId);
          closeContextMenu();
        }
      },
      { id: DIVIDER_ID, label: "", divider: true },
      {
        id: "delete-text",
        label: "Delete Text",
        icon: React.createElement(DeleteIcon, { fontSize: "small" }),
        disabled: isLocked,
        danger: true,
        onClick: () => {
          deleteFreeText?.(targetId);
          closeContextMenu();
        }
      }
    );
  }
  return items;
}

/**
 * Build context menu for free shape annotations
 */
function buildFreeShapeContextMenu(ctx: MenuBuilderContext): ContextMenuItem[] {
  const { targetId, isLocked, closeContextMenu, editFreeShape, deleteFreeShape } = ctx;

  const items: ContextMenuItem[] = [
    {
      id: "edit-shape",
      label: "Edit Shape",
      icon: React.createElement(EditIcon, { fontSize: "small" }),
      disabled: isLocked,
      onClick: () => {
        editFreeShape?.(targetId);
        closeContextMenu();
      }
    }
  ];
  if (!isLocked) {
    items.push(
      { id: DIVIDER_ID, label: "", divider: true },
      {
        id: "delete-shape",
        label: "Delete Shape",
        icon: React.createElement(DeleteIcon, { fontSize: "small" }),
        disabled: isLocked,
        danger: true,
        onClick: () => {
          deleteFreeShape?.(targetId);
          closeContextMenu();
        }
      }
    );
  }
  return items;
}

/**
 * Build context menu for group annotations
 */
function buildGroupContextMenu(ctx: MenuBuilderContext): ContextMenuItem[] {
  const { targetId, isLocked, closeContextMenu, editGroup, deleteGroup } = ctx;

  const items: ContextMenuItem[] = [
    {
      id: "edit-group",
      label: "Edit Group",
      icon: React.createElement(EditIcon, { fontSize: "small" }),
      disabled: isLocked,
      onClick: () => {
        editGroup?.(targetId);
        closeContextMenu();
      }
    }
  ];
  if (!isLocked) {
    items.push(
      { id: DIVIDER_ID, label: "", divider: true },
      {
        id: "delete-group",
        label: "Delete Group",
        icon: React.createElement(DeleteIcon, { fontSize: "small" }),
        disabled: isLocked,
        danger: true,
        onClick: () => {
          deleteGroup?.(targetId);
          closeContextMenu();
        }
      }
    );
  }
  return items;
}

/**
 * Build context menu for traffic-rate annotations
 */
function buildTrafficRateContextMenu(ctx: MenuBuilderContext): ContextMenuItem[] {
  const { targetId, isLocked, closeContextMenu, editTrafficRate, deleteTrafficRate } = ctx;

  const items: ContextMenuItem[] = [
    {
      id: "edit-traffic-rate",
      label: "Edit Traffic Rate",
      icon: React.createElement(EditIcon, { fontSize: "small" }),
      disabled: isLocked,
      onClick: () => {
        editTrafficRate?.(targetId);
        closeContextMenu();
      }
    }
  ];

  if (!isLocked) {
    items.push(
      { id: DIVIDER_ID, label: "", divider: true },
      {
        id: "delete-traffic-rate",
        label: "Delete Traffic Rate",
        icon: React.createElement(DeleteIcon, { fontSize: "small" }),
        disabled: isLocked,
        danger: true,
        onClick: () => {
          deleteTrafficRate?.(targetId);
          closeContextMenu();
        }
      }
    );
  }

  return items;
}

function buildNodeRuntimeItems(ctx: MenuBuilderContext): ContextMenuItem[] {
  const { targetId, targetRuntimeState, closeContextMenu, onNodeAction } = ctx;
  return [
    {
      id: "start-node",
      label: "Start",
      icon: React.createElement(PlayArrowIcon, { fontSize: "small" }),
      onClick: () => {
        onNodeAction("start", targetId);
        closeContextMenu();
      }
    },
    {
      id: "stop-node",
      label: "Stop",
      icon: React.createElement(StopIcon, { fontSize: "small" }),
      disabled: isNodeActionDisabled("stop", targetRuntimeState),
      onClick: () => {
        onNodeAction("stop", targetId);
        closeContextMenu();
      }
    },
    {
      id: "restart-node",
      label: "Restart",
      icon: React.createElement(ReplayIcon, { fontSize: "small" }),
      disabled: isNodeActionDisabled("restart", targetRuntimeState),
      onClick: () => {
        onNodeAction("restart", targetId);
        closeContextMenu();
      }
    },
    { id: "divider-node-lifecycle", label: "", divider: true },
    {
      id: "ssh-node",
      label: "SSH",
      icon: React.createElement(TerminalIcon, { fontSize: "small" }),
      disabled: isNodeActionDisabled("ssh", targetRuntimeState),
      onClick: () => {
        onNodeAction("ssh", targetId);
        closeContextMenu();
      }
    },
    {
      id: "shell-node",
      label: "Shell",
      icon: React.createElement(TerminalIcon, { fontSize: "small" }),
      disabled: isNodeActionDisabled("shell", targetRuntimeState),
      onClick: () => {
        onNodeAction("shell", targetId);
        closeContextMenu();
      }
    },
    {
      id: "logs-node",
      label: "Logs",
      icon: React.createElement(ArticleIcon, { fontSize: "small" }),
      disabled: isNodeActionDisabled("logs", targetRuntimeState),
      onClick: () => {
        onNodeAction("logs", targetId);
        closeContextMenu();
      }
    }
  ];
}

function buildNodeEditItems(ctx: MenuBuilderContext): ContextMenuItem[] {
  const {
    targetId,
    targetNodeType,
    isLocked,
    closeContextMenu,
    editNode,
    editNetwork,
    handleDeleteNode,
    linkSourceNode,
    startLinkCreation,
    cancelLinkCreation
  } = ctx;

  const items: ContextMenuItem[] = [];
  const isNetworkNode = targetNodeType === "network-node";

  // If in link creation mode, show cancel option
  if (isNonEmptyString(linkSourceNode)) {
    items.push({
      id: "cancel-link",
      label: "Cancel Link Creation",
      icon: React.createElement(CloseIcon, { fontSize: "small" }),
      onClick: () => {
        cancelLinkCreation?.();
        closeContextMenu();
      }
    });
    items.push({ id: "divider-link", label: "", divider: true });
  }

  // Show "Create Link" if not already in link creation mode
  if (!isNonEmptyString(linkSourceNode)) {
    items.push({
      id: "create-link",
      label: "Create Link",
      icon: React.createElement(LinkIcon, { fontSize: "small" }),
      disabled: isLocked,
      onClick: () => {
        startLinkCreation?.(targetId);
        closeContextMenu();
      }
    });
  }

  items.push({ id: "divider-edit", label: "", divider: true });
  items.push({
    id: "edit-node",
    label: isNetworkNode ? "Edit Network" : "Edit Node",
    icon: isNetworkNode
      ? React.createElement(LanIcon, { fontSize: "small" })
      : React.createElement(EditIcon, { fontSize: "small" }),
    disabled: isLocked,
    onClick: () => {
      if (isNetworkNode) {
        editNetwork?.(targetId);
        closeContextMenu();
        return;
      }
      editNode(targetId);
      closeContextMenu();
    }
  });

  items.push({ id: DIVIDER_ID, label: "", divider: true });
  items.push({
    id: "delete-node",
    label: "Delete Node",
    icon: React.createElement(DeleteIcon, { fontSize: "small" }),
    disabled: isLocked,
    danger: true,
    onClick: () => handleDeleteNode(targetId)
  });

  return items;
}

/**
 * Build node context menu items.
 *
 * Edit actions appear when the topology is editable. Runtime actions
 * (start/stop/ssh/...) appear when the lab is deployed — and always in
 * read-only view mode, which exists to inspect labs — so a deployed editable
 * lab gets both sections.
 */
export function buildNodeContextMenu(ctx: MenuBuilderContext): ContextMenuItem[] {
  const { targetId, targetNodeType, isEditMode, isDeployed, closeContextMenu, showNodeInfo } = ctx;

  // Handle annotation nodes with specific menus
  if (targetNodeType === FREE_TEXT_NODE_TYPE) {
    return buildFreeTextContextMenu(ctx);
  }
  if (targetNodeType === FREE_SHAPE_NODE_TYPE) {
    return buildFreeShapeContextMenu(ctx);
  }
  if (targetNodeType === TRAFFIC_RATE_NODE_TYPE) {
    return buildTrafficRateContextMenu(ctx);
  }
  if (targetNodeType === GROUP_NODE_TYPE) {
    return buildGroupContextMenu(ctx);
  }

  const isNetworkNode = targetNodeType === "network-node";
  const showRuntimeActions = isDeployed || !isEditMode;
  const items: ContextMenuItem[] = [];

  if (showRuntimeActions && !isNetworkNode) {
    items.push(...buildNodeRuntimeItems(ctx));
  }

  if (isEditMode) {
    if (items.length > 0) {
      items.push({ id: "divider-runtime-edit", label: "", divider: true });
    }
    items.push(...buildNodeEditItems(ctx));
  }

  if (showRuntimeActions) {
    if (items.length > 0) {
      items.push({ id: DIVIDER_ID + "-info", label: "", divider: true });
    }
    items.push({
      id: "info-node",
      label: "Info",
      icon: React.createElement(InfoIcon, { fontSize: "small" }),
      onClick: () => {
        showNodeInfo?.(targetId);
        closeContextMenu();
      }
    });
  }

  return items;
}

/** Build interface capture items for each edge endpoint. */
function buildEdgeCaptureItems(ctx: EdgeMenuBuilderContext): ContextMenuItem[] {
  const {
    sourceNode,
    targetNode,
    sourceEndpoint,
    targetEndpoint,
    extraData,
    onInterfaceCapture,
    closeContextMenu
  } = ctx;

  const captureItems: ContextMenuItem[] = [];
  const srcCaptureName = getExtraDataString(extraData, "clabSourceLongName") ?? sourceNode;
  const dstCaptureName = getExtraDataString(extraData, "clabTargetLongName") ?? targetNode;
  const srcDisplayName = getExtraDataString(extraData, "yamlSourceNodeId") ?? sourceNode ?? srcCaptureName;
  const dstDisplayName = getExtraDataString(extraData, "yamlTargetNodeId") ?? targetNode ?? dstCaptureName;
  if (
    isNonEmptyString(srcCaptureName) &&
    isNonEmptyString(srcDisplayName) &&
    isNonEmptyString(sourceEndpoint)
  ) {
    captureItems.push({
      id: "capture-source",
      label: `${srcDisplayName} - ${sourceEndpoint}`,
      icon: React.createElement(WiresharkIcon, { fontSize: "small" }),
      onClick: () => {
        onInterfaceCapture(srcCaptureName, sourceEndpoint);
        closeContextMenu();
      }
    });
  }
  if (
    isNonEmptyString(dstCaptureName) &&
    isNonEmptyString(dstDisplayName) &&
    isNonEmptyString(targetEndpoint)
  ) {
    captureItems.push({
      id: "capture-target",
      label: `${dstDisplayName} - ${targetEndpoint}`,
      icon: React.createElement(WiresharkIcon, { fontSize: "small" }),
      onClick: () => {
        onInterfaceCapture(dstCaptureName, targetEndpoint);
        closeContextMenu();
      }
    });
  }

  return captureItems;
}

/**
 * Build edge context menu items
 */
export function buildEdgeContextMenu(ctx: EdgeMenuBuilderContext): ContextMenuItem[] {
  const {
    targetId,
    isEditMode,
    isDeployed,
    isLocked,
    closeContextMenu,
    editEdge,
    handleDeleteEdge,
    showLinkInfo,
    showLinkImpairment
  } = ctx;

  const captureItems = buildEdgeCaptureItems(ctx);

  const impairmentItem: ContextMenuItem = {
    id: "impair-edge",
    label: "Link Impairments",
    icon: React.createElement(TuneIcon, { fontSize: "small" }),
    onClick: () => {
      showLinkImpairment?.(targetId);
      closeContextMenu();
    }
  };
  const linkInfoItem: ContextMenuItem = {
    id: "info-edge",
    label: "Info",
    icon: React.createElement(InfoIcon, { fontSize: "small" }),
    onClick: () => {
      showLinkInfo?.(targetId);
      closeContextMenu();
    }
  };

  // Edit actions appear when the topology is editable; runtime actions
  // (capture/impairments/info) when the lab is deployed — and always in
  // read-only view mode — so a deployed editable lab gets both sections.
  const showRuntimeActions = isDeployed || !isEditMode;
  const items: ContextMenuItem[] = [];

  if (showRuntimeActions) {
    items.push(...captureItems);
    if (captureItems.length > 0) {
      items.push({ id: "divider-capture", label: "", divider: true });
    }
    items.push(impairmentItem);
  }

  if (isEditMode) {
    if (items.length > 0) {
      items.push({ id: "divider-runtime-edit", label: "", divider: true });
    }
    items.push({
      id: "edit-edge",
      label: "Edit Link",
      icon: React.createElement(EditIcon, { fontSize: "small" }),
      disabled: isLocked,
      onClick: () => {
        editEdge(targetId);
        closeContextMenu();
      }
    });
  }

  if (showRuntimeActions) {
    items.push({ id: "divider-info", label: "", divider: true });
    items.push(linkInfoItem);
  }

  if (isEditMode) {
    items.push({ id: DIVIDER_ID, label: "", divider: true });
    items.push({
      id: "delete-edge",
      label: "Delete Link",
      icon: React.createElement(DeleteIcon, { fontSize: "small" }),
      disabled: isLocked,
      danger: true,
      onClick: () => handleDeleteEdge(targetId)
    });
  }

  return items;
}

/**
 * Build pane context menu items
 */
export function buildPaneContextMenu(ctx: PaneMenuBuilderContext): ContextMenuItem[] {
  const {
    isEditMode,
    isLocked,
    closeContextMenu,
    reactFlowInstance,
    onOpenNodePalette,
    onAddDefaultNode,
    onAddGroup,
    onAddText,
    onAddTextAtPosition,
    onAddShapes,
    onAddShapeAtPosition,
    onAddTrafficRateAtPosition,
    menuPosition
  } = ctx;
  const items: ContextMenuItem[] = [];

  // Add Node is only available when the topology is editable
  if (isEditMode) {
    items.push(
      {
        id: "add-node",
        label: "Add Node",
        icon: React.createElement(AddIcon, { fontSize: "small" }),
        disabled: isLocked,
        onClick: () => {
          if (onAddDefaultNode && menuPosition && reactFlowInstance.current) {
            const flowPosition = reactFlowInstance.current.screenToFlowPosition(menuPosition);
            onAddDefaultNode(flowPosition);
          }
          closeContextMenu();
        }
      },
      { id: "divider-additions", label: "", divider: true }
    );
  }

  const editorItems: ContextMenuItem[] = [];

  const getFlowPosition = () => {
    const instance = reactFlowInstance.current;
    if (!instance) return null;
    if (menuPosition) {
      return instance.screenToFlowPosition(menuPosition);
    }
    return getViewportCenter(instance);
  };

  if (onAddGroup) {
    editorItems.push({
      id: "add-group",
      label: "Add Group",
      icon: React.createElement(LayersIcon, { fontSize: "small" }),
      disabled: isLocked,
      onClick: () => {
        onAddGroup();
        closeContextMenu();
      }
    });
  }
  if (onAddText || onAddTextAtPosition) {
    editorItems.push({
      id: "add-text",
      label: "Add Text",
      icon: React.createElement(TextFieldsIcon, { fontSize: "small" }),
      disabled: isLocked,
      onClick: () => {
        const flowPosition = getFlowPosition();
        if (onAddTextAtPosition && flowPosition) {
          onAddTextAtPosition(flowPosition);
        } else {
          onAddText?.();
        }
        closeContextMenu();
      }
    });
  }

  if (onAddShapes || onAddShapeAtPosition) {
    editorItems.push({
      id: "add-shape",
      label: "Add Shape",
      icon: React.createElement(CategoryIcon, { fontSize: "small" }),
      disabled: isLocked,
      children: [
        {
          id: "add-shape-rectangle",
          label: "Rectangle",
          icon: React.createElement(CropSquareIcon, { fontSize: "small" }),
          disabled: isLocked,
          onClick: () => {
            const flowPosition = getFlowPosition();
            if (onAddShapeAtPosition && flowPosition) {
              onAddShapeAtPosition(flowPosition, "rectangle");
            } else {
              onAddShapes?.("rectangle");
            }
            closeContextMenu();
          }
        },
        {
          id: "add-shape-circle",
          label: "Circle",
          icon: React.createElement(CircleOutlinedIcon, { fontSize: "small" }),
          disabled: isLocked,
          onClick: () => {
            const flowPosition = getFlowPosition();
            if (onAddShapeAtPosition && flowPosition) {
              onAddShapeAtPosition(flowPosition, "circle");
            } else {
              onAddShapes?.("circle");
            }
            closeContextMenu();
          }
        },
        {
          id: "add-shape-line",
          label: "Line",
          icon: React.createElement(RemoveIcon, { fontSize: "small" }),
          disabled: isLocked,
          onClick: () => {
            const flowPosition = getFlowPosition();
            if (onAddShapeAtPosition && flowPosition) {
              onAddShapeAtPosition(flowPosition, "line");
            } else {
              onAddShapes?.("line");
            }
            closeContextMenu();
          }
        }
      ]
    });
  }
  if (onAddTrafficRateAtPosition) {
    editorItems.push({
      id: "add-traffic-rate",
      label: "Add Traffic Rate",
      icon: React.createElement(SpeedIcon, { fontSize: "small" }),
      disabled: isLocked,
      onClick: () => {
        const flowPosition = getFlowPosition();
        if (flowPosition) {
          onAddTrafficRateAtPosition(flowPosition);
        }
        closeContextMenu();
      }
    });
  }
  if (editorItems.length > 0) {
    items.push(...editorItems);
  }

  const paletteItem: ContextMenuItem = {
    id: "open-node-palette",
    label: "Open Palette",
    icon: React.createElement(DashboardIcon, { fontSize: "small" }),
    onClick: () => {
      onOpenNodePalette?.();
      closeContextMenu();
    }
  };
  if (items.length > 0) {
    items.push({ id: "divider-palette", label: "", divider: true });
  }
  items.push(paletteItem);

  return items;
}
