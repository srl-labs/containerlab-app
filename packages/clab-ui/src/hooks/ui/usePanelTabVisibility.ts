/**
 * usePanelTabVisibility - Centralizes mode-based tab visibility rules.
 *
 * Rules:
 * - Info tab: visible when node/link selection resolves to an info view
 *   (deployed labs and read-only view mode).
 * - Edit tab: visible when an editor is active in any mode.
 * - Extra behavior: for selected nodes in unlocked edit mode, also show an
 *   Edit tab that opens the full node editor (same as double-click/context menu).
 */
import { useTopoViewerStore } from "../../stores/topoViewerStore";
import { useAnnotationUIStore } from "../../stores/annotationUIStore";

import { useContextPanelContent } from "./useContextPanelContent";

export interface PanelTabVisibility {
  showInfoTab: boolean;
  showEditTab: boolean;
  /** Edit tab represents a selected node; activating it must open the node editor. */
  editTabOpensSelectedNode: boolean;
  infoTabTitle?: string;
  editTabTitle?: string;
}

export function usePanelTabVisibility(): PanelTabVisibility {
  const panelView = useContextPanelContent();

  // Subscribe to derived booleans so unrelated store updates don't re-render consumers.
  const hasTopoEditor = useTopoViewerStore(
    (state) =>
      state.editingNode !== null ||
      state.editingEdge !== null ||
      state.editingNetwork !== null ||
      state.editingImpairment !== null
  );
  const hasAnnotationEditor = useAnnotationUIStore(
    (state) =>
      state.editingTextAnnotation !== null ||
      state.editingShapeAnnotation !== null ||
      state.editingTrafficRateAnnotation !== null ||
      state.editingGroup !== null
  );
  const isLocked = useTopoViewerStore((state) => state.isLocked);
  const mode = useTopoViewerStore((state) => state.mode);
  const hasSelectedNode = useTopoViewerStore((state) => state.selectedNode !== null);

  // Info tab: when node or link selection resolves to an info view
  // (useContextPanelContent gates that on deployment/read-only state).
  const showInfoTab = panelView.kind === "nodeInfo" || panelView.kind === "linkInfo";
  let infoTabTitle: string | undefined;
  if (panelView.kind === "nodeInfo") {
    infoTabTitle = "Node Properties";
  } else if (panelView.kind === "linkInfo") {
    infoTabTitle = "Link Properties";
  }

  // Edit tab: visible whenever an editor is active (any mode).
  // Some editors are view-mode features (Link Impairments, annotation editing).
  const hasEditor = hasTopoEditor || hasAnnotationEditor;

  // In unlocked edit mode, a selected topology node offers an Edit tab that
  // opens the full node editor (deployed labs select on click; the editor is
  // one tab click away instead of requiring double-click/context menu).
  const canEditSelectedNode =
    mode === "edit" && isLocked === false && panelView.kind === "nodeInfo" && hasSelectedNode;
  const showEditTab = hasEditor || canEditSelectedNode;

  let editTabTitle: string | undefined;
  if (hasEditor) {
    editTabTitle = panelView.title;
  } else if (canEditSelectedNode) {
    editTabTitle = "Node Editor";
  }

  return {
    showInfoTab,
    showEditTab,
    editTabOpensSelectedNode: !hasEditor && canEditSelectedNode,
    infoTabTitle,
    editTabTitle
  };
}
