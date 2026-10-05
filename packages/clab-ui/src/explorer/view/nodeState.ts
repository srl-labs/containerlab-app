import type { ExplorerAction, ExplorerNode } from "../shared/explorer/types";
import {
  COLOR_TEXT_PRIMARY,
  COLOR_TEXT_SECONDARY,
  TREE_ENDPOINT_ROW_HEIGHT_PX,
  TREE_ROW_HEIGHT_PX,
  TREE_SECTION_ROW_HEIGHT_PX
} from "./constants";
import type { ExplorerNodeKind } from "./actionPresentation";

export function nodeKindFromContext(contextValue: string | undefined): ExplorerNodeKind {
  if (!contextValue) {
    return "other";
  }
  if (contextValue.includes("containerlabLab")) {
    return "lab";
  }
  if (contextValue === "containerlabContainer" || contextValue === "containerlabContainerGroup") {
    return "container";
  }
  if (contextValue === "containerlabInterfaceUp" || contextValue === "containerlabInterfaceDown") {
    return "interface";
  }
  if (contextValue === "containerlabSSHXLink" || contextValue === "containerlabGottyLink") {
    return "link";
  }
  if (
    contextValue === "containerlabFileExplorerRoot" ||
    contextValue === "containerlabFileFolder" ||
    contextValue === "containerlabFile" ||
    contextValue === "containerlabFileTopology"
  ) {
    return "file";
  }
  return "other";
}

export function isEndpointNode(contextValue: string | undefined): boolean {
  return contextValue === "containerlabEndpoint";
}

export function isEndpointSectionNode(contextValue: string | undefined): boolean {
  return (
    contextValue === "containerlabEndpointSectionRunning" ||
    contextValue === "containerlabEndpointSectionLocal"
  );
}

export function isEndpointDisconnectedNode(contextValue: string | undefined): boolean {
  return contextValue === "containerlabEndpointDisconnected";
}

export function isFileExplorerFolderNode(contextValue: string | undefined): boolean {
  return (
    contextValue === "containerlabFileExplorerRoot" || contextValue === "containerlabFileFolder"
  );
}

function endpointStatusLabel(
  state: ExplorerNode["state"],
  indicator: ExplorerNode["statusIndicator"]
): string {
  switch (String(state ?? "").toLowerCase()) {
    case "connected":
      return "connected";
    case "session_expired":
      return "expired";
    case "offline":
      return "offline";
    case "saved":
      return "saved";
    default:
      switch (indicator) {
        case "green":
          return "connected";
        case "red":
          return "disconnected";
        case "yellow":
          return "degraded";
        default:
          return "unknown";
      }
  }
}

function isFavoriteLabNode(contextValue: string | undefined): boolean {
  return (
    typeof contextValue === "string" &&
    contextValue.includes("containerlabLab") &&
    contextValue.includes("Favorite")
  );
}

function isSharedLabNode(node: ExplorerNode): boolean {
  return Boolean(node.shareAction);
}

export function endpointRowHeight(isEndpointRoot: boolean, isEndpointSection: boolean): number {
  if (isEndpointRoot) {
    return TREE_ENDPOINT_ROW_HEIGHT_PX;
  }
  if (isEndpointSection) {
    return TREE_SECTION_ROW_HEIGHT_PX;
  }
  return TREE_ROW_HEIGHT_PX;
}

export function explorerNodeLabelColor({
  isEndpointRoot,
  isEndpointSection,
  isDisconnectedPlaceholder
}: {
  isEndpointRoot: boolean;
  isEndpointSection: boolean;
  isDisconnectedPlaceholder: boolean;
}): string | undefined {
  if (isDisconnectedPlaceholder || isEndpointSection) {
    return COLOR_TEXT_SECONDARY;
  }
  if (isEndpointRoot) {
    return COLOR_TEXT_PRIMARY;
  }
  return undefined;
}

export function endpointStatusText(node: ExplorerNode, isEndpointRoot: boolean): string | null {
  if (!isEndpointRoot) {
    return null;
  }
  return endpointStatusLabel(node.state, node.statusIndicator);
}

interface ExplorerNodeDisplayFlags {
  inlineContainerStatus: string | undefined;
  showStatusDot: boolean;
  showFavoriteIcon: boolean;
  showSharedIcon: boolean;
}

export function deriveExplorerNodeDisplayFlags(
  node: ExplorerNode,
  secondaryText: string | undefined,
  isEndpointRoot: boolean,
  isEndpointSection: boolean,
  isDisconnectedPlaceholder: boolean
): ExplorerNodeDisplayFlags {
  const isContainer =
    node.contextValue === "containerlabContainer" ||
    node.contextValue === "containerlabContainerGroup";
  const isInterface =
    node.contextValue === "containerlabInterfaceUp" ||
    node.contextValue === "containerlabInterfaceDown";
  return {
    inlineContainerStatus: isContainer ? secondaryText?.trim() : undefined,
    showStatusDot:
      Boolean(node.statusIndicator) &&
      !isInterface &&
      !isEndpointRoot &&
      !isDisconnectedPlaceholder,
    showFavoriteIcon: isFavoriteLabNode(node.contextValue),
    showSharedIcon: isSharedLabNode(node)
  };
}

export interface ExplorerEndpointQuickActionsState {
  newTopologyAction: ExplorerAction | undefined;
  cloneRepoAction: ExplorerAction | undefined;
  reconnectAction: ExplorerAction | undefined;
}

export function resolveEndpointQuickActions(
  actions: readonly ExplorerAction[],
  isEndpointRoot: boolean,
  isEndpointConnected: boolean
): ExplorerEndpointQuickActionsState {
  if (!isEndpointRoot) {
    return {
      newTopologyAction: undefined,
      cloneRepoAction: undefined,
      reconnectAction: undefined
    };
  }
  if (isEndpointConnected) {
    return {
      newTopologyAction: actions.find(
        (action) => action.commandId === "containerlab.editor.topoViewerEditor"
      ),
      cloneRepoAction: actions.find((action) => action.commandId === "containerlab.lab.cloneRepo"),
      reconnectAction: undefined
    };
  }
  return {
    newTopologyAction: undefined,
    cloneRepoAction: undefined,
    reconnectAction: actions.find(
      (action) => action.commandId === "containerlab.endpoint.reconnect"
    )
  };
}
