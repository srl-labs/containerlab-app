import React, { useEffect, useRef } from "react";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CloseIcon from "@mui/icons-material/Close";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import type { LabTab } from "../state/labTabsStore";
import type { TabOrientation } from "../state/themePreferences";
import { floatingRadius, floatingSurfaceSx } from "../../theme/surfaces";
import { useRailPinned, WorkspaceRailItem } from "../WorkspaceRailItem";

interface LabTabsBarProps {
  activeTabId: string | null;
  endpointLabels: ReadonlyMap<string, string>;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  orientation?: TabOrientation;
  tabs: LabTab[];
}

function tabLabel(tab: LabTab, dirty: boolean, endpointLabels: ReadonlyMap<string, string>): string {
  const title = `${tab.title}${dirty ? " *" : ""}`;
  if (endpointLabels.size <= 1) return title;
  return `${title} · ${endpointLabels.get(tab.endpointId) ?? tab.endpointId}`;
}

function TabCloseButton({ title, tabId, onClose }: { title: string; tabId: string; onClose: (id: string) => void }) {
  return (
    <IconButton
      size="small"
      aria-label={`Close ${title}`}
      data-testid={`lab-tab-close-${tabId}`}
      onClick={(event) => {
        event.stopPropagation();
        onClose(tabId);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      sx={{
        width: 22,
        height: 22,
        p: 0,
        flexShrink: 0,
        color: "inherit",
        "&:hover": { bgcolor: "action.hover" }
      }}
    >
      <CloseIcon sx={{ fontSize: 14 }} />
    </IconButton>
  );
}

/** Document tabs for hosts without native tabs. VS Code keeps its own editor tabs. */
export function LabTabsBar({ activeTabId, endpointLabels, onActivate, onClose, orientation = "horizontal", tabs }: LabTabsBarProps): React.JSX.Element | null {
  const elements = useRef(new Map<string, HTMLElement>());
  const closingTab = useRef<string | null>(null);
  const selectedId = activeTabId ?? tabs[0]?.id;
  const railPinned = useRailPinned();

  useEffect(() => {
    elements.current.get(selectedId ?? "")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (closingTab.current && !tabs.some((tab) => tab.id === closingTab.current)) {
      elements.current.get(selectedId ?? "")?.focus();
      closingTab.current = null;
    }
  }, [selectedId, tabs]);

  const close = (id: string) => {
    if (elements.current.get(id)?.contains(document.activeElement)) closingTab.current = id;
    onClose(id);
  };

  if (tabs.length === 0) return null;
  const vertical = orientation === "vertical";
  const forward = vertical ? "ArrowDown" : "ArrowRight";
  const back = vertical ? "ArrowUp" : "ArrowLeft";

  const bindTab = (tab: LabTab, index: number) => ({
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      let nextIndex: number | undefined;
      if (event.key === forward) nextIndex = (index + 1) % tabs.length;
      else if (event.key === back) nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else if (event.key === "Delete") { event.preventDefault(); close(tab.id); }
      else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(tab.id); }
      if (nextIndex !== undefined) {
        event.preventDefault();
        onActivate(tabs[nextIndex].id);
        elements.current.get(tabs[nextIndex].id)?.focus();
      }
    }
  });

  return (
    <Box role="tablist" aria-label="Open lab tabs" aria-orientation={orientation} data-testid="lab-tabs" sx={vertical ? {
      display: "flex", flexDirection: "column", alignSelf: "stretch", width: "100%", minWidth: 0, gap: 0.75, py: 0.5, overflow: "visible"
    } : {
      display: "flex", alignItems: "center", width: "100%", minHeight: 40, flexShrink: 0,
      gap: 1, px: 1, py: 0.5, overflowX: "auto", overflowY: "hidden",
      bgcolor: "var(--vscode-editor-background, var(--clab-ui-editor-background, #000))",
      borderBottom: "1px solid var(--clab-ui-panel-border, var(--vscode-panel-border, #888))"
    }}>
      {tabs.map((tab, index) => {
        const active = tab.id === selectedId;
        const dirty = tab.kind === "file" && tab.content !== tab.originalContent;
        const tabPath = tab.kind === "file" ? tab.path : tab.topologyRef.yamlPath;
        const keys = bindTab(tab, index);
        if (vertical) {
          return (
            <WorkspaceRailItem
              key={tab.id}
              ref={(element) => {
                if (element) elements.current.set(tab.id, element);
                else elements.current.delete(tab.id);
              }}
              pinned={railPinned}
              label={tabLabel(tab, dirty, endpointLabels)}
              active={active}
              role="tab"
              tabIndex={active ? 0 : -1}
              testId={`lab-tab-${tab.id}`}
              onClick={() => onActivate(tab.id)}
              onKeyDown={keys.onKeyDown}
              trailing={
                <TabCloseButton title={tab.title} tabId={tab.id} onClose={close} />
              }
            >
              {tab.kind === "topology" ? <AccountTreeIcon fontSize="small" /> : <DescriptionOutlinedIcon fontSize="small" />}
            </WorkspaceRailItem>
          );
        }
        return (
          <Box key={tab.id} ref={(element: HTMLDivElement | null) => {
            if (element) elements.current.set(tab.id, element);
            else elements.current.delete(tab.id);
          }} role="tab" tabIndex={active ? 0 : -1} aria-selected={active} aria-keyshortcuts="Delete"
            data-testid={`lab-tab-${tab.id}`} title={tabPath}
            onClick={() => onActivate(tab.id)}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(tab.id); } }}
            onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
            onKeyDown={keys.onKeyDown}
            sx={{
              display: "flex", alignItems: "center", gap: 1, flex: "1 1 0", minWidth: 80, maxWidth: 240, height: 32, px: 1.25,
              overflow: "hidden", ...floatingSurfaceSx, borderRadius: floatingRadius, cursor: "pointer", userSelect: "none",
              color: active ? "primary.main" : "text.primary",
              bgcolor: active ? "action.selected" : floatingSurfaceSx.bgcolor,
              "&:hover": { bgcolor: active ? "action.selected" : "action.hover" },
              "&:focus-visible": { outline: "1px solid var(--clab-ui-focus-border)", outlineOffset: 2 }
            }}>
            <Box component="span" sx={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1, textAlign: "left" }}>
              {tab.title}{dirty ? " *" : ""}
            </Box>
            {endpointLabels.size > 1 && <Box component="span" sx={{ fontSize: 10, px: 0.5, borderRadius: 1, border: "1px solid var(--clab-ui-panel-border)", whiteSpace: "nowrap" }}>
              {endpointLabels.get(tab.endpointId) ?? tab.endpointId}
            </Box>}
            <TabCloseButton title={tab.title} tabId={tab.id} onClose={close} />
          </Box>
        );
      })}
    </Box>
  );
}
