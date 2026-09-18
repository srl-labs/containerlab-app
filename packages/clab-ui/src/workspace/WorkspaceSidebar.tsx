import React, { lazy, Suspense, useState } from "react";
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
import Typography from "@mui/material/Typography";
import type { ExplorerSectionId } from "../explorer/shared/explorer/types";
import { floatingSurfaceSx } from "../theme/surfaces";
import { RailLogo } from "./RailLogo";

const Explorer = lazy(async () => ({ default: (await import("../explorer")).ContainerlabExplorerView }));
const SECTIONS: Record<string, ExplorerSectionId[]> = {
  labs: ["runningLabs", "localLabs"],
  files: ["fileExplorer"],
  help: ["helpFeedback"]
};
const VIEWS = [
  { id: "labs", label: "Labs", icon: <ScienceIcon /> },
  { id: "files", label: "File Explorer", icon: <FolderIcon /> },
  { id: "help", label: "Help & Feedback", icon: <HelpOutlineIcon /> }
] as const;

/** Standalone composition of the same explorer used in VS Code's sidebar. */
export function WorkspaceSidebar({ colorScheme, onColorSchemeChange, onOpenSettings }: {
  colorScheme: "light" | "dark";
  onColorSchemeChange: (scheme: "light" | "dark") => void;
  onOpenSettings: () => void;
}) {
  const [view, setView] = useState<string | null>("labs");
  return (
    <Box data-testid="workspace-sidebar" sx={{ display: "flex", flexShrink: 0, minHeight: 0, maxWidth: "min(328px, 65%)", zIndex: 8 }}>
      <Box component="nav" aria-label="Workspace" sx={{ ...floatingSurfaceSx, borderWidth: "0 1px 0 0", width: 48, flexShrink: 0, py: 1, display: "flex", alignItems: "center", flexDirection: "column", gap: 0.75 }}>
        <RailLogo showTooltip />
        {VIEWS.map(({ id, label, icon }) => (
          <Tooltip disableInteractive key={id} title={label} placement="right">
            <IconButton aria-label={label} aria-pressed={view === id} aria-controls="workspace-explorer" onClick={() => setView(view === id ? null : id)} sx={{ color: view === id ? "primary.main" : "text.primary", bgcolor: view === id ? "action.selected" : undefined }}>
              {icon}
            </IconButton>
          </Tooltip>
        ))}
        <Box sx={{ flex: 1 }} />
        <Tooltip disableInteractive title={colorScheme === "dark" ? "Light mode" : "Dark mode"} placement="right">
          <IconButton aria-label={colorScheme === "dark" ? "Light mode" : "Dark mode"} onClick={() => onColorSchemeChange(colorScheme === "dark" ? "light" : "dark")}>
            {colorScheme === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip disableInteractive title="Settings" placement="right">
          <IconButton aria-label="Settings" data-testid="standalone-settings-button" onClick={onOpenSettings}><TuneIcon /></IconButton>
        </Tooltip>
      </Box>
      {view && (
        <Box id="workspace-explorer" sx={{ ...floatingSurfaceSx, borderWidth: "0 1px 0 0", width: 280, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Box sx={{ display: "flex", alignItems: "center", px: 1, minHeight: 36 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>{VIEWS.find((entry) => entry.id === view)?.label}</Typography>
            <IconButton size="small" aria-label="Close explorer" onClick={() => setView(null)}><CloseIcon fontSize="small" /></IconButton>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <Suspense fallback={null}><Explorer visibleSectionIds={SECTIONS[view]} /></Suspense>
          </Box>
        </Box>
      )}
    </Box>
  );
}
