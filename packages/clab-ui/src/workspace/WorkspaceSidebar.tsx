import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import ScienceIcon from "@mui/icons-material/Science";
import FolderIcon from "@mui/icons-material/Folder";
import TuneIcon from "@mui/icons-material/Tune";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlined";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import CloseIcon from "@mui/icons-material/Close";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import Typography from "@mui/material/Typography";
import type { ExplorerSectionId } from "../explorer/shared/explorer/types";
import { useWorkspaceLayout } from "../host/workspaceLayoutContext";
import { floatingSurfaceSx } from "../theme/surfaces";
import { useLabTabsStore } from "./state/labTabsStore";
import { RailLogo } from "./RailLogo";

const Explorer = lazy(async () => ({ default: (await import("../explorer")).ContainerlabExplorerView }));
const NodePalette = lazy(async () => ({ default: (await import("../components/panels/lab-drawer/NodePalette")).NodePalette }));
const SECTIONS: Record<string, ExplorerSectionId[]> = {
  labs: ["runningLabs", "localLabs"],
  files: ["fileExplorer"],
  help: ["helpFeedback"]
};
const VIEWS = [
  { id: "labs", label: "Labs", icon: <ScienceIcon /> },
  { id: "files", label: "File Explorer", icon: <FolderIcon /> },
  { id: "palette", label: "Node palette", icon: <EditOutlinedIcon /> },
  { id: "help", label: "Help & Feedback", icon: <HelpOutlineIcon /> }
] as const;

function useSidebarResize(side: "left" | "right") {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [width, setWidth] = useState(280);
  const [availableWidth, setAvailableWidth] = useState(window.innerWidth);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const max = Math.max(0, Math.min(availableWidth / 2, availableWidth * 0.65 - 48));
  const min = Math.min(280, max);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const panelWidth = clamp(width);
  const direction = side === "left" ? 1 : -1;
  return {
    ref, panelWidth,
    separatorProps: {
      role: "separator",
      tabIndex: 0,
      "aria-label": "Resize sidebar",
      "aria-orientation": "vertical" as const,
      "aria-controls": "workspace-explorer",
      "aria-valuemin": Math.round(min),
      "aria-valuemax": Math.round(max),
      "aria-valuenow": Math.round(panelWidth),
      onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: panelWidth };
      },
      onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
        if (drag.current) setWidth(clamp(drag.current.width + (event.clientX - drag.current.x) * direction));
      },
      onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onLostPointerCapture() { drag.current = null; },
      onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        const delta = ({ ArrowRight: 20, ArrowLeft: -20 } as Record<string, number>)[event.key] ?? 0;
        if (!delta && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        if (event.key === "Home") setWidth(min);
        else if (event.key === "End") setWidth(max);
        else setWidth(clamp(panelWidth + delta * direction));
      }
    }
  };
}

/** Standalone composition of the same explorer and palette used in VS Code. */
export function WorkspaceSidebar({ colorScheme, onColorSchemeChange, onOpenSettings }: {
  colorScheme: "light" | "dark";
  onColorSchemeChange: (scheme: "light" | "dark") => void;
  onOpenSettings: () => void;
}) {
  const layout = useWorkspaceLayout();
  if (!layout) throw new Error("WorkspaceHostProvider is required for WorkspaceSidebar.");
  const { side, view, setView, toggleSide } = layout;
  const hasTopology = useLabTabsStore((state) => state.tabs.some((tab) => tab.id === state.activeTabId && tab.kind === "topology"));
  useEffect(() => {
    if (!hasTopology && view === "palette") setView(null);
  }, [hasTopology, view, setView]);
  const { ref, panelWidth, separatorProps } = useSidebarResize(side);
  const visibleView = view === "palette" && !hasTopology ? null : view;
  const tooltipSide = side === "left" ? "right" : "left";
  const borderWidth = side === "left" ? "0 1px 0 0" : "0 0 0 1px";
  return (
    <Box ref={ref} data-testid="workspace-sidebar" sx={{ display: "flex", flexDirection: side === "left" ? "row" : "row-reverse", flexShrink: 0, minHeight: 0, maxWidth: "65%", zIndex: 8 }}>
      <Box component="nav" aria-label="Workspace" sx={{ ...floatingSurfaceSx, borderWidth, width: 48, flexShrink: 0, py: 1, display: "flex", alignItems: "center", flexDirection: "column", gap: 0.75 }}>
        <RailLogo showTooltip side={side} />
        {VIEWS.filter(({ id }) => id !== "palette" || hasTopology).map(({ id, label, icon }) => (
          <Tooltip disableInteractive key={id} title={label} placement={tooltipSide}>
            <IconButton aria-label={label} aria-pressed={visibleView === id} aria-controls="workspace-explorer" onClick={() => setView(visibleView === id ? null : id)} sx={{ color: visibleView === id ? "primary.main" : "text.primary", bgcolor: visibleView === id ? "action.selected" : undefined }}>
              {icon}
            </IconButton>
          </Tooltip>
        ))}
        <Box sx={{ flex: 1 }} />
        <Tooltip disableInteractive title={`Move sidebar to ${tooltipSide}`} placement={tooltipSide}>
          <IconButton aria-label={`Move sidebar to ${tooltipSide}`} onClick={toggleSide}><SwapHorizIcon /></IconButton>
        </Tooltip>
        <Tooltip disableInteractive title={colorScheme === "dark" ? "Light mode" : "Dark mode"} placement={tooltipSide}>
          <IconButton aria-label={colorScheme === "dark" ? "Light mode" : "Dark mode"} onClick={() => onColorSchemeChange(colorScheme === "dark" ? "light" : "dark")}>
            {colorScheme === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip disableInteractive title="Settings" placement={tooltipSide}>
          <IconButton aria-label="Settings" data-testid="standalone-settings-button" onClick={onOpenSettings}><TuneIcon /></IconButton>
        </Tooltip>
      </Box>
      {visibleView && (
        <Box id="workspace-explorer" sx={{ ...floatingSurfaceSx, borderWidth, width: panelWidth, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          <Box sx={{ display: "flex", alignItems: "center", px: 1, minHeight: 36 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>{VIEWS.find((entry) => entry.id === visibleView)?.label}</Typography>
            <IconButton size="small" aria-label="Close explorer" onClick={() => setView(null)}><CloseIcon fontSize="small" /></IconButton>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <Suspense fallback={null}>{visibleView === "palette" ? <NodePalette /> : <Explorer visibleSectionIds={SECTIONS[visibleView]} />}</Suspense>
          </Box>
          <Box {...separatorProps} sx={{ position: "absolute", [tooltipSide]: 0, top: 0, bottom: 0, width: 4, cursor: "col-resize", touchAction: "none", zIndex: 2, "&:hover, &:focus-visible": { bgcolor: "primary.main" } }} />
        </Box>
      )}
    </Box>
  );
}
