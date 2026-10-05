/* eslint-disable import-x/max-dependencies -- Keep individual icon imports tree-shakeable. */
import React, { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import FolderIcon from "@mui/icons-material/Folder";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlined";
import LightModeIcon from "@mui/icons-material/LightMode";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import ScienceIcon from "@mui/icons-material/Science";
import TuneIcon from "@mui/icons-material/Tune";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import type { ExplorerSectionId } from "../explorer/shared/explorer/types";
import { useHorizontalResize } from "../hooks/ui/useHorizontalResize";
import { floatingSurfaceSx, headerBarHeight } from "../theme/surfaces";
import { RailLogo } from "./RailLogo";
import { RailPinnedContext, WorkspaceRailItem } from "./WorkspaceRailItem";

const Explorer = lazy(async () => ({ default: (await import("../explorer")).ContainerlabExplorerView }));
const SECTIONS: Record<SidebarView, readonly ExplorerSectionId[]> = {
  labs: ["runningLabs", "localLabs"],
  files: ["fileExplorer"]
};
const VIEWS = [
  { id: "labs", label: "Labs", icon: <ScienceIcon fontSize="small" /> },
  { id: "files", label: "Files", icon: <FolderIcon fontSize="small" /> }
] as const;
const RAIL_WIDTH = 48;
const EXPANDED_RAIL_WIDTH = 196;
const PREFERENCES_KEY = "clab.workspace.sidebar.v1";
const WIDTH_MOTION = "width 160ms cubic-bezier(0.4, 0, 0.2, 1), left 160ms cubic-bezier(0.4, 0, 0.2, 1)";
const REDUCE_MOTION = { "@media (prefers-reduced-motion: reduce)": { transition: "none" } } as const;
const RAIL_BORDER = "var(--vscode-panel-border, var(--clab-ui-panel-border, #888))";
const VERTICAL_BORDERS = {
  borderTop: 0,
  borderBottom: 0,
  borderLeft: `1px solid ${RAIL_BORDER}`,
  borderRight: `1px solid ${RAIL_BORDER}`
} as const;

type SidebarView = (typeof VIEWS)[number]["id"];

function readPreferences(): { pinned: boolean; width: number } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return { pinned: false, width: 280 };
    return {
      pinned: "pinned" in value && value.pinned === true,
      width: "width" in value && typeof value.width === "number" && Number.isFinite(value.width) && value.width >= 280
        ? value.width : 280
    };
  } catch {
    return { pinned: false, width: 280 };
  }
}

/** Standalone rail around the same explorer view VS Code shows in its sidebar. */
export function WorkspaceSidebar({ colorScheme, hideLogo = false, onColorSchemeChange, onOpenSettings, tabs }: {
  colorScheme: "light" | "dark";
  /** Omit the rail's logo row when the host already shows the logo, such as in a title bar. */
  hideLogo?: boolean;
  onColorSchemeChange: (scheme: "light" | "dark") => void;
  onOpenSettings: () => void;
  tabs?: ReactNode;
}) {
  const [view, setView] = useState<SidebarView>("labs");
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState(readPreferences);
  const savePreferences = (next: typeof preferences) => {
    setPreferences(next);
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); } catch { /* Storage can be disabled. */ }
  };
  const navRef = useRef<HTMLElement>(null);
  const { ref, width: panelWidth, separatorProps, availableWidth, isDragging } = useHorizontalResize({
    initialWidth: preferences.width,
    minimumWidth: 280,
    maximumWidth: (width) => Math.min(width / 2, width * 0.65 - (preferences.pinned && width >= 720 ? EXPANDED_RAIL_WIDTH : RAIL_WIDTH)),
    onCommit: (width) => savePreferences({ ...preferences, width })
  });
  const pinned = preferences.pinned && availableWidth >= 720;
  const railWidth = pinned ? EXPANDED_RAIL_WIDTH : RAIL_WIDTH;
  const themeLabel = colorScheme === "dark" ? "Light mode" : "Dark mode";
  const pinLabel = preferences.pinned ? "Unpin" : "Pin";
  const selectView = (id: SidebarView) => {
    if (open && view === id) {
      setOpen(false);
      return;
    }
    setView(id);
    setOpen(true);
  };
  const closeExplorer = () => {
    setOpen(false);
    navRef.current?.querySelector<HTMLButtonElement>(`button[aria-expanded="true"]`)?.focus();
  };

  return (
    // The sidebar owns the space the pinned rail and the open panel cover, so the editor sits beside them.
    <Box
      ref={ref}
      data-testid="workspace-sidebar"
      style={{ width: railWidth + (open ? panelWidth : 0) }}
      sx={{
        display: "flex", flexShrink: 0, alignSelf: "stretch", height: "100%", minHeight: 0, maxWidth: "65%",
        position: "relative", zIndex: 8, userSelect: isDragging ? "none" : undefined,
        transition: isDragging ? "none" : WIDTH_MOTION,
        ...REDUCE_MOTION
      }}
    >
      <Box sx={{
        width: railWidth, flexShrink: 0, alignSelf: "stretch", height: "100%", position: "relative", zIndex: 3,
        transition: WIDTH_MOTION,
        ...REDUCE_MOTION
      }}>
        <RailPinnedContext.Provider value={pinned}>
        <Box
          ref={navRef}
          component="nav"
          aria-label="Workspace"
          data-testid="workspace-rail"
          data-pinned={pinned}
          sx={{
            ...floatingSurfaceSx,
            ...VERTICAL_BORDERS,
            position: "absolute",
            inset: "0 auto 0 0",
            width: railWidth,
            overflowX: pinned ? "hidden" : "visible",
            overflowY: "clip",
            py: 1,
            display: "flex",
            flexDirection: "column",
            gap: 0.75,
            transition: WIDTH_MOTION,
            ...REDUCE_MOTION
          }}
        >
          {!hideLogo && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mx: 0.75, overflow: "hidden", height: 36, flexShrink: 0 }}>
              <Box sx={{ width: 36, flexShrink: 0 }}><RailLogo showTooltip={!pinned} /></Box>
              <Typography noWrap variant="body1" sx={{ fontWeight: 600 }}>Containerlab</Typography>
            </Box>
          )}
          {VIEWS.map(({ id, label, icon }) => (
            <WorkspaceRailItem key={id} pinned={pinned} label={label} active={open && view === id} expanded={open && view === id} controls="workspace-explorer" onClick={() => selectView(id)}>{icon}</WorkspaceRailItem>
          ))}
          {tabs ? <Divider sx={{ mx: 1.5, my: 0.5 }} /> : null}
          <Box sx={{
            flex: 1, minHeight: 0, alignSelf: "stretch",
            overflowX: pinned ? "hidden" : "visible",
            overflowY: pinned ? "auto" : "visible"
          }}>
            {tabs}
          </Box>
          <WorkspaceRailItem pinned={pinned} label="Help & Feedback" onClick={() => window.open("https://containerlab.app", "_blank", "noopener,noreferrer")}>
            <HelpOutlineIcon fontSize="small" />
          </WorkspaceRailItem>
          <WorkspaceRailItem pinned={pinned} label={themeLabel} onClick={() => onColorSchemeChange(colorScheme === "dark" ? "light" : "dark")}>
            {colorScheme === "dark" ? <DarkModeIcon fontSize="small" /> : <LightModeIcon fontSize="small" />}
          </WorkspaceRailItem>
          <WorkspaceRailItem pinned={pinned} label="Settings" testId="standalone-settings-button" onClick={onOpenSettings}>
            <TuneIcon fontSize="small" />
          </WorkspaceRailItem>
          <WorkspaceRailItem pinned={pinned} label={pinLabel} active={preferences.pinned} testId="workspace-sidebar-pin" onClick={() => savePreferences({ ...preferences, pinned: !preferences.pinned })}>
            {pinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
          </WorkspaceRailItem>
        </Box>
        </RailPinnedContext.Provider>
      </Box>
      <Box
        id="workspace-explorer"
        aria-hidden={!open}
        {...(!open ? { inert: true } : {})}
        style={{ width: open ? panelWidth : 0 }}
        sx={{
          position: "absolute",
          left: railWidth,
          top: 0,
          bottom: 0,
          zIndex: 2,
          overflow: "hidden",
          pointerEvents: open ? "auto" : "none",
          transition: isDragging ? "none" : WIDTH_MOTION,
          ...REDUCE_MOTION
        }}
      >
        <Box sx={{
          ...floatingSurfaceSx,
          ...VERTICAL_BORDERS,
          width: panelWidth,
          height: "100%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column"
        }}>
          <Box sx={{ display: "flex", alignItems: "center", px: 1, height: headerBarHeight, flexShrink: 0, borderBottom: `1px solid ${RAIL_BORDER}` }}>
            <Typography noWrap variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>{VIEWS.find((entry) => entry.id === view)?.label}</Typography>
            <IconButton size="small" aria-label="Close explorer" onClick={closeExplorer}><CloseIcon fontSize="small" /></IconButton>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <Suspense fallback={<Typography sx={{ p: 2 }} variant="body2" color="text.secondary">Loading explorer…</Typography>}>
              <Explorer key={view} visibleSectionIds={SECTIONS[view]} />
            </Suspense>
          </Box>
        </Box>
        <Box {...separatorProps} aria-label="Resize sidebar" aria-controls="workspace-explorer" sx={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: 4, cursor: "col-resize", touchAction: "none", zIndex: 2,
          bgcolor: isDragging ? "primary.main" : undefined,
          "&:hover, &:focus-visible": { bgcolor: "primary.main" }
        }} />
      </Box>
    </Box>
  );
}
