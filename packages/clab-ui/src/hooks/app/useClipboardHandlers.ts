/**
 * useClipboardHandlers - Unified clipboard operations with debouncing
 *
 * Provides debounced copy/paste/duplicate/delete handlers
 * using the React Flow clipboard hook.
 */
import React from "react";
import type { ReactFlowInstance } from "@xyflow/react";

import type { TopoNode, TopoEdge } from "../../core/types/graph";

import {
  useClipboard,
  type ClipboardPasteOptions,
  type UseClipboardOptions
} from "./useClipboard";
/**
 * Annotations interface subset for clipboard operations
 * Avoids circular dependency with AnnotationContext.tsx
 */
interface AnnotationsClipboardSubset {
  getNodeMembership: (nodeId: string) => string | null;
  addNodeToGroup: (nodeId: string, groupId: string) => void;
  deleteAllSelected: () => void;
}

/** Debounce interval in milliseconds */
const DEBOUNCE_MS = 50;
const CANVAS_SELECTOR = ".react-flow-canvas, .react-flow";

type FlowPosition = { x: number; y: number };
type ClipboardHandlerOptions = Pick<ClipboardPasteOptions, "annotationsOnly">;

function pointIsInAnyRect(x: number, y: number, rects: readonly DOMRect[]): boolean {
  return rects.some(
    (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  );
}

/**
 * Caches canvas bounding rects so pointer-move handlers don't run
 * querySelectorAll + getBoundingClientRect on every event. The cache is
 * invalidated on the next animation frame, so rects are recomputed at most
 * once per frame (covering scroll/resize/layout changes).
 */
function createCanvasRectCache(): { getRects: () => DOMRect[]; dispose: () => void } {
  let rects: DOMRect[] | null = null;
  let rafId: number | null = null;

  const getRects = (): DOMRect[] => {
    rects ??= Array.from(document.querySelectorAll(CANVAS_SELECTOR), (canvas) =>
      canvas.getBoundingClientRect()
    );
    rafId ??= window.requestAnimationFrame(() => {
      rafId = null;
      rects = null;
    });
    return rects;
  };

  const dispose = (): void => {
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    rafId = null;
    rects = null;
  };

  return { getRects, dispose };
}

function mouseEventToFlowPosition(
  event: MouseEvent,
  rfInstance: ReactFlowInstance
): FlowPosition {
  return rfInstance.screenToFlowPosition({
    x: event.clientX,
    y: event.clientY
  });
}

/**
 * Configuration for useClipboardHandlers hook
 */
export interface ClipboardHandlersConfig {
  annotations: AnnotationsClipboardSubset;
  rfInstance?: ReactFlowInstance | null;
  /** Callback for node creation (includes YAML persistence and undo) */
  handleNodeCreatedCallback?: (
    nodeId: string,
    nodeElement: TopoNode,
    position: { x: number; y: number }
  ) => void;
  /** Callback for edge creation (includes YAML persistence and undo) */
  handleEdgeCreated?: (
    sourceId: string,
    targetId: string,
    edgeData: {
      id: string;
      source: string;
      target: string;
      sourceEndpoint: string;
      targetEndpoint: string;
    }
  ) => void;
  /** Batch paste handler for unified undo/redo */
  handleBatchPaste?: (result: { nodes: TopoNode[]; edges: TopoEdge[] }) => void;
}

/**
 * Return type for useClipboardHandlers hook
 */
export interface ClipboardHandlersReturn {
  /** Debounced copy handler */
  handleUnifiedCopy: () => void;
  /** Debounced paste handler */
  handleUnifiedPaste: (options?: ClipboardHandlerOptions) => void;
  /** Debounced duplicate handler (copy + paste) */
  handleUnifiedDuplicate: (options?: ClipboardHandlerOptions) => void;
  /** Delete selected elements (graph + annotations) */
  handleUnifiedDelete: () => void;
  /** Check if clipboard has data (async) */
  hasClipboardData: () => boolean;
}

/**
 * Hook that provides debounced clipboard operations.
 */
export function useClipboardHandlers(config: ClipboardHandlersConfig): ClipboardHandlersReturn {
  const {
    annotations,
    handleNodeCreatedCallback,
    handleEdgeCreated,
    handleBatchPaste,
    rfInstance
  } = config;

  // Build clipboard options with persistence callbacks
  const clipboardOptions: UseClipboardOptions = React.useMemo(
    () => ({
      rfInstance,
      onNodeCreated: handleNodeCreatedCallback,
      onEdgeCreated: handleEdgeCreated,
      getNodeMembership: annotations.getNodeMembership,
      addNodeToGroup: annotations.addNodeToGroup,
      onPasteComplete: handleBatchPaste
    }),
    [
      rfInstance,
      handleNodeCreatedCallback,
      handleEdgeCreated,
      handleBatchPaste,
      annotations.getNodeMembership,
      annotations.addNodeToGroup
    ]
  );

  // Use the React Flow clipboard hook with persistence callbacks
  const clipboard = useClipboard(clipboardOptions);
  
  // Stable ref so callbacks below don't re-create on every render.
  // useClipboard returns a new object literal each render even though the
  // inner functions (copy/paste/hasClipboardData) are stable useCallbacks.
  const clipboardRef = React.useRef(clipboard);
  clipboardRef.current = clipboard;

  // Track if clipboard has data (synced on mount + window focus).
  // Stored in a ref because it is only read inside event handlers - this
  // avoids re-rendering the app when clipboard availability flips.
  const hasDataRef = React.useRef(false);

  // Check clipboard on mount and after operations
  const checkClipboard = React.useCallback(async () => {
    hasDataRef.current = await clipboardRef.current.hasClipboardData();
  }, []);

  React.useEffect(() => {
    void checkClipboard();
    // Re-check when the user returns to this tab (visibilitychange does not
    // fire during drag-end, unlike the focus event which triggers the Firefox
    // clipboard permission popup mid-drag).
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkClipboard();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [checkClipboard]);

  // Debounce refs
  const lastCopyTimeRef = React.useRef(0);
  const lastPasteTimeRef = React.useRef(0);
  const lastDuplicateTimeRef = React.useRef(0);
  const lastCanvasPastePositionRef = React.useRef<FlowPosition | null>(null);

  React.useEffect(() => {
    if (!rfInstance) {
      lastCanvasPastePositionRef.current = null;
      return;
    }

    const rectCache = createCanvasRectCache();
    const handlePointerPosition = (event: MouseEvent) => {
      if (!pointIsInAnyRect(event.clientX, event.clientY, rectCache.getRects())) return;
      lastCanvasPastePositionRef.current = mouseEventToFlowPosition(event, rfInstance);
    };

    // Pointer events cover mouse input too, so only register the mouse
    // fallback when PointerEvent is unavailable (avoids double work per move).
    const eventNames: ReadonlyArray<"pointerdown" | "pointermove" | "mousedown" | "mousemove"> =
      typeof PointerEvent === "undefined"
        ? ["mousedown", "mousemove"]
        : ["pointerdown", "pointermove"];

    for (const name of eventNames) window.addEventListener(name, handlePointerPosition, true);
    return () => {
      for (const name of eventNames) window.removeEventListener(name, handlePointerPosition, true);
      rectCache.dispose();
    };
  }, [rfInstance]);

  // Debounced copy
  const handleUnifiedCopy = React.useCallback(() => {
    const now = Date.now();
    if (now - lastCopyTimeRef.current < DEBOUNCE_MS) return;
    lastCopyTimeRef.current = now;
    void clipboardRef.current.copy().then(() => checkClipboard());
  }, [checkClipboard]);

  // Debounced paste
  const handleUnifiedPaste = React.useCallback((options?: ClipboardHandlerOptions) => {
    const now = Date.now();
    if (now - lastPasteTimeRef.current < DEBOUNCE_MS) return;
    lastPasteTimeRef.current = now;
    void clipboardRef.current.paste(lastCanvasPastePositionRef.current ?? undefined, options);
  }, []);

  // Debounced duplicate (copy + paste)
  const handleUnifiedDuplicate = React.useCallback((options?: ClipboardHandlerOptions) => {
    const now = Date.now();
    if (now - lastDuplicateTimeRef.current < DEBOUNCE_MS) return;
    lastDuplicateTimeRef.current = now;
    void clipboardRef.current.copy().then(async (success) => {
      if (success) {
        await clipboardRef.current.paste(undefined, {
          preferMemory: true,
          annotationsOnly: options?.annotationsOnly
        });
      }
    });
  }, []);

  // Delete handler (graph elements + annotations)
  const { deleteAllSelected } = annotations;
  const handleUnifiedDelete = React.useCallback(() => {
    deleteAllSelected();
  }, [deleteAllSelected]);

  // Synchronous check (uses cached ref)
  const hasClipboardData = React.useCallback(() => hasDataRef.current, []);

  return {
    handleUnifiedCopy,
    handleUnifiedPaste,
    handleUnifiedDuplicate,
    handleUnifiedDelete,
    hasClipboardData
  };
}
