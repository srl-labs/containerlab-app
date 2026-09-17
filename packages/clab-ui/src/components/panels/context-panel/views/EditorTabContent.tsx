// Editor content for the Edit tab.
import React from "react";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";

import { useContextPanelContent } from "../../../../hooks/ui/useContextPanelContent";
import { useIsLocked } from "../../../../stores/topoViewerStore";
import { PanelEmptyState } from "../../../ui/form";

import type { ContextPanelEditorState, EditorFooterRef, EditorBannerRef } from "./editorTypes";
import { editorViews } from "./editorViews";

const {
  FreeShapeEditorView,
  FreeTextEditorView,
  GroupEditorView,
  LinkEditorView,
  LinkImpairmentView,
  NetworkEditorView,
  NodeEditorView,
  TrafficRateEditorView
} = editorViews;

export interface EditorTabContentProps
  extends Omit<ContextPanelEditorState, "onOpenSelectedNodeEditor"> {
  onFooterRef: (ref: EditorFooterRef | null) => void;
  onBannerRef: (ref: EditorBannerRef | null) => void;
}

/** Placeholder shown when no editor is active */
const EditorPlaceholder: React.FC = () => (
  <PanelEmptyState
    icon={<EditOutlinedIcon sx={{ fontSize: 48, opacity: 0.5 }} />}
    message="Select a node, link, or annotation and click edit to modify it here."
  />
);

export const EditorTabContent: React.FC<EditorTabContentProps> = ({
  editingNodeData,
  editingNodeInheritedProps,
  nodeEditorHandlers,
  editingLinkData,
  linkEditorHandlers,
  editingNetworkData,
  networkEditorHandlers,
  linkImpairmentData,
  linkImpairmentHandlers,
  editingTextAnnotation,
  textAnnotationHandlers,
  editingShapeAnnotation,
  shapeAnnotationHandlers,
  editingTrafficRateAnnotation,
  trafficRateAnnotationHandlers,
  editingGroup,
  groupHandlers,
  onFooterRef,
  onBannerRef
}) => {
  const panelView = useContextPanelContent();
  const isLocked = useIsLocked();
  const isReadOnly = isLocked && panelView.isEditor;

  // Render the appropriate editor based on current state
  switch (panelView.kind) {
    case "nodeEditor":
      return (
        <NodeEditorView
          nodeData={editingNodeData}
          onSave={nodeEditorHandlers.handleSave}
          onApply={nodeEditorHandlers.handleApply}
          onPreview={nodeEditorHandlers.previewVisuals}
          inheritedProps={editingNodeInheritedProps}
          onFooterRef={onFooterRef}
          readOnly={isReadOnly}
        />
      );
    case "linkEditor":
      return (
        <LinkEditorView
          linkData={editingLinkData}
          onSave={linkEditorHandlers.handleSave}
          onApply={linkEditorHandlers.handleApply}
          previewOffset={linkEditorHandlers.previewOffset}
          revertOffset={linkEditorHandlers.revertOffset}
          onFooterRef={onFooterRef}
          onBannerRef={onBannerRef}
          readOnly={isReadOnly}
        />
      );
    case "networkEditor":
      return (
        <NetworkEditorView
          nodeData={editingNetworkData}
          onSave={networkEditorHandlers.handleSave}
          onApply={networkEditorHandlers.handleApply}
          onFooterRef={onFooterRef}
          readOnly={isReadOnly}
        />
      );
    case "linkImpairment":
      return (
        <LinkImpairmentView
          linkData={linkImpairmentData}
          onError={linkImpairmentHandlers.onError}
          onSave={linkImpairmentHandlers.onSave}
          onApply={linkImpairmentHandlers.onApply}
          onClose={linkImpairmentHandlers.onClose}
          onFooterRef={onFooterRef}
          readOnly={isReadOnly}
        />
      );
    case "freeTextEditor":
      return (
        <FreeTextEditorView
          annotation={editingTextAnnotation}
          onApply={textAnnotationHandlers.onApply}
          readOnly={isReadOnly}
        />
      );
    case "freeShapeEditor":
      return (
        <FreeShapeEditorView
          annotation={editingShapeAnnotation}
          onApply={shapeAnnotationHandlers.onApply}
          readOnly={isReadOnly}
        />
      );
    case "groupEditor":
      return (
        <GroupEditorView
          groupData={editingGroup}
          onApply={groupHandlers.onApply}
          readOnly={isReadOnly}
        />
      );
    case "trafficRateEditor":
      return (
        <TrafficRateEditorView
          annotation={editingTrafficRateAnnotation}
          onApply={trafficRateAnnotationHandlers.onApply}
          readOnly={isReadOnly}
        />
      );
    default:
      return <EditorPlaceholder />;
  }
};
