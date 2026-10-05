import React, { useEffect, useRef } from "react";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import type { LabTab } from "../state/labTabsStore";
import type { TabOrientation } from "../state/themePreferences";
import { controlRadius, headerBarHeight } from "../../theme/surfaces";

const FOCUS_RING = "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))";
const STATE_MOTION = "background-color 120ms ease, color 120ms ease, opacity 120ms ease";
// Keeps the " *" dirty marker in the tab's accessible name while the dot shows it visually.
const VISUALLY_HIDDEN = {
  position: "absolute", width: 1, height: 1, p: 0, m: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0
} as const;
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
      className="lab-tab-close"
      sx={{ width: 20, height: 20, p: 0, flexShrink: 0, borderRadius: 1, color: "inherit" }}
    >
      <CloseIcon sx={{ fontSize: 14 }} />
    </IconButton>
  );
}

function TabIcon({ kind, dirty = false, fontSize }: { kind: LabTab["kind"]; dirty?: boolean; fontSize: number }) {
  const Icon = kind === "topology" ? AccountTreeOutlinedIcon : DescriptionOutlinedIcon;
  return (
    <Box component="span" sx={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <Icon sx={{ fontSize }} />
      {dirty ? (
        <Box aria-hidden="true" sx={{
          position: "absolute", top: -2, right: -3, width: 6, height: 6, borderRadius: "50%", bgcolor: "currentColor"
        }} />
      ) : null}
    </Box>
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
      display: "flex", alignItems: "center", width: "100%", height: headerBarHeight, flexShrink: 0,
      gap: 0.5, px: 1, overflowX: "auto", overflowY: "hidden",
      bgcolor: "background.default", borderBottom: 1, borderColor: "divider",
      // A hairline scrollbar keeps overflowing tabs reachable without crowding the bar.
      "&::-webkit-scrollbar": { height: 4 },
      "&::-webkit-scrollbar-thumb": { border: 0 }
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
              <TabIcon kind={tab.kind} dirty={dirty} fontSize={20} />
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
              display: "flex", alignItems: "center", gap: 0.75, flex: "0 1 auto", minWidth: 96, maxWidth: 220, height: 28, pl: 1, pr: 0.5,
              position: "relative", overflow: "hidden", borderRadius: controlRadius, cursor: "pointer", userSelect: "none",
              color: active ? "text.primary" : "text.secondary",
              bgcolor: active ? "action.selected" : "transparent",
              transition: STATE_MOTION,
              "&:hover": { bgcolor: active ? "action.selected" : "action.hover", color: "text.primary" },
              "&:focus-visible": { outline: FOCUS_RING, outlineOffset: -1 },
              // Inactive tabs reveal their close button on hover; unsaved tabs show a dot in its place.
              "& .lab-tab-close": { opacity: active && !dirty ? 1 : 0, transition: STATE_MOTION },
              "& .lab-tab-dirty": { opacity: dirty ? 1 : 0, transition: STATE_MOTION },
              "&:hover .lab-tab-close, &:focus-within .lab-tab-close": { opacity: 1 },
              "&:hover .lab-tab-dirty, &:focus-within .lab-tab-dirty": { opacity: 0 },
              "@media (prefers-reduced-motion: reduce)": { transition: "none", "& .lab-tab-close, & .lab-tab-dirty": { transition: "none" } }
            }}>
            <TabIcon kind={tab.kind} fontSize={16} />
            <Typography component="span" variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0, color: "inherit" }}>
              {tab.title}{dirty ? <Box component="span" sx={VISUALLY_HIDDEN}> *</Box> : null}
            </Typography>
            {endpointLabels.size > 1 && <Typography component="span" variant="caption" noWrap sx={{ flexShrink: 0, color: "text.secondary" }}>
              {endpointLabels.get(tab.endpointId) ?? tab.endpointId}
            </Typography>}
            <Box sx={{ position: "relative", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Box aria-hidden="true" className="lab-tab-dirty" sx={{
                position: "absolute", width: 8, height: 8, borderRadius: "50%", bgcolor: "currentColor", pointerEvents: "none"
              }} />
              <TabCloseButton title={tab.title} tabId={tab.id} onClose={close} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
