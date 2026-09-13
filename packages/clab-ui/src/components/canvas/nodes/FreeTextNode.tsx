/**
 * FreeTextNode - Custom React Flow node for free text annotations
 * Supports markdown rendering via markdown-it
 */
import React, { memo, useMemo, useCallback, useEffect, useState } from "react";
import { type NodeProps, NodeResizer, type ResizeParams } from "@xyflow/react";

import type { AnnotationHandlers, FreeTextNodeData } from "../types";
import { SELECTION_COLOR } from "../types";
import type { FreeTextAnnotation } from "../../../core/types/topology";
import { useIsLocked } from "../../../stores/topoViewerStore";
import { useAnnotationHandlers } from "../../../stores/canvasStore";
import { useAnnotationUIStore } from "../../../stores/annotationUIStore";
import {
  getLoadedMarkdownRenderer,
  loadMarkdownRenderer
} from "../../../utils/markdownRendererLazy";
import { renderHtmlToReactNodes } from "../../../utils/renderHtmlToReactNodes";

import { RotationHandle } from "./AnnotationHandles";
import { FreeTextInlineEditor } from "./FreeTextInlineEditor";
import "./FreeTextNode.css";

/** Minimum dimensions for resize */
const MIN_WIDTH = 40;
const MIN_HEIGHT = 20;

/**
 * Explicit line-height shared by the rendered content and the inline textarea.
 * Without it the rendered div inherits the app's body line-height (MUI: 1.5)
 * while the textarea falls back to the UA default (~1.15), so every line
 * shifts and the box height jumps when entering/leaving edit mode. Must match
 * the `1lh` paragraph gap in FreeTextNode.css and the SVG export text style.
 */
export const TEXT_LINE_HEIGHT = 1.5;

/** Build wrapper style for the node */
function buildWrapperStyle(rotation: number, selected: boolean): React.CSSProperties {
  // Use 100% dimensions - React Flow controls actual size via node's width/height props
  return {
    position: "relative",
    width: "100%",
    height: "100%",
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    cursor: "move",
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    transformOrigin: "center center",
    // Use outline instead of border - doesn't affect layout/cause shifts
    outline: selected ? `2px solid ${SELECTION_COLOR}` : "none",
    outlineOffset: 0,
    borderRadius: 4
  };
}

interface TextStyleOptions {
  fontSize: number;
  fontColor: string;
  backgroundColor?: string;
  fontWeight: React.CSSProperties["fontWeight"];
  fontStyle: React.CSSProperties["fontStyle"];
  textDecoration: React.CSSProperties["textDecoration"];
  textAlign: React.CSSProperties["textAlign"];
  fontFamily: string;
  roundedBackground: boolean;
}

function hasFixedHeight(height: unknown): boolean {
  return typeof height === "number" && Number.isFinite(height);
}

function isNoFillBackground(backgroundColor: string | undefined): boolean {
  if (backgroundColor === undefined) return true;
  const normalized = backgroundColor.trim().toLowerCase();
  return normalized.length === 0 || normalized === "transparent";
}

/** Build text style for free text content */
function getTextLayoutStyle(
  data: FreeTextNodeData,
  isMediaOnly: boolean
): Pick<React.CSSProperties, "height" | "overflow"> {
  if (!hasFixedHeight(data.height)) {
    return { height: "auto", overflow: "visible" };
  }
  if (isMediaOnly) {
    return { height: "100%", overflow: "hidden" };
  }
  return { height: "100%", overflow: "auto" };
}

function isStandaloneMarkdownImage(value: string): boolean {
  return /^\s*!\[[^\]]*\]\([^)]+\)\s*$/u.test(value);
}

function resolveTextStyleOptions(data: FreeTextNodeData): TextStyleOptions {
  return {
    fontSize: data.fontSize ?? 14,
    fontColor: data.fontColor ?? "#333",
    backgroundColor: data.backgroundColor,
    fontWeight: data.fontWeight ?? "normal",
    fontStyle: data.fontStyle ?? "normal",
    textDecoration: data.textDecoration ?? "none",
    textAlign: data.textAlign ?? "left",
    fontFamily: data.fontFamily ?? "inherit",
    roundedBackground: data.roundedBackground ?? true
  };
}

function getTextPadding(
  backgroundColor: string | undefined,
  isMediaOnly: boolean,
  hasFixedContentHeight: boolean
): string {
  if (isMediaOnly && hasFixedContentHeight) {
    return "0";
  }
  if (!isNoFillBackground(backgroundColor)) {
    return "4px 8px";
  }
  return "4px";
}

function getTextBorderRadius(
  roundedBackground: boolean,
  backgroundColor: string | undefined
): number {
  if (!roundedBackground || isNoFillBackground(backgroundColor)) {
    return 0;
  }
  return 4;
}

function buildTextStyle(data: FreeTextNodeData, isMediaOnly: boolean): React.CSSProperties {
  const styleOptions = resolveTextStyleOptions(data);
  const layoutStyle = getTextLayoutStyle(data, isMediaOnly);
  const fixedHeight = hasFixedHeight(data.height);
  const padding = getTextPadding(styleOptions.backgroundColor, isMediaOnly, fixedHeight);
  const backgroundColor = isNoFillBackground(styleOptions.backgroundColor)
    ? "transparent"
    : styleOptions.backgroundColor;

  return {
    fontSize: `${styleOptions.fontSize}px`,
    lineHeight: TEXT_LINE_HEIGHT,
    color: styleOptions.fontColor,
    fontWeight: styleOptions.fontWeight,
    fontStyle: styleOptions.fontStyle,
    textDecoration: styleOptions.textDecoration,
    textAlign: styleOptions.textAlign,
    fontFamily: styleOptions.fontFamily,
    backgroundColor,
    padding,
    borderRadius: getTextBorderRadius(styleOptions.roundedBackground, styleOptions.backgroundColor),
    width: "100%",
    height: layoutStyle.height,
    outline: "none",
    overflow: layoutStyle.overflow
  };
}

/** Prevent wheel events from propagating (prevents zoom while scrolling content) */
function handleWheelEvent(e: React.WheelEvent): void {
  const target = e.currentTarget;
  if (target.scrollHeight > target.clientHeight || target.scrollWidth > target.clientWidth) {
    e.stopPropagation();
  }
}

function toFreeTextNodeData(data: NodeProps["data"]): FreeTextNodeData {
  return {
    ...data,
    text: typeof data.text === "string" ? data.text : ""
  };
}

interface InlineEditingState {
  showInlineEditor: boolean;
  /** WYSIWYG style for the inline textarea (raw text, media layout never applies) */
  textStyle: React.CSSProperties;
  onCommit: (text: string) => void;
  onStyleChange?: (style: Partial<FreeTextAnnotation>) => void;
  onOpenStyleEditor?: (text: string) => void;
}

/** Wires the inline editor (double-click / newly created annotation) to the
 * annotation handlers. */
function useInlineTextEditing(
  id: string,
  nodeData: FreeTextNodeData,
  canEditAnnotations: boolean,
  annotationHandlers: AnnotationHandlers | null
): InlineEditingState {
  const isInlineEditing = useAnnotationUIStore((state) => state.inlineEditingTextId === id);

  const onCommit = useCallback(
    (text: string) => {
      annotationHandlers?.onCommitInlineFreeTextEdit?.(id, text);
    },
    [id, annotationHandlers]
  );
  const onStyleChange = useMemo(() => {
    const updateStyle = annotationHandlers?.onUpdateFreeTextStyle;
    if (!updateStyle) return undefined;
    return (style: Partial<FreeTextAnnotation>) => updateStyle(id, style);
  }, [id, annotationHandlers]);
  const onOpenStyleEditor = useMemo(() => {
    const openStyleEditor = annotationHandlers?.onOpenFreeTextStyleEditor;
    if (!openStyleEditor) return undefined;
    return (text: string) => openStyleEditor(id, text);
  }, [id, annotationHandlers]);
  const textStyle = useMemo(() => buildTextStyle(nodeData, false), [nodeData]);

  const showInlineEditor = Boolean(
    isInlineEditing && canEditAnnotations && annotationHandlers?.onCommitInlineFreeTextEdit
  );

  return { showInlineEditor, textStyle, onCommit, onStyleChange, onOpenStyleEditor };
}

/**
 * FreeTextNode component renders free text annotations on the canvas
 * with markdown support
 */
const FreeTextNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  // Memoized so downstream useMemo deps (e.g. textStyle) stay referentially stable.
  const nodeData = useMemo(() => toFreeTextNodeData(data), [data]);
  const isLocked = useIsLocked();
  const annotationHandlers = useAnnotationHandlers();
  const canEditAnnotations = !isLocked;
  const rotation = nodeData.rotation ?? 0;
  const inlineEditing = useInlineTextEditing(id, nodeData, canEditAnnotations, annotationHandlers);

  // Track resize/rotate state to keep selection border and handles visible
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(() =>
    getLoadedMarkdownRenderer()?.(nodeData.text) ?? null
  );

  useEffect(() => {
    const renderMarkdownFn = getLoadedMarkdownRenderer();
    if (renderMarkdownFn) {
      setRenderedHtml(renderMarkdownFn(nodeData.text));
      return;
    }

    let cancelled = false;
    setRenderedHtml(null);
    void loadMarkdownRenderer().then((renderMarkdown) => {
      if (!cancelled) {
        setRenderedHtml(renderMarkdown(nodeData.text));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [nodeData.text]);

  // Resize handlers
  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleResize = useCallback(
    (_event: unknown, params: ResizeParams) => {
      annotationHandlers?.onUpdateFreeTextSize(id, params.width, params.height);
    },
    [id, annotationHandlers]
  );

  const handleResizeEnd = useCallback(
    (_event: unknown, params: ResizeParams) => {
      annotationHandlers?.onUpdateFreeTextSize(id, params.width, params.height);
      // Persist once at resize end to avoid stale snapshot re-apply jitter.
      annotationHandlers?.onPersistAnnotations?.();
      setIsResizing(false);
    },
    [id, annotationHandlers]
  );

  // Rotation handlers
  const handleRotationStart = useCallback(() => {
    setIsRotating(true);
    annotationHandlers?.onFreeTextRotationStart?.(id);
  }, [id, annotationHandlers]);

  const handleRotationEnd = useCallback(() => {
    setIsRotating(false);
    annotationHandlers?.onFreeTextRotationEnd?.(id);
  }, [id, annotationHandlers]);

  const handleNodeDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();

      if (annotationHandlers?.onStartInlineFreeTextEdit) {
        annotationHandlers.onStartInlineFreeTextEdit(id);
        return;
      }
      if (canEditAnnotations) {
        annotationHandlers?.onEditFreeText(id);
      }
    },
    [id, canEditAnnotations, annotationHandlers]
  );

  const renderedContent = useMemo(
    () => (renderedHtml === null ? nodeData.text : renderHtmlToReactNodes(renderedHtml)),
    [nodeData.text, renderedHtml]
  );
  const isMediaOnly = useMemo(() => isStandaloneMarkdownImage(nodeData.text), [nodeData.text]);
  const hasFixedContentSize =
    typeof nodeData.height === "number" && Number.isFinite(nodeData.height);
  const isSelected = selected;
  // Show selection border when selected OR when actively resizing/rotating
  const showSelectionBorder = isSelected || isResizing || isRotating;
  const wrapperStyle = useMemo(
    () => buildWrapperStyle(rotation, showSelectionBorder),
    [rotation, showSelectionBorder]
  );
  const textStyle = useMemo(() => buildTextStyle(nodeData, isMediaOnly), [nodeData, isMediaOnly]);
  // Show handles when selected in edit mode, or when actively resizing/rotating
  const showHandles = (isSelected || isResizing || isRotating) && canEditAnnotations;

  return (
    <div style={wrapperStyle} className="free-text-node" onDoubleClick={handleNodeDoubleClick}>
      <NodeResizer
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        isVisible={showHandles}
        lineClassName="nodrag"
        handleClassName="nodrag"
        color={SELECTION_COLOR}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
      />
      {showHandles && annotationHandlers?.onUpdateFreeTextRotation && (
        <RotationHandle
          nodeId={id}
          currentRotation={nodeData.rotation ?? 0}
          onRotationChange={annotationHandlers.onUpdateFreeTextRotation}
          onRotationStart={handleRotationStart}
          onRotationEnd={handleRotationEnd}
        />
      )}
      {inlineEditing.showInlineEditor ? (
        <FreeTextInlineEditor
          nodeId={id}
          data={nodeData}
          textStyle={inlineEditing.textStyle}
          onCommit={inlineEditing.onCommit}
          onStyleChange={inlineEditing.onStyleChange}
          onOpenStyleEditor={inlineEditing.onOpenStyleEditor}
        />
      ) : (
        <div
          style={textStyle}
          className={`free-text-content free-text-markdown nowheel ${
            hasFixedContentSize ? "free-text-content--fixed" : "free-text-content--auto"
          } ${isMediaOnly ? "free-text-content--media" : ""}`}
          onWheel={handleWheelEvent}
        >
          {renderedContent}
        </div>
      )}
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export const FreeTextNode = memo(FreeTextNodeComponent);
