/**
 * useKeyboardShortcuts - Hook for keyboard shortcuts
 */
import { useEffect, useRef } from "react";

import { log } from "../../utils/logger";
import { useGraphStore } from "../../stores/graphStore";
import {
  FREE_TEXT_NODE_TYPE,
  FREE_SHAPE_NODE_TYPE,
  TRAFFIC_RATE_NODE_TYPE,
  GROUP_NODE_TYPE
} from "../../annotations/annotationNodeConverters";

interface KeyboardShortcutsOptions {
  disabled?: boolean;
  mode: "edit" | "view";
  isLocked: boolean;
  selectedNode: string | null;
  selectedEdge: string | null;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onDeleteSelection?: () => void;
  onDeselectAll: () => void;
  /** Undo handler (Ctrl+Z) */
  onUndo?: () => void;
  /** Redo handler (Ctrl+Y / Ctrl+Shift+Z) */
  onRedo?: () => void;
  /** Whether undo is available */
  canUndo?: boolean;
  /** Whether redo is available */
  canRedo?: boolean;
  /** Copy handler (Ctrl+C) */
  onCopy?: () => void;
  /** Paste handler (Ctrl+V) */
  onPaste?: ClipboardShortcutHandler;
  /** Duplicate handler (Ctrl+D) */
  onDuplicate?: ClipboardShortcutHandler;
  /** Selected annotation IDs */
  selectedAnnotationIds?: Set<string>;
  /** Copy annotations handler */
  onCopyAnnotations?: () => void;
  /** Paste annotations handler */
  onPasteAnnotations?: ClipboardShortcutHandler;
  /** Duplicate annotations handler */
  onDuplicateAnnotations?: ClipboardShortcutHandler;
  /** Delete selected annotations handler */
  onDeleteAnnotations?: () => void;
  /** Clear annotation selection */
  onClearAnnotationSelection?: () => void;
  /** Check if annotation clipboard has content */
  hasAnnotationClipboard?: () => boolean;
  /** Check if graph clipboard has content */
  hasGraphClipboard?: () => boolean;
  /** Create group from selected nodes (Ctrl+G) */
  onCreateGroup?: () => void;
}

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[contenteditable='plaintext-only']",
  "[role='textbox']",
  ".monaco-editor",
  ".monaco-inputbox",
  ".monaco-findInput"
].join(",");
const CANVAS_SELECTOR = ".react-flow-canvas, .react-flow";
const PANEL_SELECTOR = "[data-testid='context-panel'], .MuiDrawer-root, .MuiDrawer-paper";

type ShortcutInteractionArea = "canvas" | "panel" | "other";
type ClipboardShortcutOptions = { annotationsOnly?: boolean };
type ClipboardShortcutHandler = (options?: ClipboardShortcutOptions) => void;

function isEditableElement(element: Element | null): boolean {
  if (element == null) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return element.matches(EDITABLE_SELECTOR) || Boolean(element.closest(EDITABLE_SELECTOR));
}

function elementMatchesSelector(element: Element | null, selector: string): boolean {
  if (element == null) return false;
  return element.matches(selector) || Boolean(element.closest(selector));
}

function eventPathMatchesSelector(event: Event, selector: string): boolean {
  const target = event.target;
  if (target instanceof Element && elementMatchesSelector(target, selector)) return true;

  for (const entry of event.composedPath()) {
    if (entry instanceof Element && elementMatchesSelector(entry, selector)) {
      return true;
    }
  }
  return false;
}

function classifyInteractionTarget(target: EventTarget | null): ShortcutInteractionArea {
  if (!(target instanceof Element)) return "other";
  if (elementMatchesSelector(target, CANVAS_SELECTOR)) return "canvas";
  if (elementMatchesSelector(target, PANEL_SELECTOR)) return "panel";
  return "other";
}

function clearNativeSelection(): void {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    selection.removeAllRanges();
  }
}

function hasMonacoFocus(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof Element)) return false;
  if (activeElement.classList.contains("inputarea")) return true;
  if (isEditableElement(activeElement)) return true;
  return Boolean(activeElement.closest(".monaco-editor, .monaco-inputbox, .monaco-findInput"));
}

/**
 * Check if keyboard focus is currently in an editable/input context.
 */
function isInputElement(event: KeyboardEvent): boolean {
  if (hasMonacoFocus()) return true;

  if (event.target instanceof Element && isEditableElement(event.target)) {
    return true;
  }

  const path = event.composedPath();
  for (const entry of path) {
    if (entry instanceof Element && isEditableElement(entry)) {
      return true;
    }
  }

  if (document.activeElement instanceof Element && isEditableElement(document.activeElement)) {
    return true;
  }

  return false;
}

function isClipboardEventInEditableContext(event: ClipboardEvent): boolean {
  if (hasMonacoFocus()) return true;

  if (event.target instanceof Element && isEditableElement(event.target)) {
    return true;
  }

  for (const entry of event.composedPath()) {
    if (entry instanceof Element && isEditableElement(entry)) {
      return true;
    }
  }

  if (document.activeElement instanceof Element && isEditableElement(document.activeElement)) {
    return true;
  }

  return false;
}

function isModifiedKey(event: KeyboardEvent, key: string): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === key;
}

function hasActiveGraphSelection(
  selectedNode: string | null,
  selectedEdge: string | null,
  selectedAnnotationIds?: Set<string>
): boolean {
  if (hasSelectedId(selectedNode) || hasSelectedId(selectedEdge)) return true;
  if (selectedAnnotationIds && selectedAnnotationIds.size > 0) return true;

  const { nodes, edges } = useGraphStore.getState();
  return (
    nodes.some((node) => node.selected === true) || edges.some((edge) => edge.selected === true)
  );
}

function shouldHandleTopologyShortcut(
  event: Event,
  lastInteractionArea: ShortcutInteractionArea,
  selectedNode: string | null,
  selectedEdge: string | null,
  selectedAnnotationIds?: Set<string>
): boolean {
  if (eventPathMatchesSelector(event, CANVAS_SELECTOR)) return true;
  if (document.activeElement instanceof Element) {
    if (elementMatchesSelector(document.activeElement, CANVAS_SELECTOR)) return true;
  }
  if (hasActiveGraphSelection(selectedNode, selectedEdge, selectedAnnotationIds)) return true;
  return lastInteractionArea === "canvas";
}

function handleNonEditableSelectAll(
  event: KeyboardEvent,
  lastInteractionArea: ShortcutInteractionArea,
  selectedNode: string | null,
  selectedEdge: string | null,
  selectedAnnotationIds?: Set<string>
): boolean {
  if (!isModifiedKey(event, "a")) return false;

  if (
    shouldHandleTopologyShortcut(
      event,
      lastInteractionArea,
      selectedNode,
      selectedEdge,
      selectedAnnotationIds
    )
  ) {
    return handleSelectAll(event);
  }

  clearNativeSelection();
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/**
 * Handle Ctrl+Z: Undo
 */
function handleUndo(
  event: KeyboardEvent,
  mode: "edit" | "view",
  canUndo: boolean,
  onUndo?: () => void
): boolean {
  if (mode !== "edit") return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.key.toLowerCase() !== "z" || event.shiftKey) return false;
  if (!canUndo || !onUndo) return false;

  log.info("[Keyboard] Undo");
  onUndo();
  event.preventDefault();
  return true;
}

/**
 * Handle Ctrl+Y or Ctrl+Shift+Z: Redo
 */
function handleRedo(
  event: KeyboardEvent,
  mode: "edit" | "view",
  canRedo: boolean,
  onRedo?: () => void
): boolean {
  if (mode !== "edit") return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (!canRedo || !onRedo) return false;

  // Ctrl+Y or Ctrl+Shift+Z
  const key = event.key.toLowerCase();
  const isCtrlY = key === "y";
  const isCtrlShiftZ = key === "z" && event.shiftKey;
  if (!isCtrlY && !isCtrlShiftZ) return false;

  log.info("[Keyboard] Redo");
  onRedo();
  event.preventDefault();
  return true;
}

/**
 * Handle Ctrl+C: Copy (nodes/edges and/or annotations)
 */
function handleCopy(
  event: KeyboardEvent,
  onCopy?: () => void,
  selectedAnnotationIds?: Set<string>,
  onCopyAnnotations?: () => void
): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.key.toLowerCase() !== "c") return false;

  if (onCopy) {
    log.info("[Keyboard] Copy selected elements");
    event.preventDefault();
    event.stopPropagation();
    clearNativeSelection();
    onCopy();
    return true;
  }

  if (selectedAnnotationIds && selectedAnnotationIds.size > 0 && onCopyAnnotations) {
    log.info("[Keyboard] Copy annotations");
    event.preventDefault();
    event.stopPropagation();
    clearNativeSelection();
    onCopyAnnotations();
    return true;
  }

  return false;
}

/**
 * Handle Ctrl+V: Paste (nodes/edges and/or annotations)
 */
function handlePaste(
  event: KeyboardEvent,
  mode: "edit" | "view",
  isLocked: boolean,
  onPaste?: ClipboardShortcutHandler,
  onPasteAnnotations?: ClipboardShortcutHandler
): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.key.toLowerCase() !== "v") return false;
  if (isLocked) return false;

  if (mode === "edit" && onPaste) {
    log.info("[Keyboard] Paste elements");
    event.preventDefault();
    event.stopPropagation();
    onPaste();
    return true;
  }

  if (onPasteAnnotations) {
    log.info("[Keyboard] Paste annotations");
    event.preventDefault();
    event.stopPropagation();
    onPasteAnnotations(mode === "view" ? { annotationsOnly: true } : undefined);
    return true;
  }

  return false;
}

/**
 * Handle Ctrl+D: Duplicate (nodes/edges and/or annotations)
 */
function handleDuplicate(
  event: KeyboardEvent,
  mode: "edit" | "view",
  isLocked: boolean,
  onDuplicate?: ClipboardShortcutHandler,
  selectedAnnotationIds?: Set<string>,
  onDuplicateAnnotations?: ClipboardShortcutHandler
): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.key.toLowerCase() !== "d") return false;
  if (isLocked) return false;

  if (mode === "edit" && onDuplicate) {
    log.info("[Keyboard] Duplicate selected elements");
    event.preventDefault();
    event.stopPropagation();
    clearNativeSelection();
    onDuplicate();
    return true;
  }

  if (selectedAnnotationIds && selectedAnnotationIds.size > 0 && onDuplicateAnnotations) {
    log.info("[Keyboard] Duplicate annotations");
    event.preventDefault();
    event.stopPropagation();
    clearNativeSelection();
    onDuplicateAnnotations(mode === "view" ? { annotationsOnly: true } : undefined);
    return true;
  }

  return false;
}

function preventClipboardEvent(event: ClipboardEvent, shouldClearSelection = false): void {
  event.preventDefault();
  event.stopPropagation();
  if (shouldClearSelection) clearNativeSelection();
}

function handleCopyClipboardEvent(
  event: ClipboardEvent,
  shouldHandleTopology: boolean,
  isPanelEvent: boolean,
  onCopy?: () => void
): boolean {
  if (shouldHandleTopology && onCopy) {
    preventClipboardEvent(event, true);
    onCopy();
    return true;
  }

  if (isPanelEvent) {
    preventClipboardEvent(event, true);
    return true;
  }

  return false;
}

function handlePasteClipboardEvent(
  event: ClipboardEvent,
  mode: "edit" | "view",
  isLocked: boolean,
  shouldHandleTopology: boolean,
  isPanelEvent: boolean,
  onPaste?: ClipboardShortcutHandler,
  onPasteAnnotations?: ClipboardShortcutHandler
): boolean {
  if (isLocked) return false;

  if (mode === "edit" && shouldHandleTopology && onPaste) {
    preventClipboardEvent(event);
    onPaste();
    return true;
  }

  if (shouldHandleTopology && onPasteAnnotations) {
    preventClipboardEvent(event);
    onPasteAnnotations(mode === "view" ? { annotationsOnly: true } : undefined);
    return true;
  }

  if (mode === "edit" && isPanelEvent) {
    preventClipboardEvent(event);
    return true;
  }

  return false;
}

/**
 * Handle Ctrl+G: Create group from selected nodes
 * Note: Selection state and node filtering is handled by the onCreateGroup callback
 * since ReactFlow manages selection state directly
 */
function handleCreateGroup(
  event: KeyboardEvent,
  mode: "edit" | "view",
  onCreateGroup?: () => void
): boolean {
  if (mode !== "edit") return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.key.toLowerCase() !== "g") return false;
  if (!onCreateGroup) return false;

  log.info("[Keyboard] Creating group from selected nodes");
  event.preventDefault();
  event.stopPropagation();
  onCreateGroup();
  return true;
}

/**
 * Handle Ctrl+A: Select all nodes
 * Note: Selection is now handled by ReactFlow natively via its built-in select all
 * Returns true when the shortcut is recognized (but doesn't prevent default),
 * false when the key combination doesn't match.
 */
function handleSelectAll(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return false;

  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
      return false;
    }
  }

  const { nodes, edges, setNodes, setEdges } = useGraphStore.getState();
  setNodes(nodes.map((n) => ({ ...n, selected: true })));
  setEdges(edges.map((e) => ({ ...e, selected: true })));

  log.info("[Keyboard] Select all nodes and edges");
  event.preventDefault();
  event.stopPropagation();
  clearNativeSelection();
  return true;
}

function hasSelectedId(value: string | null): value is string {
  return value !== null && value.length > 0;
}

/**
 * Delete annotations if any are selected.
 */
function deleteSelectedAnnotations(
  selectedAnnotationIds: Set<string> | undefined,
  onDeleteAnnotations: (() => void) | undefined
): boolean {
  if (!selectedAnnotationIds || selectedAnnotationIds.size === 0 || !onDeleteAnnotations)
    return false;
  log.info(`[Keyboard] Deleting ${selectedAnnotationIds.size} annotations`);
  onDeleteAnnotations();
  return true;
}

/**
 * Delete selected elements (nodes and edges).
 * Note: Selection state is now managed by ReactFlow.
 * This function uses the selectedNode/selectedEdge params passed from the parent.
 */
function deleteSelectedElements(
  selectedNode: string | null,
  selectedEdge: string | null,
  onDeleteNode: (nodeId: string) => void,
  onDeleteEdge: (edgeId: string) => void
): boolean {
  let handled = false;

  if (!hasSelectedId(selectedNode) && !hasSelectedId(selectedEdge)) {
    const { nodes, edges } = useGraphStore.getState();
    const selectedNodes = nodes.filter((n) => n.selected === true);
    const selectedEdges = edges.filter((e) => e.selected === true);

    if (selectedNodes.length > 0) {
      log.info(`[Keyboard] Deleting ${selectedNodes.length} selected nodes`);
      selectedNodes.forEach((node) => onDeleteNode(node.id));
      return true;
    }

    if (selectedEdges.length > 0) {
      log.info(`[Keyboard] Deleting ${selectedEdges.length} selected edges`);
      selectedEdges.forEach((edge) => onDeleteEdge(edge.id));
      return true;
    }
  }

  if (hasSelectedId(selectedNode)) {
    log.info(`[Keyboard] Deleting node: ${selectedNode}`);
    onDeleteNode(selectedNode);
    handled = true;
  }

  if (hasSelectedId(selectedEdge)) {
    log.info(`[Keyboard] Deleting edge: ${selectedEdge}`);
    onDeleteEdge(selectedEdge);
    handled = true;
  }

  return handled;
}

function isAnnotationType(type: string | undefined): boolean {
  return (
    type === FREE_TEXT_NODE_TYPE ||
    type === FREE_SHAPE_NODE_TYPE ||
    type === GROUP_NODE_TYPE ||
    type === TRAFFIC_RATE_NODE_TYPE
  );
}

function handleDeleteInViewMode(
  event: KeyboardEvent,
  selectedNode: string | null,
  selectedEdge: string | null,
  onDeleteSelection: (() => void) | undefined,
  selectedAnnotationIds: Set<string> | undefined,
  onDeleteAnnotations: (() => void) | undefined
): boolean {
  const { nodes, edges } = useGraphStore.getState();
  const selectedNodes = nodes.filter((node) => node.selected === true);
  const hasSelectedEdges =
    edges.some((edge) => edge.selected === true) || hasSelectedId(selectedEdge);
  const hasSelectedAnnotationNodes = selectedNodes.some((node) => isAnnotationType(node.type));
  const hasSelectedNonAnnotationNode = selectedNodes.some((node) => !isAnnotationType(node.type));

  // If canvas selection includes only annotation nodes, use batched delete path
  // so deletion works even when annotation UI selection is out of sync.
  if (
    onDeleteSelection &&
    hasSelectedAnnotationNodes &&
    !hasSelectedEdges &&
    !hasSelectedNonAnnotationNode &&
    !hasSelectedId(selectedNode)
  ) {
    log.info("[Keyboard] Deleting selected annotation nodes (view mode)");
    onDeleteSelection();
    event.preventDefault();
    return true;
  }

  const handled = deleteSelectedAnnotations(selectedAnnotationIds, onDeleteAnnotations);
  if (handled) event.preventDefault();
  return handled;
}

function handleBatchedDeleteInEditMode(
  event: KeyboardEvent,
  selectedNode: string | null,
  selectedEdge: string | null,
  onDeleteSelection: (() => void) | undefined,
  selectedAnnotationIds: Set<string> | undefined
): boolean {
  if (!onDeleteSelection) return false;

  const { nodes, edges } = useGraphStore.getState();
  const selectedNodeIds = nodes.filter((node) => node.selected === true).map((node) => node.id);
  const selectedEdgeIds = edges.filter((edge) => edge.selected === true).map((edge) => edge.id);
  let totalSelected =
    selectedNodeIds.length + selectedEdgeIds.length + (selectedAnnotationIds?.size ?? 0);

  if (hasSelectedId(selectedNode) && !selectedNodeIds.includes(selectedNode)) {
    totalSelected += 1;
  }
  if (hasSelectedId(selectedEdge) && !selectedEdgeIds.includes(selectedEdge)) {
    totalSelected += 1;
  }

  if (totalSelected === 0) {
    return false;
  }

  log.info(`[Keyboard] Deleting ${totalSelected} selected items (batched)`);
  onDeleteSelection();
  event.preventDefault();
  return true;
}

/**
 * Handle Delete/Backspace: Delete selected element (nodes/edges and/or annotations)
 */
function handleDelete(
  event: KeyboardEvent,
  mode: "edit" | "view",
  isLocked: boolean,
  selectedNode: string | null,
  selectedEdge: string | null,
  onDeleteNode: (nodeId: string) => void,
  onDeleteEdge: (edgeId: string) => void,
  onDeleteSelection: (() => void) | undefined,
  selectedAnnotationIds?: Set<string>,
  onDeleteAnnotations?: () => void
): boolean {
  if (event.key !== "Delete" && event.key !== "Backspace") return false;
  if (isLocked) return false;

  // In view mode (running/deployed labs), allow deleting annotations only when unlocked.
  if (mode !== "edit") {
    return handleDeleteInViewMode(
      event,
      selectedNode,
      selectedEdge,
      onDeleteSelection,
      selectedAnnotationIds,
      onDeleteAnnotations
    );
  }

  if (
    handleBatchedDeleteInEditMode(
      event,
      selectedNode,
      selectedEdge,
      onDeleteSelection,
      selectedAnnotationIds
    )
  ) {
    return true;
  }

  let handled = deleteSelectedAnnotations(selectedAnnotationIds, onDeleteAnnotations);

  // Delete selected graph elements
  if (deleteSelectedElements(selectedNode, selectedEdge, onDeleteNode, onDeleteEdge)) {
    handled = true;
  }

  if (handled) event.preventDefault();
  return handled;
}

/**
 * Handle Escape: Deselect all / close panels
 */
function handleEscape(
  event: KeyboardEvent,
  selectedNode: string | null,
  selectedEdge: string | null,
  onDeselectAll: () => void,
  selectedAnnotationIds?: Set<string>,
  onClearAnnotationSelection?: () => void
): boolean {
  if (event.key !== "Escape") return false;

  // Clear annotation selection
  if (selectedAnnotationIds && selectedAnnotationIds.size > 0 && onClearAnnotationSelection) {
    log.debug("[Keyboard] Clearing annotation selection");
    onClearAnnotationSelection();
    event.preventDefault();
    return true;
  }

  // NOTE: Element deselection is handled via onDeselectAll callback
  // ReactFlow manages selection state internally
  if (hasSelectedId(selectedNode) || hasSelectedId(selectedEdge)) {
    log.debug("[Keyboard] Deselecting all");
    onDeselectAll();
    event.preventDefault();
    return true;
  }

  // Also clear multi-selection even when there is no single selected element
  onDeselectAll();
  event.preventDefault();
  return true;
}

/**
 * Hook for managing keyboard shortcuts
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions): void {
  const {
    disabled = false,
    mode,
    isLocked,
    selectedNode,
    selectedEdge,
    onDeleteNode,
    onDeleteEdge,
    onDeleteSelection,
    onDeselectAll,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
    onCopy,
    onPaste,
    onDuplicate,
    selectedAnnotationIds,
    onCopyAnnotations,
    onPasteAnnotations,
    onDuplicateAnnotations,
    onDeleteAnnotations,
    onClearAnnotationSelection,
    onCreateGroup
  } = options;

  const lastInteractionAreaRef = useRef<ShortcutInteractionArea>("other");

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    if (disabled) return;
    if (isInputElement(event)) return;

    if (
      handleNonEditableSelectAll(
        event,
        lastInteractionAreaRef.current,
        selectedNode,
        selectedEdge,
        selectedAnnotationIds
      )
    ) {
      return;
    }

    if (
      !shouldHandleTopologyShortcut(
        event,
        lastInteractionAreaRef.current,
        selectedNode,
        selectedEdge,
        selectedAnnotationIds
      )
    ) {
      return;
    }

    // Undo/Redo must be checked before other shortcuts
    if (handleUndo(event, mode, canUndo, onUndo)) return;
    if (handleRedo(event, mode, canRedo, onRedo)) return;
    // Copy/Paste/Duplicate (with annotation support)
    if (handleCopy(event, onCopy, selectedAnnotationIds, onCopyAnnotations)) return;
    if (handlePaste(event, mode, isLocked, onPaste, onPasteAnnotations)) return;
    if (
      handleDuplicate(
        event,
        mode,
        isLocked,
        onDuplicate,
        selectedAnnotationIds,
        onDuplicateAnnotations
      )
    )
      return;
    // Group shortcut (Ctrl+G)
    if (handleCreateGroup(event, mode, onCreateGroup)) return;
    // Other shortcuts
    if (handleSelectAll(event)) return;
    if (
      handleDelete(
        event,
        mode,
        isLocked,
        selectedNode,
        selectedEdge,
        onDeleteNode,
        onDeleteEdge,
        onDeleteSelection,
        selectedAnnotationIds,
        onDeleteAnnotations
      )
    )
      return;
    handleEscape(
      event,
      selectedNode,
      selectedEdge,
      onDeselectAll,
      selectedAnnotationIds,
      onClearAnnotationSelection
    );
  };

  const handleClipboardEvent = (event: ClipboardEvent): void => {
    if (event.defaultPrevented) return;
    if (disabled) return;
    if (isClipboardEventInEditableContext(event)) return;

    const shouldHandleTopology = shouldHandleTopologyShortcut(
      event,
      lastInteractionAreaRef.current,
      selectedNode,
      selectedEdge,
      selectedAnnotationIds
    );
    const isPanelEvent =
      lastInteractionAreaRef.current === "panel" || eventPathMatchesSelector(event, PANEL_SELECTOR);

    if (event.type === "copy") {
      handleCopyClipboardEvent(event, shouldHandleTopology, isPanelEvent, onCopy);
      return;
    }

    if (event.type !== "paste") return;
    handlePasteClipboardEvent(
      event,
      mode,
      isLocked,
      shouldHandleTopology,
      isPanelEvent,
      onPaste,
      onPasteAnnotations
    );
  };

  // Keep the latest handlers in refs (updated every render) so the window
  // listeners below can be attached once on mount instead of being detached
  // and re-attached whenever a dependency (e.g. the selection) changes.
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;
  const handleClipboardEventRef = useRef(handleClipboardEvent);
  handleClipboardEventRef.current = handleClipboardEvent;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      lastInteractionAreaRef.current = classifyInteractionTarget(event.target);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKeyDownRef.current(event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const onClipboardEvent = (event: ClipboardEvent) => handleClipboardEventRef.current(event);
    window.addEventListener("copy", onClipboardEvent, true);
    window.addEventListener("paste", onClipboardEvent, true);
    return () => {
      window.removeEventListener("copy", onClipboardEvent, true);
      window.removeEventListener("paste", onClipboardEvent, true);
    };
  }, []);
}
