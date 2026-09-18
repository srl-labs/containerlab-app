/* eslint-disable import-x/max-dependencies -- Keep individual icon imports tree-shakeable. */
import React, { lazy, memo, Suspense, useId, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import ScienceIcon from "@mui/icons-material/Science";
import FolderIcon from "@mui/icons-material/Folder";
import TuneIcon from "@mui/icons-material/Tune";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlined";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import CloseIcon from "@mui/icons-material/Close";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import Typography from "@mui/material/Typography";
import type { ExplorerSectionId } from "../explorer/shared/explorer/types";
import { useHorizontalResize } from "../hooks/ui/useHorizontalResize";
import { floatingSurfaceSx } from "../theme/surfaces";
import { RailLogo } from "./RailLogo";
import { WorkspaceRailItem } from "./WorkspaceRailItem";

const Explorer = memo(lazy(async () => ({ default: (await import("../explorer")).ContainerlabExplorerView })));
Explorer.displayName = "WorkspaceExplorer";
const SECTIONS: Record<SidebarView, ExplorerSectionId[]> = {
  labs: ["runningLabs", "localLabs"],
  files: ["fileExplorer"],
  help: ["helpFeedback"]
};
const VIEWS = [
  { id: "labs", label: "Labs", icon: <ScienceIcon /> },
  { id: "files", label: "File Explorer", icon: <FolderIcon /> },
  { id: "help", label: "Help & Feedback", icon: <HelpOutlineIcon /> }
] as const;
const RAIL_WIDTH = 48;
const EXPANDED_RAIL_WIDTH = 196;
const PREFERENCES_KEY = "clab.workspace.sidebar.v1";
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

/** Standalone composition of the same explorer used in VS Code. */
export function WorkspaceSidebar({ colorScheme, onColorSchemeChange, onOpenSettings }: {
  colorScheme: "light" | "dark";
  onColorSchemeChange: (scheme: "light" | "dark") => void;
  onOpenSettings: () => void;
}) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [view, setView] = useState<SidebarView>("labs");
  const [open, setOpen] = useState(true);
  const navRef = useRef<HTMLElement>(null);
  const explorerId = useId();
  const savePreferences = (next: typeof preferences) => {
    setPreferences(next);
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); } catch { /* Storage can be disabled. */ }
  };
  const { ref, width: panelWidth, separatorProps, availableWidth, isDragging } = useHorizontalResize({
    initialWidth: preferences.width,
    minimumWidth: 280,
    maximumWidth: (width) => Math.min(width / 2, width * 0.65 - (preferences.pinned && width >= 720 ? EXPANDED_RAIL_WIDTH : RAIL_WIDTH)),
    onCommit: (width) => savePreferences({ ...preferences, width })
  });
  // Keep the pin preference when a narrow window temporarily needs the compact rail.
  const pinned = preferences.pinned && availableWidth >= 720;
  const themeLabel = colorScheme === "dark" ? "Light mode" : "Dark mode";
  const selectView = (next: SidebarView) => {
    setOpen(!open || view !== next);
    setView(next);
  };

  return (
    <Box ref={ref} data-testid="workspace-sidebar" sx={{ display: "flex", flexShrink: 0, minHeight: 0, maxWidth: "65%", zIndex: 8, userSelect: isDragging ? "none" : undefined }}>
      <Box sx={{ width: pinned ? EXPANDED_RAIL_WIDTH : RAIL_WIDTH, flexShrink: 0, position: "relative", zIndex: 1 }}>
        <Box
          ref={navRef}
          component="nav"
          aria-label="Workspace"
          data-testid="workspace-rail"
          data-pinned={pinned}
          sx={{
            ...floatingSurfaceSx, borderWidth: "0 1px 0 0",
            position: "absolute", inset: "0 auto 0 0", width: pinned ? EXPANDED_RAIL_WIDTH : RAIL_WIDTH,
            bgcolor: "background.default", backdropFilter: "none", WebkitBackdropFilter: "none",
            overflowX: "visible", overflowY: "clip",
            py: 1, display: "flex", flexDirection: "column", gap: 0.75
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mx: 0.75, overflow: "hidden", height: 36, flexShrink: 0 }}>
            <Box sx={{ width: 36, flexShrink: 0 }}><RailLogo showTooltip={!pinned} /></Box>
            {pinned && <Typography noWrap variant="body2" sx={{ fontWeight: 600 }}>Containerlab</Typography>}
          </Box>
          {VIEWS.map(({ id, label, icon }) => (
            <WorkspaceRailItem key={id} pinned={pinned} label={label} active={open && view === id} expanded={open && view === id} controls={explorerId} onClick={() => selectView(id)}>{icon}</WorkspaceRailItem>
          ))}
          <Box sx={{ flex: 1 }} />
          <WorkspaceRailItem pinned={pinned} label={themeLabel} onClick={() => onColorSchemeChange(colorScheme === "dark" ? "light" : "dark")}>
            {colorScheme === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
          </WorkspaceRailItem>
          <WorkspaceRailItem pinned={pinned} label="Settings" testId="standalone-settings-button" onClick={onOpenSettings}><TuneIcon /></WorkspaceRailItem>
          <WorkspaceRailItem pinned={pinned} label={preferences.pinned ? "Unpin rail" : "Pin rail"} active={preferences.pinned} onClick={() => {
            savePreferences({ ...preferences, pinned: !preferences.pinned });
          }}>{preferences.pinned ? <PushPinIcon /> : <PushPinOutlinedIcon />}</WorkspaceRailItem>
        </Box>
      </Box>
      <Box id={explorerId} hidden={!open} style={{ width: panelWidth }} sx={{
        ...floatingSurfaceSx, borderWidth: "0 1px 0 0", minWidth: 0,
        bgcolor: "background.default", backdropFilter: "none", WebkitBackdropFilter: "none",
        display: open ? "flex" : "none", flexDirection: "column", position: "relative"
      }}>
        <Box sx={{ display: "flex", alignItems: "center", px: 1, minHeight: 36 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>{VIEWS.find((entry) => entry.id === view)?.label}</Typography>
          <IconButton size="small" aria-label="Close explorer" onClick={() => {
            setOpen(false);
            navRef.current?.querySelector<HTMLButtonElement>(`button[aria-expanded="true"]`)?.focus();
          }}><CloseIcon fontSize="small" /></IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <Suspense fallback={<Typography sx={{ p: 2 }} variant="body2" color="text.secondary">Loading explorer…</Typography>}>
            <Explorer visibleSectionIds={SECTIONS[view]} />
          </Suspense>
        </Box>
        <Box {...separatorProps} aria-label="Resize sidebar" aria-controls={explorerId} sx={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: 4, cursor: "col-resize", touchAction: "none", zIndex: 2,
          bgcolor: isDragging ? "primary.main" : undefined,
          "&:hover, &:focus-visible": { bgcolor: "primary.main" }
        }} />
      </Box>
    </Box>
  );
}
