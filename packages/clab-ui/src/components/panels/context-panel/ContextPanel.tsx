/* eslint-disable import-x/max-dependencies */
// Context-sensitive panel with palette, info, and editor tabs.
import React, { useCallback, useRef, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { IconAlertCircle, IconLock } from "@tabler/icons-react";
import { Box, Button, Divider, Text } from "@mantine/core";

import { useIsLocked } from "../../../stores/topoViewerStore";
import type { NodeData, LinkData } from "../../../hooks/ui";
import type { SidebarView } from "../../../hooks/ui/usePanelCommands";
import { useContextPanelContent } from "../../../hooks/ui/useContextPanelContent";

import type {
  ContextPanelEditorState,
  EditorFooterRef,
  EditorBannerRef
} from "./views/editorTypes";
import { PaletteView } from "./views";

const MIN_WIDTH = 320;
function getMaxWidth() {
  return Math.floor(window.innerWidth / 2);
}
const ACTION_HOVER = "var(--vscode-list-hoverBackground)";
const PANEL_BACKGROUND = "var(--clab-ui-panel-background, var(--vscode-sideBar-background))";
const PANEL_FOREGROUND = "var(--clab-ui-editor-foreground, var(--vscode-foreground))";
const PANEL_BORDER = "var(--clab-ui-panel-border, var(--vscode-panel-border))";
const TEXT_SECONDARY = "var(--vscode-descriptionForeground)";
const ERROR_MAIN = "var(--vscode-editorError-foreground)";
const PRIMARY_MAIN = "var(--clab-ui-button-background, var(--vscode-button-background))";
// MUI elevation 4 box-shadow, preserved for the floating panel.
const PANEL_SHADOW =
  "0px 2px 4px -1px rgba(0,0,0,0.2), 0px 4px 5px 0px rgba(0,0,0,0.14), 0px 1px 10px 0px rgba(0,0,0,0.12)";

type BannerRef = EditorBannerRef;
type FooterRef = EditorFooterRef;

interface ContextPanelPaletteProps {
  mode?: "edit" | "view";
  requestedTab?: { tabId: string };
  onEditCustomNode: (name: string) => void;
  onDeleteCustomNode: (name: string) => void;
  onSetDefaultCustomNode: (name: string) => void;
}

interface ContextPanelViewProps {
  selectedNodeData: NodeData | null;
  selectedLinkData: (LinkData & { extraData?: Record<string, unknown> }) | null;
}

interface ContextPanelEditorProps extends ContextPanelEditorState {}

function renderContextPanelContent(
  palette: ContextPanelPaletteProps,
  view: ContextPanelViewProps,
  editor: ContextPanelEditorProps,
  isLocked: boolean,
  setFooterRef: (ref: FooterRef | null) => void,
  setBannerRef: (ref: BannerRef | null) => void
): React.ReactElement {
  return (
    <PaletteView
      {...palette}
      isLocked={isLocked}
      selectedNodeData={view.selectedNodeData}
      selectedLinkData={view.selectedLinkData}
      editor={editor}
      onFooterRef={setFooterRef}
      onBannerRef={setBannerRef}
    />
  );
}

function usePanelResize(sideRef: React.RefObject<string>) {
  const [panelWidth, setPanelWidth] = useState(MIN_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      const onMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const newWidth = sideRef.current === "left" ? ev.clientX : window.innerWidth - ev.clientX;
        setPanelWidth(Math.min(getMaxWidth(), Math.max(MIN_WIDTH, newWidth)));
      };
      const onMouseUp = () => {
        isDraggingRef.current = false;
        setIsDragging(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sideRef]
  );

  return { panelWidth, isDragging, handleResizeStart };
}

function haveFooterHandlersChanged(prev: FooterRef | null, next: FooterRef | null): boolean {
  return (
    prev?.handleApply !== next?.handleApply ||
    prev?.handleSave !== next?.handleSave ||
    prev?.handleDiscard !== next?.handleDiscard
  );
}

function hasFooterRefChanged(prev: FooterRef | null, next: FooterRef | null): boolean {
  if (Boolean(prev) !== Boolean(next)) {
    return true;
  }
  if ((prev?.hasChanges ?? false) !== (next?.hasChanges ?? false)) {
    return true;
  }
  return haveFooterHandlersChanged(prev, next);
}

export interface ContextPanelProps {
  isOpen: boolean;
  side: "left" | "right";
  rfInstance: ReactFlowInstance | null;
  /** Active global-sidebar view; "explorer"/"files" swap the body for {@link renderExplorer}. */
  activeView?: SidebarView;
  /** Renders the Explorer body when the active view is "explorer" or "files". */
  renderExplorer?: (view: SidebarView) => React.ReactNode;
  palette: ContextPanelPaletteProps;
  view: ContextPanelViewProps;
  editor: ContextPanelEditorProps;
}

// UI composition component with banner/footer/view-switch conditionals.
/* eslint-disable complexity */
export const ContextPanel: React.FC<ContextPanelProps> = ({
  isOpen,
  side,
  activeView = "palette",
  renderExplorer,
  palette,
  view,
  editor
}) => {
  const panelView = useContextPanelContent();
  const isLocked = useIsLocked();
  const isExplorer = activeView === "explorer" || activeView === "files";
  const isReadOnly = isLocked && panelView.hasFooter;
  const footerRef = useRef<FooterRef | null>(null);
  const bannerRef = useRef<BannerRef | null>(null);
  const [, forceUpdate] = useState(0);
  const isLeft = side === "left";
  const sideRef = useRef(side);
  sideRef.current = side;
  const { panelWidth, handleResizeStart } = usePanelResize(sideRef);

  const setFooterRef = useCallback((ref: FooterRef | null) => {
    const changed = hasFooterRefChanged(footerRef.current, ref);
    footerRef.current = ref;
    if (changed) {
      forceUpdate((n) => n + 1);
    }
  }, []);

  const setBannerRef = useCallback((ref: BannerRef | null) => {
    bannerRef.current = ref;
    forceUpdate((n) => n + 1);
  }, []);

  const sideLayout = isLeft
    ? { border: "borderRight" as const, resize: "right" as const }
    : { border: "borderLeft" as const, resize: "left" as const };

  const content = renderContextPanelContent(
    palette,
    view,
    editor,
    isLocked,
    setFooterRef,
    setBannerRef
  );

  const footer = footerRef.current;
  const showFooter = panelView.hasFooter && footer?.hasChanges === true;

  const paperStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    [isLeft ? "left" : "right"]: 0,
    width: panelWidth,
    display: isOpen ? "flex" : "none",
    flexDirection: "column",
    backgroundColor: PANEL_BACKGROUND,
    color: PANEL_FOREGROUND,
    boxShadow: PANEL_SHADOW,
    [sideLayout.border]: `1px solid ${PANEL_BORDER}`,
    pointerEvents: "auto"
  };

  return (
    <Box
      data-testid="context-panel"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1200,
        pointerEvents: "none"
      }}
    >
      <div style={paperStyle}>
        {isLocked && !isExplorer && (
          <>
            <Box
              data-testid="panel-readonly-indicator"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                paddingLeft: 16,
                paddingRight: 16,
                paddingTop: 4,
                paddingBottom: 4,
                backgroundColor: ACTION_HOVER,
                color: TEXT_SECONDARY
              }}
            >
              <IconLock size={14} />
              <Text size="xs">Read-only — unlock lab to edit</Text>
            </Box>
            <Divider />
          </>
        )}

        {!isExplorer &&
          bannerRef.current &&
          bannerRef.current.errors.map((err, i) => (
            <React.Fragment key={i}>
              <Box
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  paddingLeft: 16,
                  paddingRight: 16,
                  paddingTop: 4,
                  paddingBottom: 4,
                  backgroundColor: ACTION_HOVER,
                  color: ERROR_MAIN
                }}
              >
                <IconAlertCircle size={14} />
                <Text size="xs">{err}</Text>
              </Box>
              <Divider />
            </React.Fragment>
          ))}

        <Box
          style={{
            flexGrow: 1,
            minHeight: 0,
            overflow: "auto"
          }}
        >
          {isExplorer ? renderExplorer?.(activeView) : content}
        </Box>

        {!isExplorer && showFooter === true && !isReadOnly && (
          <>
            <Divider />
            <Box style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: 12 }}>
              <Button size="xs" onClick={footer.handleApply} data-testid="panel-apply-btn">
                Apply
              </Button>
            </Box>
          </>
        )}

        <div
          onMouseDown={handleResizeStart}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = PRIMARY_MAIN;
            e.currentTarget.style.opacity = "0.3";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.opacity = "1";
          }}
          style={{
            position: "absolute",
            [sideLayout.resize]: 0,
            top: 0,
            bottom: 0,
            width: 4,
            cursor: "col-resize",
            zIndex: 1
          }}
        />
      </div>
    </Box>
  );
};
/* eslint-enable complexity */
