import React, { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import CloseIcon from "@mui/icons-material/Close";
import type { LabTab } from "../state/labTabsStore";

interface LabTabsBarProps {
  activeTabId: string | null;
  endpointLabels: ReadonlyMap<string, string>;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  tabs: LabTab[];
}

/** Document tabs for hosts without native tabs. VS Code keeps its own editor tabs. */
export function LabTabsBar({ activeTabId, endpointLabels, onActivate, onClose, tabs }: LabTabsBarProps): React.JSX.Element | null {
  const elements = useRef(new Map<string, HTMLDivElement>());
  const closingTab = useRef<string | null>(null);
  const selectedId = activeTabId ?? tabs[0]?.id;

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
  return (
    <Box role="tablist" aria-label="Open lab tabs" aria-orientation="horizontal" data-testid="lab-tabs" sx={{
      display: "flex", alignItems: "stretch", width: "100%", minHeight: 36, flexShrink: 0,
      borderBottom: "1px solid var(--clab-ui-panel-border)", overflowX: "auto", overflowY: "hidden",
      bgcolor: "var(--vscode-editorGroupHeader-tabsBackground, var(--clab-ui-panel-background))"
    }}>
      {tabs.map((tab, index) => {
        const active = tab.id === selectedId;
        const dirty = tab.kind === "file" && tab.content !== tab.originalContent;
        const tabPath = tab.kind === "file" ? tab.path : tab.topologyRef.yamlPath;
        return (
          <Box key={tab.id} ref={(element: HTMLDivElement | null) => {
            if (element) elements.current.set(tab.id, element);
            else elements.current.delete(tab.id);
          }} role="tab" tabIndex={active ? 0 : -1} aria-selected={active} aria-keyshortcuts="Delete"
            data-testid={`lab-tab-${tab.id}`} title={tabPath}
            onClick={() => onActivate(tab.id)}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(tab.id); } }}
            onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              let nextIndex: number | undefined;
              if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
              else if (event.key === "Home") nextIndex = 0;
              else if (event.key === "End") nextIndex = tabs.length - 1;
              else if (event.key === "Delete") { event.preventDefault(); close(tab.id); }
              else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(tab.id); }
              if (nextIndex !== undefined) {
                event.preventDefault();
                onActivate(tabs[nextIndex].id);
                elements.current.get(tabs[nextIndex].id)?.focus();
              }
            }}
            sx={{
              display: "flex", alignItems: "center", gap: 1, minWidth: 120, maxWidth: 300, px: 1,
              borderRight: "1px solid var(--clab-ui-panel-border)", borderTop: "2px solid",
              borderTopColor: active ? "var(--vscode-tab-activeBorderTop, var(--clab-ui-focus-border))" : "transparent",
              bgcolor: active ? "var(--vscode-tab-activeBackground, var(--clab-ui-editor-background))" : "var(--vscode-tab-inactiveBackground, var(--clab-ui-panel-background))",
              color: active ? "var(--vscode-tab-activeForeground, var(--clab-ui-editor-foreground))" : "var(--vscode-tab-inactiveForeground, var(--vscode-descriptionForeground))",
              cursor: "pointer", userSelect: "none", flexShrink: 0,
              "&:hover": { bgcolor: "var(--vscode-tab-hoverBackground, var(--vscode-list-hoverBackground))" },
              "&:focus-visible": { outline: "1px solid var(--clab-ui-focus-border)", outlineOffset: -2 }
            }}>
            <Box component="span" sx={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1 }}>
              {tab.title}{dirty ? " *" : ""}
            </Box>
            {endpointLabels.size > 1 && <Box component="span" sx={{ fontSize: 10, px: 0.5, borderRadius: 1, border: "1px solid var(--clab-ui-panel-border)", whiteSpace: "nowrap" }}>
              {endpointLabels.get(tab.endpointId) ?? tab.endpointId}
            </Box>}
            <Box component="button" type="button" tabIndex={-1} aria-label={`Close ${tab.title}`} data-testid={`lab-tab-close-${tab.id}`}
              onClick={(event) => { event.stopPropagation(); close(tab.id); }} sx={{
                display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22,
                border: 0, borderRadius: 1, p: 0, color: "inherit", bgcolor: "transparent", cursor: "pointer", flexShrink: 0,
                "&:hover": { bgcolor: "var(--vscode-list-hoverBackground)" }
              }}><CloseIcon sx={{ fontSize: 14 }} /></Box>
          </Box>
        );
      })}
    </Box>
  );
}
