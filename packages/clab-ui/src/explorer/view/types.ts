import type { DragEvent } from "react";
import type {
  ExplorerAction,
  ExplorerIncomingMessage,
  ExplorerNode,
  ExplorerSectionId,
  ExplorerSectionSnapshot
} from "../shared/explorer/types";

export interface ExplorerNodeLabelProps {
  node: ExplorerNode;
  sectionId: ExplorerSectionId;
  onInvokeAction: (action: ExplorerAction) => void;
}

export interface SectionTreeProps {
  section: ExplorerSectionSnapshot;
  expandedItems: string[];
  onExpandedItemsChange: (itemIds: string[]) => void;
  onInvokeAction: (action: ExplorerAction) => void;
}

export interface SectionToolbarProps {
  actions: ExplorerAction[];
  onInvokeAction: (action: ExplorerAction) => void;
}

export interface ExplorerSectionCardProps {
  section: ExplorerSectionSnapshot;
  expandedItems: string[];
  isCollapsed: boolean;
  isDropTarget: boolean;
  isBeingDragged: boolean;
  flexStyle: string;
  onSetSectionRef: (sectionId: ExplorerSectionId, element: HTMLDivElement | null) => void;
  onSectionDragStart: (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => void;
  onSectionDragOver: (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => void;
  onSectionDrop: (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => void;
  onSectionDragEnd: () => void;
  onToggleSectionCollapsed: (sectionId: ExplorerSectionId) => void;
  onInvokeAction: (action: ExplorerAction) => void;
  onExpandedItemsChange: (sectionId: ExplorerSectionId, itemIds: string[]) => void;
  onExpandAllInSection: (sectionId: ExplorerSectionId, nodes: ExplorerNode[]) => void;
  onCollapseAllInSection: (sectionId: ExplorerSectionId) => void;
}

export type SnapshotExplorerMessage = Extract<ExplorerIncomingMessage, { command: "snapshot" }>;

export type FilterStateExplorerMessage = Extract<ExplorerIncomingMessage, { command: "filterState" }>;

export type UiStateExplorerMessage = Extract<ExplorerIncomingMessage, { command: "uiState" }>;

export type ErrorExplorerMessage = Extract<ExplorerIncomingMessage, { command: "error" }>;
