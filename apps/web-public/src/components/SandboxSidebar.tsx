/* eslint-disable import-x/max-dependencies */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import HelpOutlinedIcon from "@mui/icons-material/HelpOutlined";
import LightModeIcon from "@mui/icons-material/LightMode";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import ScienceIcon from "@mui/icons-material/Science";
import TuneIcon from "@mui/icons-material/Tune";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { TopologyRef } from "@containerlab/clab-ui/session";

import {
  DEFAULT_TOPOLOGY_FILE_NAME,
  normalizeTopologyFileNameForCreate,
} from "../runtimeActionFlows";
import {
  getSandboxBackend,
  SANDBOX_ENDPOINT,
  SANDBOX_FILES_CHANGED_EVENT,
  type SandboxFileExplorerEntry,
} from "../sandboxBackend";
import { isFileLabTab, useLabTabsStore } from "../stores/labTabsStore";
import { runtimeUiActions } from "../stores/runtimeUiStore";
import type { TopologyFileEntry } from "../standaloneHostShared";
import { RailLogo } from "./RailLogo";

export const SANDBOX_OPEN_SETTINGS_EVENT = "clab-sandbox-open-settings";
export const SANDBOX_CREATE_TOPOLOGY_EVENT = "clab-sandbox-create-topology";

const RAIL_WIDTH = 48;
const RAIL_EXPANDED_WIDTH = 196;
const PANEL_MIN_WIDTH = 280;
function panelMaxWidth(): number {
  return Math.max(PANEL_MIN_WIDTH, Math.floor(window.innerWidth / 2));
}
const GLASS_SX = {
  bgcolor: "color-mix(in srgb, var(--vscode-editor-background, #000) 28%, transparent)",
  backdropFilter: "blur(24px) saturate(1.6)",
  WebkitBackdropFilter: "blur(24px) saturate(1.6)",
} as const;
const GLASS_FILL_HOVER = "color-mix(in srgb, var(--vscode-foreground, #fff) 16%, transparent)";
const GLASS_FILL_ACTIVE = "color-mix(in srgb, var(--vscode-foreground, #fff) 18%, transparent)";
const HELP_LINKS = [
  { label: "Containerlab Documentation", url: "https://containerlab.dev/" },
  {
    label: "VS Code Extension Documentation",
    url: "https://containerlab.dev/manual/vsc-extension/",
  },
  { label: "Browse Labs on GitHub (srl-labs)", url: "https://github.com/srl-labs/" },
  { label: "Join our Discord server", url: "https://discord.gg/vAyddtaEV9" },
] as const;

type SidebarView = "labs" | "files";

export interface SandboxSidebarProps {
  colorScheme: "light" | "dark";
  onColorSchemeChange: (next: "light" | "dark") => void;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenFile: (document: {
    content: string;
    endpointId: string;
    path: string;
    title: string;
  }) => void;
  onOpenTopology: (topologyRef: TopologyRef) => Promise<void>;
}

function useSandboxFiles(): void {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((current) => current + 1);
    window.addEventListener(SANDBOX_FILES_CHANGED_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(SANDBOX_FILES_CHANGED_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
}

function RailButton(props: {
  active?: boolean;
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onClose?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
  showTooltip?: boolean;
  testId: string;
  children: ReactNode;
}) {
  const button = (
    <ButtonBase
      aria-label={props.label}
      data-testid={props.testId}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      onMouseDown={props.onMouseDown}
      sx={{
        display: "flex",
        justifyContent: "flex-start",
        alignItems: "center",
        gap: 1,
        alignSelf: "stretch",
        mx: 0.75,
        minWidth: 0,
        height: 36,
        pr: props.onClose ? 0.5 : 1,
        overflow: "hidden",
        borderRadius: 1,
        color: props.active === true ? "primary.main" : "text.primary",
        bgcolor: props.active === true ? GLASS_FILL_ACTIVE : "transparent",
        "&:hover": {
          bgcolor: props.active === true ? GLASS_FILL_ACTIVE : GLASS_FILL_HOVER,
        },
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        {props.children}
      </Box>
      <Typography
        noWrap
        variant="body2"
        sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}
      >
        {props.label}
      </Typography>
      {props.onClose ? (
        <Box
          aria-label={`Close ${props.label}`}
          component="span"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onClose?.();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          role="button"
          sx={{
            display: "grid",
            placeItems: "center",
            width: 24,
            height: 24,
            flexShrink: 0,
            borderRadius: 1,
            color: "text.secondary",
            "&:hover": {
              color: "text.primary",
              bgcolor: "color-mix(in srgb, currentColor 16%, transparent)",
            },
          }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </Box>
      ) : null}
    </ButtonBase>
  );

  if (props.showTooltip !== true) {
    return button;
  }

  return (
    <Tooltip disableInteractive leaveDelay={0} placement="right" title={props.label}>
      {button}
    </Tooltip>
  );
}

function OpenRailTabs(props: {
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  showTooltip?: boolean;
}) {
  const tabs = useLabTabsStore((state) => state.tabs);
  const activeTabId = useLabTabsStore((state) => state.activeTabId);
  const [menu, setMenu] = useState<{ tabId: string; anchor: HTMLElement } | null>(
    null,
  );

  return (
    <>
      <Divider sx={{ mx: 1.5, my: 0.5 }} />
      <Box
        data-testid="sandbox-sidebar-open-tabs"
        sx={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          overflowX: "hidden",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
        }}
      >
        {tabs.map((tab) => {
          const dirty = isFileLabTab(tab) && tab.content !== tab.originalContent;
          return (
            <RailButton
              key={tab.id}
              active={tab.id === activeTabId}
              label={dirty ? `${tab.title} *` : tab.title}
              onClose={() => props.onClose(tab.id)}
              showTooltip={props.showTooltip}
              testId={`lab-tab-${tab.id}`}
              onClick={() => props.onActivate(tab.id)}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  props.onClose(tab.id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ tabId: tab.id, anchor: event.currentTarget });
              }}
            >
              {tab.kind === "topology" ? (
                <ScienceIcon fontSize="small" />
              ) : (
                <DescriptionOutlinedIcon fontSize="small" />
              )}
            </RailButton>
          );
        })}
      </Box>
      <Menu
        anchorEl={menu?.anchor ?? null}
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: "center", horizontal: "right" }}
      >
        <MenuItem
          data-testid={menu ? `lab-tab-close-${menu.tabId}` : undefined}
          onClick={() => {
            if (menu) {
              props.onClose(menu.tabId);
            }
            setMenu(null);
          }}
        >
          Close
        </MenuItem>
      </Menu>
    </>
  );
}

function EntryIcon(props: { entry: SandboxFileExplorerEntry; open: boolean }) {
  if (props.entry.kind === "directory") {
    return props.open ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />;
  }
  if (props.entry.topologyRef) {
    return <AccountTreeIcon fontSize="small" />;
  }
  return <DescriptionOutlinedIcon fontSize="small" />;
}

function DirChevron(props: { open: boolean }) {
  if (props.open) {
    return <ExpandMoreIcon fontSize="small" sx={{ mr: 0.5 }} />;
  }
  return <ChevronRightIcon fontSize="small" sx={{ mr: 0.5 }} />;
}

function FileTree(props: {
  depth: number;
  onOpen: (entry: SandboxFileExplorerEntry) => void;
  parentPath: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const entries = getSandboxBackend().listDirectory(props.parentPath);

  return (
    <List dense disablePadding>
      {entries.map((entry) => {
        const isOpen = expanded.has(entry.path);
        return (
          <Box key={entry.path}>
            <ListItemButton
              sx={{
                pl: 1 + props.depth * 1.5,
                "&:hover": { bgcolor: GLASS_FILL_HOVER },
              }}
              onClick={() => {
                if (entry.kind === "directory") {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(entry.path)) {
                      next.delete(entry.path);
                    } else {
                      next.add(entry.path);
                    }
                    return next;
                  });
                  return;
                }
                props.onOpen(entry);
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <EntryIcon entry={entry} open={isOpen} />
              </ListItemIcon>
              {entry.kind === "directory" ? <DirChevron open={isOpen} /> : null}
              <ListItemText
                primary={entry.name}
                slotProps={{
                  primary: { noWrap: true, variant: "body2" },
                }}
              />
            </ListItemButton>
            {entry.kind === "directory" && isOpen ? (
              <FileTree depth={props.depth + 1} onOpen={props.onOpen} parentPath={entry.path} />
            ) : null}
          </Box>
        );
      })}
    </List>
  );
}

function LabsPanel(props: {
  onCreate: () => void;
  onOpenTopology: (topologyRef: TopologyRef) => Promise<void>;
  topologies: TopologyFileEntry[];
}) {
  if (props.topologies.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          No labs in this workspace.
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<NoteAddIcon />}
          onClick={props.onCreate}
        >
          New topology
        </Button>
      </Box>
    );
  }

  return (
    <List dense>
      {props.topologies.map((entry) => (
        <ListItemButton
          key={entry.path}
          onClick={() => {
            void props.onOpenTopology(entry.topologyRef);
          }}
          sx={{ "&:hover": { bgcolor: GLASS_FILL_HOVER } }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <AccountTreeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={entry.labName ?? entry.filename}
            secondary={entry.path}
            slotProps={{
              primary: { noWrap: true, variant: "body2" },
              secondary: { noWrap: true },
            }}
          />
        </ListItemButton>
      ))}
    </List>
  );
}

export function SandboxSidebar({
  colorScheme,
  onColorSchemeChange,
  onActivateTab,
  onCloseTab,
  onOpenFile,
  onOpenTopology,
}: SandboxSidebarProps) {
  useSandboxFiles();
  const [view, setView] = useState<SidebarView>("labs");
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hoverLocked, setHoverLocked] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [fileName, setFileName] = useState(DEFAULT_TOPOLOGY_FILE_NAME);
  const [createError, setCreateError] = useState<string | null>(null);
  const [helpAnchor, setHelpAnchor] = useState<HTMLElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(PANEL_MIN_WIDTH);
  const panelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const labelsVisible = pinned || !open;
  const hoverExpand = !pinned && !open && !hoverLocked;
  const topologies = getSandboxBackend().listTopologyFiles();

  const selectView = (next: SidebarView) => {
    if (open && view === next) {
      setOpen(false);
      setHoverLocked(true);
      return;
    }
    setView(next);
    setOpen(true);
  };

  const openCreate = useCallback(() => {
    setFileName(DEFAULT_TOPOLOGY_FILE_NAME);
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  useEffect(() => {
    window.addEventListener(SANDBOX_CREATE_TOPOLOGY_EVENT, openCreate);
    return () => {
      window.removeEventListener(SANDBOX_CREATE_TOPOLOGY_EVENT, openCreate);
    };
  }, [openCreate]);

  const openEntry = useCallback(
    async (entry: SandboxFileExplorerEntry) => {
      if (entry.topologyRef) {
        await onOpenTopology(entry.topologyRef);
        return;
      }
      const document = await getSandboxBackend().readFile(entry.path);
      onOpenFile({
        content: document.content,
        endpointId: document.endpointId,
        path: document.path,
        title: entry.name,
      });
    },
    [onOpenFile, onOpenTopology],
  );

  const handlePanelResizeStart = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    const onMove = (moveEvent: globalThis.MouseEvent) => {
      if (!draggingRef.current) {
        return;
      }
      const left = panelRef.current?.getBoundingClientRect().left ?? 0;
      setPanelWidth(
        Math.min(panelMaxWidth(), Math.max(PANEL_MIN_WIDTH, moveEvent.clientX - left)),
      );
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const createTopology = async () => {
    const name = normalizeTopologyFileNameForCreate(fileName);
    try {
      const topologyRef = await getSandboxBackend().createTopologyFile(name);
      setCreateOpen(false);
      setCreateError(null);
      setFileName(DEFAULT_TOPOLOGY_FILE_NAME);
      runtimeUiActions.notify(`Created topology file "${name}".`, "success");
      await onOpenTopology(topologyRef);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
      <Box
        data-testid="sandbox-sidebar"
        sx={{
          position: "relative",
          zIndex: 8,
          display: "flex",
          flexShrink: 0,
          alignSelf: "stretch",
        }}
      >
      <Box
        sx={{
          width: pinned ? RAIL_EXPANDED_WIDTH : RAIL_WIDTH,
          flexShrink: 0,
          position: "relative",
          zIndex: 1,
          transition: (theme) =>
            theme.transitions.create("width", { duration: 160 }),
        }}
      >
      <Box
        role="tablist"
        aria-orientation="vertical"
        data-testid="sandbox-sidebar-rail"
        onMouseLeave={() => setHoverLocked(false)}
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: pinned ? "100%" : RAIL_WIDTH,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
          py: 1,
          ...GLASS_SX,
          borderRight: 1,
          borderColor:
            "color-mix(in srgb, var(--vscode-panel-border, #888) 70%, transparent)",
          transition: (theme) =>
            theme.transitions.create("width", { duration: 160 }),
          ...(hoverExpand
            ? {
                "&:hover, &:has(:focus-visible)": { width: RAIL_EXPANDED_WIDTH },
              }
            : {}),
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            alignSelf: "stretch",
            mx: 0.75,
            minWidth: 0,
            height: 36,
            my: 0.5,
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <Box sx={{ width: 36, height: 36, flexShrink: 0, display: "grid", placeItems: "center" }}>
            <RailLogo showTooltip={!labelsVisible} />
          </Box>
          <Typography noWrap variant="body1">
            Containerlab
          </Typography>
        </Box>
        <RailButton
          active={open && view === "labs"}
          label="Labs"
          showTooltip={!labelsVisible}
          testId="sandbox-sidebar-labs"
          onClick={() => selectView("labs")}
        >
          <ScienceIcon fontSize="small" />
        </RailButton>
        <RailButton
          active={open && view === "files"}
          label="File Explorer"
          showTooltip={!labelsVisible}
          testId="sandbox-sidebar-files"
          onClick={() => selectView("files")}
        >
          <FolderIcon fontSize="small" />
        </RailButton>
        <OpenRailTabs onActivate={onActivateTab} onClose={onCloseTab} showTooltip={!labelsVisible} />
        <RailButton
          label="Help & Feedback"
          showTooltip={!labelsVisible}
          testId="sandbox-sidebar-help"
          onClick={(event) => setHelpAnchor(event.currentTarget)}
        >
          <HelpOutlinedIcon fontSize="small" />
        </RailButton>
        <RailButton
          label={colorScheme === "dark" ? "Light mode" : "Dark mode"}
          showTooltip={!labelsVisible}
          testId="sandbox-sidebar-theme"
          onClick={() => onColorSchemeChange(colorScheme === "dark" ? "light" : "dark")}
        >
          {colorScheme === "dark" ? (
            <DarkModeIcon fontSize="small" />
          ) : (
            <LightModeIcon fontSize="small" />
          )}
        </RailButton>
        <RailButton
          label="Settings"
          showTooltip={!labelsVisible}
          testId="sandbox-sidebar-settings"
          onClick={() => window.dispatchEvent(new Event(SANDBOX_OPEN_SETTINGS_EVENT))}
        >
          <TuneIcon fontSize="small" />
        </RailButton>
        <RailButton
          active={pinned}
          label={pinned ? "Unpin" : "Pin"}
          showTooltip={!labelsVisible}
          testId="sandbox-sidebar-pin"
          onClick={() => setPinned((current) => !current)}
        >
          {pinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
        </RailButton>
      </Box>
      </Box>

      {open ? (
        <Box
          ref={panelRef}
          data-testid="sandbox-sidebar-panel"
          sx={{
            position: "relative",
            width: panelWidth,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            ...GLASS_SX,
            borderRight: 1,
            borderColor:
              "color-mix(in srgb, var(--vscode-panel-border, #888) 70%, transparent)",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 1.5,
              py: 1,
              borderBottom: 1,
              borderColor: "divider",
              gap: 1,
            }}
          >
            <Typography
              noWrap
              variant="subtitle2"
              sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {view === "labs" ? "Labs" : "File Explorer"}
            </Typography>
            {view === "labs" ? (
              <Tooltip title="New Topology File">
                <IconButton
                  size="small"
                  onClick={openCreate}
                  data-testid="sandbox-sidebar-new-topology"
                  aria-label="New Topology File"
                  sx={{ "&:hover": { bgcolor: GLASS_FILL_HOVER } }}
                >
                  <NoteAddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title="Close">
                <IconButton
                  size="small"
                  onClick={() => setOpen(false)}
                  data-testid="sandbox-sidebar-panel-close"
                  aria-label="Close panel"
                  sx={{ "&:hover": { bgcolor: GLASS_FILL_HOVER } }}
                >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {view === "labs" ? (
              <LabsPanel
                onCreate={openCreate}
                onOpenTopology={onOpenTopology}
                topologies={topologies}
              />
            ) : (
              <FileTree depth={0} onOpen={(entry) => void openEntry(entry)} parentPath="" />
            )}
          </Box>
          <Box
            data-testid="sandbox-sidebar-panel-resize"
            onMouseDown={handlePanelResizeStart}
            sx={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 4,
              cursor: "col-resize",
              zIndex: 1,
              "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
            }}
          />
        </Box>
      ) : null}

      <Menu
        anchorEl={helpAnchor}
        open={helpAnchor !== null}
        onClose={() => setHelpAnchor(null)}
        anchorOrigin={{ vertical: "center", horizontal: "right" }}
      >
        {HELP_LINKS.map((link) => (
          <MenuItem
            key={link.url}
            component="a"
            href={link.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => setHelpAnchor(null)}
          >
            {link.label}
          </MenuItem>
        ))}
      </Menu>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Create Topology File</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="File name"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            error={createError !== null}
            helperText={createError ?? `Saved in the local workspace (${SANDBOX_ENDPOINT.label}).`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void createTopology()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
