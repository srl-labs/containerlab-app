import type {
  FreeTextAnnotation,
  FreeShapeAnnotation,
  TrafficRateAnnotation
} from "../../../../core/types/topology";
import type { GroupEditorData } from "../../../../hooks/canvas";
import type { LinkImpairmentData } from "../../link-impairment/types";
import type { LinkEditorData } from "../../link-editor/types";
import type { NetworkEditorData } from "../../network-editor/types";
import type { NodeEditorData } from "../../node-editor/types";

export interface EditorFooterRef {
  handleApply: () => void;
  handleSave: () => void;
  handleDiscard: () => void;
  hasChanges: boolean;
}

export interface EditorBannerRef {
  errors: string[];
}

export interface ContextPanelEditorState {
  editingNodeData: NodeEditorData | null;
  editingNodeInheritedProps: string[];
  /** Open the full editor for the currently selected node (Edit tab on a selection). */
  onOpenSelectedNodeEditor: () => void;
  nodeEditorHandlers: {
    handleClose: () => void;
    handleSave: (data: NodeEditorData) => void;
    handleApply: (data: NodeEditorData) => void;
    previewVisuals: (data: NodeEditorData) => void;
    handleDelete?: () => void;
  };
  editingLinkData: LinkEditorData | null;
  linkEditorHandlers: {
    handleClose: () => void;
    handleSave: (data: LinkEditorData) => void;
    handleApply: (data: LinkEditorData) => void;
    previewOffset: (data: LinkEditorData) => void;
    revertOffset: () => void;
    handleDelete?: () => void;
  };
  editingNetworkData: NetworkEditorData | null;
  networkEditorHandlers: {
    handleClose: () => void;
    handleSave: (data: NetworkEditorData) => void;
    handleApply: (data: NetworkEditorData) => void;
  };
  linkImpairmentData: LinkImpairmentData | null;
  linkImpairmentHandlers: {
    onError: (error: string) => void;
    onApply: (data: LinkImpairmentData) => void;
    onSave: (data: LinkImpairmentData) => void;
    onClose: () => void;
  };
  editingTextAnnotation: FreeTextAnnotation | null;
  textAnnotationHandlers: {
    /** Live apply: update the canvas immediately and persist debounced. */
    onApply: (annotation: FreeTextAnnotation) => void;
    onClose: () => void;
    onDelete: (id: string) => void;
  };
  editingShapeAnnotation: FreeShapeAnnotation | null;
  shapeAnnotationHandlers: {
    onApply: (annotation: FreeShapeAnnotation) => void;
    onClose: () => void;
    onDelete: (id: string) => void;
  };
  editingTrafficRateAnnotation: TrafficRateAnnotation | null;
  trafficRateAnnotationHandlers: {
    onApply: (annotation: TrafficRateAnnotation) => void;
    onClose: () => void;
    onDelete: (id: string) => void;
  };
  editingGroup: GroupEditorData | null;
  groupHandlers: {
    onApply: (data: GroupEditorData) => void;
    onClose: () => void;
    onDelete: (groupId: string) => void;
  };
}
