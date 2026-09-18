/* eslint-disable import-x/max-dependencies -- Keep individual icon imports tree-shakeable. */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlined";
import LightModeIcon from "@mui/icons-material/LightMode";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import ScienceIcon from "@mui/icons-material/Science";
import TuneIcon from "@mui/icons-material/Tune";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useHorizontalResize } from "../hooks/ui/useHorizontalResize";
import { floatingSurfaceSx } from "../theme/surfaces";
import type { FileExplorerEntry } from "./types";
import type { TopologyFileEntry } from "./state/documentUtils";
import { RailLogo } from "./RailLogo";
import { useWorkspaceHost } from "./WorkspaceHost";
import { RailPinnedContext, WorkspaceRailItem } from "./WorkspaceRailItem";

const VIEWS = [
  { id: "labs", label: "Labs", icon: <ScienceIcon fontSize="small" /> },
  { id: "files", label: "Files", icon: <FolderIcon fontSize="small" /> }
] as const;
const RAIL_WIDTH = 48;
const EXPANDED_RAIL_WIDTH = 196;
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

function useExplorerRevision(): number {
  const { explorer } = useWorkspaceHost();
  const [revision, setRevision] = useState(0);
  useEffect(() => explorer.subscribe(() => setRevision((current) => current + 1)), [explorer]);
  return revision;
}

function LabsPanel({ revision }: { revision: number }) {
  const { explorer } = useWorkspaceHost();
  const [topologies, setTopologies] = useState<TopologyFileEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    void explorer.listTopologies().then((next) => {
      if (!cancelled) setTopologies(next);
    });
    return () => {
      cancelled = true;
    };
  }, [explorer, revision]);
  if (topologies.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          No labs in this workspace.
        </Typography>
        <Button size="small" variant="outlined" startIcon={<NoteAddIcon />} onClick={explorer.createTopology}>
          New Topology File
        </Button>
      </Box>
    );
  }
  return (
    <List dense>
      {topologies.map((entry) => (
        <ListItemButton key={`${entry.endpointId}:${entry.path}`} onClick={() => { void explorer.openTopology(entry.topologyRef); }} sx={{ "&:hover": { bgcolor: "action.hover" } }}>
          <ListItemIcon sx={{ minWidth: 32 }}><AccountTreeIcon fontSize="small" /></ListItemIcon>
          <ListItemText
            primary={entry.labName ?? entry.filename}
            secondary={entry.path}
            slotProps={{ primary: { noWrap: true, variant: "body2" }, secondary: { noWrap: true } }}
          />
        </ListItemButton>
      ))}
    </List>
  );
}

function EntryIcon(props: { entry: FileExplorerEntry; open: boolean }) {
  if (props.entry.kind === "directory") {
    return props.open ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />;
  }
  if (props.entry.topologyRef) return <AccountTreeIcon fontSize="small" />;
  return <DescriptionOutlinedIcon fontSize="small" />;
}

function FileTree(props: { depth: number; parentPath: string; revision: number }) {
  const { explorer } = useWorkspaceHost();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<FileExplorerEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    void explorer.listDirectory(props.parentPath).then((next) => {
      if (!cancelled) setEntries(next);
    });
    return () => {
      cancelled = true;
    };
  }, [explorer, props.parentPath, props.revision]);
  return (
    <List dense disablePadding>
      {entries.map((entry) => {
        const isOpen = expanded.has(entry.path);
        return (
          <Box key={`${entry.endpointId}:${entry.path}`}>
            <ListItemButton
              sx={{ pl: 1 + props.depth * 1.5, "&:hover": { bgcolor: "action.hover" } }}
              onClick={() => {
                if (entry.kind === "directory") {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  });
                  return;
                }
                void explorer.openFile(entry);
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}><EntryIcon entry={entry} open={isOpen} /></ListItemIcon>
              {entry.kind === "directory" ? (isOpen ? <ExpandMoreIcon fontSize="small" sx={{ mr: 0.5 }} /> : <ChevronRightIcon fontSize="small" sx={{ mr: 0.5 }} />) : null}
              <ListItemText primary={entry.name} slotProps={{ primary: { noWrap: true, variant: "body2" } }} />
            </ListItemButton>
            {entry.kind === "directory" && isOpen ? <FileTree depth={props.depth + 1} parentPath={entry.path} revision={props.revision} /> : null}
          </Box>
        );
      })}
    </List>
  );
}

/** Standalone labs and files rail. VS Code keeps its native explorer. */
export function WorkspaceSidebar({ colorScheme, onColorSchemeChange, onOpenSettings, tabs }: {
  colorScheme: "light" | "dark";
  onColorSchemeChange: (scheme: "light" | "dark") => void;
  onOpenSettings: () => void;
  tabs?: ReactNode;
}) {
  const { explorer } = useWorkspaceHost();
  const revision = useExplorerRevision();
  const [view, setView] = useState<SidebarView>("labs");
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const { ref, width: panelWidth, separatorProps, isDragging } = useHorizontalResize({
    initialWidth: 280,
    minimumWidth: 280,
    maximumWidth: (width) => Math.min(width / 2, width * 0.65 - (pinned ? EXPANDED_RAIL_WIDTH : RAIL_WIDTH))
  });
  const railWidth = pinned ? EXPANDED_RAIL_WIDTH : RAIL_WIDTH;
  const themeLabel = colorScheme === "dark" ? "Light mode" : "Dark mode";
  const pinLabel = pinned ? "Unpin" : "Pin";
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
    <Box ref={ref} data-testid="workspace-sidebar" sx={{ display: "flex", flexShrink: 0, alignSelf: "stretch", height: "100%", minHeight: 0, maxWidth: "65%", position: "relative", zIndex: 8, userSelect: isDragging ? "none" : undefined }}>
      <Box sx={{
        width: RAIL_WIDTH, flexShrink: 0, alignSelf: "stretch", height: "100%", position: "relative", zIndex: 3
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mx: 0.75, overflow: "hidden", height: 36, flexShrink: 0 }}>
            <Box sx={{ width: 36, flexShrink: 0 }}><RailLogo showTooltip={!pinned} /></Box>
            <Typography noWrap variant="body1" sx={{ fontWeight: 600 }}>Containerlab</Typography>
          </Box>
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
          <WorkspaceRailItem pinned={pinned} label={pinLabel} active={pinned} testId="workspace-sidebar-pin" onClick={() => setPinned((current) => !current)}>
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
          <Box sx={{ display: "flex", alignItems: "center", px: 1, minHeight: 36, borderBottom: `1px solid ${RAIL_BORDER}` }}>
            <Typography noWrap variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>{VIEWS.find((entry) => entry.id === view)?.label}</Typography>
            {view === "labs" ? (
              <Tooltip title="New Topology File">
                <IconButton size="small" aria-label="New Topology File" onClick={explorer.createTopology}><NoteAddIcon fontSize="small" /></IconButton>
              </Tooltip>
            ) : null}
            <IconButton size="small" aria-label="Close explorer" onClick={closeExplorer}><CloseIcon fontSize="small" /></IconButton>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {view === "labs" ? <LabsPanel revision={revision} /> : <FileTree depth={0} parentPath="" revision={revision} />}
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
