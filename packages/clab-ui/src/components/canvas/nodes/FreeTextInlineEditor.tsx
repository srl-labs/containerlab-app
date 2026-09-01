/* eslint-disable import-x/max-dependencies */
/**
 * FreeTextInlineEditor - In-place editor for text annotations on the canvas.
 *
 * Renders a textarea styled like the annotation plus a floating formatting
 * toolbar. Commits on blur / Escape / Ctrl+Enter; an empty commit deletes the
 * annotation. Style changes apply live through the annotation handlers.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconItalic,
  IconUnderline,
  IconAdjustments
} from "@tabler/icons-react";
import { ActionIcon, Box, Divider, Paper, Tooltip } from "@mantine/core";

import type { FreeTextAnnotation } from "../../../core/types/topology";
import { loadMarkdownRenderer } from "../../../utils/markdownRendererLazy";
import { renderHtmlToReactNodes } from "../../../utils/renderHtmlToReactNodes";
import type { FreeTextNodeData } from "../types";

/** Matches FreeTextNode's resize minimum so entering/leaving edit mode doesn't jump. */
const MIN_EDITOR_WIDTH = 40;
/** Comfortable width for typing into a brand-new (empty) annotation. */
const EMPTY_EDITOR_WIDTH = 160;

/**
 * Cheap check for markdown syntax that renders differently than plain text.
 * Used to decide whether the live preview adds information over the textarea.
 */
const MARKDOWN_HINT_REGEX =
  /(^|\n)\s{0,3}(?:#{1,6}\s|>|```|(?:[-+*]|\d+[.)])\s)|\*\*|__|~~|`|!\[|\]\(|https?:\/\/|:[a-z0-9_+-]+:|\*\S/;

interface FreeTextInlineEditorProps {
  nodeId: string;
  data: FreeTextNodeData;
  /** Style of the rendered annotation text, reused for WYSIWYG editing */
  textStyle: React.CSSProperties;
  onCommit: (text: string) => void;
  onStyleChange?: (style: Partial<FreeTextAnnotation>) => void;
  onOpenStyleEditor?: (text: string) => void;
}

const ToolbarButton: React.FC<{
  active?: boolean;
  title: string;
  testId?: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active = false, title, testId, onClick, children }) => (
  <Tooltip label={title}>
    <ActionIcon
      radius="sm"
      variant={active ? "filled" : "subtle"}
      color={active ? "blue" : "gray"}
      data-testid={testId}
      onClick={onClick}
      // Keep focus in the textarea so toolbar clicks don't commit the edit.
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </ActionIcon>
  </Tooltip>
);

function buildTextareaStyle(
  textStyle: React.CSSProperties,
  data: FreeTextNodeData,
  isEmpty: boolean
): React.CSSProperties {
  const hasFixedWidth = typeof data.width === "number" && Number.isFinite(data.width);
  const hasFixedHeight = typeof data.height === "number" && Number.isFinite(data.height);
  const autoMinWidth = isEmpty ? EMPTY_EDITOR_WIDTH : MIN_EDITOR_WIDTH;
  return {
    ...textStyle,
    display: "block",
    boxSizing: "border-box",
    border: "none",
    outline: "none",
    margin: 0,
    resize: "none",
    // Fixed-height annotations scroll in view mode, so the editor must too.
    overflow: hasFixedHeight ? "auto" : "hidden",
    backgroundColor:
      typeof textStyle.backgroundColor === "string" && textStyle.backgroundColor.length > 0
        ? textStyle.backgroundColor
        : "transparent",
    caretColor: typeof textStyle.color === "string" ? textStyle.color : undefined,
    width: hasFixedWidth ? "100%" : "auto",
    height: hasFixedHeight ? "100%" : "auto",
    minWidth: hasFixedWidth ? undefined : autoMinWidth,
    minHeight: hasFixedHeight ? undefined : 24,
    // Auto-grow with content where supported (Chromium); the resize effect
    // below covers the height for other engines.
    fieldSizing: "content"
  } as React.CSSProperties;
}

/**
 * Live rendered preview of the markdown being typed. Only shown when the text
 * uses markdown syntax — plain text already renders exactly like the textarea.
 */
function useMarkdownPreview(text: string): React.ReactNode {
  const [previewNodes, setPreviewNodes] = useState<React.ReactNode>(null);

  useEffect(() => {
    if (!MARKDOWN_HINT_REGEX.test(text)) {
      setPreviewNodes(null);
      return;
    }
    let cancelled = false;
    void loadMarkdownRenderer().then((renderMarkdown) => {
      if (cancelled) return;
      const html = renderMarkdown(text);
      setPreviewNodes(html.length > 0 ? renderHtmlToReactNodes(html) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  return previewNodes;
}

const InlinePreviewCard: React.FC<{
  nodeId: string;
  textStyle: React.CSSProperties;
  children: React.ReactNode;
}> = ({ nodeId, textStyle, children }) => (
  <NodeToolbar nodeId={nodeId} isVisible position={Position.Bottom} offset={10} className="nodrag nopan">
    <Paper
      shadow="md"
      data-testid="free-text-inline-preview"
      // Keep focus in the textarea so touching the preview doesn't commit.
      onMouseDown={(e) => e.preventDefault()}
      style={{ padding: 8, maxWidth: 420, overflow: "hidden" }}
    >
      <Box style={{ fontSize: 10, opacity: 0.6, marginBottom: 4, userSelect: "none" }}>Preview</Box>
      <div
        className="free-text-markdown free-text-content--auto free-text-inline-preview"
        style={{ ...textStyle, width: "100%", height: "auto", overflow: "hidden" }}
      >
        {children}
      </div>
    </Paper>
  </NodeToolbar>
);

export const FreeTextInlineEditor: React.FC<FreeTextInlineEditorProps> = ({
  nodeId,
  data,
  textStyle,
  onCommit,
  onStyleChange,
  onOpenStyleEditor
}) => {
  const [text, setText] = useState(data.text);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const committedRef = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Height auto-grow fallback for engines without field-sizing support.
  const hasFixedHeight = typeof data.height === "number" && Number.isFinite(data.height);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || hasFixedHeight) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, hasFixedHeight]);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(textRef.current);
  }, [onCommit]);

  const isInsideEditor = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) return false;
    return (
      textareaRef.current?.contains(target) === true ||
      toolbarRef.current?.contains(target) === true
    );
  }, []);

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (isInsideEditor(e.relatedTarget)) return;
      commit();
    },
    [isInsideEditor, commit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Keep app/canvas shortcuts (delete node, deselect, ...) out of typing.
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        commit();
      }
    },
    [commit]
  );

  const stopMouseEvent = useCallback((e: React.MouseEvent) => {
    // A click inside the editor must not bubble into React Flow's node click
    // handlers (selection changes, opening the panel editor, ...).
    e.stopPropagation();
  }, []);

  const isEmpty = text.length === 0;
  const textareaStyle = useMemo(
    () => buildTextareaStyle(textStyle, data, isEmpty),
    [textStyle, data, isEmpty]
  );
  const previewNodes = useMarkdownPreview(text);

  const isBold = data.fontWeight === "bold";
  const isItalic = data.fontStyle === "italic";
  const isUnderline = data.textDecoration === "underline";
  const align = data.textAlign ?? "left";
  const fontSize = data.fontSize ?? 14;

  const changeFontSize = useCallback(
    (delta: number) => {
      const current = typeof data.fontSize === "number" ? data.fontSize : 14;
      const next = Math.min(72, Math.max(1, current + delta));
      if (next !== current) onStyleChange?.({ fontSize: next });
    },
    [data.fontSize, onStyleChange]
  );

  return (
    <>
      <NodeToolbar
        nodeId={nodeId}
        isVisible
        position={Position.Top}
        offset={10}
        className="nodrag nopan"
      >
        <Paper
          ref={toolbarRef}
          shadow="md"
          data-testid="free-text-inline-toolbar"
          onKeyDown={handleKeyDown}
          style={{ display: "flex", alignItems: "center", gap: 2, padding: 2 }}
        >
          <ToolbarButton
            title="Bold"
            testId="inline-text-bold"
            active={isBold}
            onClick={() => onStyleChange?.({ fontWeight: isBold ? "normal" : "bold" })}
          >
            <IconBold size={18} />
          </ToolbarButton>
          <ToolbarButton
            title="Italic"
            testId="inline-text-italic"
            active={isItalic}
            onClick={() => onStyleChange?.({ fontStyle: isItalic ? "normal" : "italic" })}
          >
            <IconItalic size={18} />
          </ToolbarButton>
          <ToolbarButton
            title="Underline"
            active={isUnderline}
            onClick={() =>
              onStyleChange?.({ textDecoration: isUnderline ? "none" : "underline" })
            }
          >
            <IconUnderline size={18} />
          </ToolbarButton>
          <Divider orientation="vertical" style={{ marginInline: 4, height: 24, alignSelf: "center" }} />
          <ToolbarButton
            title="Align Left"
            active={align === "left"}
            onClick={() => onStyleChange?.({ textAlign: "left" })}
          >
            <IconAlignLeft size={18} />
          </ToolbarButton>
          <ToolbarButton
            title="Align Center"
            active={align === "center"}
            onClick={() => onStyleChange?.({ textAlign: "center" })}
          >
            <IconAlignCenter size={18} />
          </ToolbarButton>
          <ToolbarButton
            title="Align Right"
            active={align === "right"}
            onClick={() => onStyleChange?.({ textAlign: "right" })}
          >
            <IconAlignRight size={18} />
          </ToolbarButton>
          <Divider orientation="vertical" style={{ marginInline: 4, height: 24, alignSelf: "center" }} />
          <ToolbarButton title="Smaller text" onClick={() => changeFontSize(-1)}>
            <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>A−</span>
          </ToolbarButton>
          <ToolbarButton title="Larger text" onClick={() => changeFontSize(1)}>
            <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1 }}>A+</span>
          </ToolbarButton>
          <span
            style={{ fontSize: 11, opacity: 0.7, minWidth: 26, textAlign: "center" }}
            data-testid="inline-text-font-size"
          >
            {fontSize}
          </span>
          {onOpenStyleEditor && (
            <>
              <Divider orientation="vertical" style={{ marginInline: 4, height: 24, alignSelf: "center" }} />
              <ToolbarButton
                title="More styling options…"
                testId="inline-text-more"
                onClick={() => {
                  // Opens the style drawer alongside; inline editing continues
                  // (the drawer and the inline editor stay in sync via commits).
                  onOpenStyleEditor(textRef.current);
                }}
              >
                <IconAdjustments size={18} />
              </ToolbarButton>
            </>
          )}
        </Paper>
      </NodeToolbar>
      <textarea
        ref={textareaRef}
        className="nodrag nowheel nopan free-text-inline-textarea"
        data-testid="free-text-inline-input"
        value={text}
        placeholder="Type text… (Markdown supported)"
        style={textareaStyle}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={stopMouseEvent}
        onDoubleClick={stopMouseEvent}
        onContextMenu={stopMouseEvent}
      />
      {previewNodes !== null && (
        <InlinePreviewCard nodeId={nodeId} textStyle={textStyle}>
          {previewNodes}
        </InlinePreviewCard>
      )}
    </>
  );
};
