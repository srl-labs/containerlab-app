import { floatingRadius, floatingSurfaceSx } from "../../theme/surfaces";
// Floating action bar for React TopoViewer.
import React from "react";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddIcon from "@mui/icons-material/Add";
import AddLinkRoundedIcon from "@mui/icons-material/AddLinkRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CleaningServicesOutlinedIcon from "@mui/icons-material/CleaningServicesOutlined";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import KeyboardOutlinedIcon from "@mui/icons-material/KeyboardOutlined";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import RedoRoundedIcon from "@mui/icons-material/RedoRounded";
import RemoveIcon from "@mui/icons-material/Remove";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import UndoRoundedIcon from "@mui/icons-material/UndoRounded";
import VerticalSplitOutlinedIcon from "@mui/icons-material/VerticalSplitOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";

import type { ReactFlowInstance } from "@xyflow/react";
import type { LinkLabelMode } from "../../stores/topoViewerStore";
import {
  useDeploymentState,
  useIsDirty,
  useIsLocked,
  useIsProcessing,
  useMode,
  useTopoViewerActions
} from "../../stores/topoViewerStore";
import { useDeploymentCommands } from "../../hooks/ui";
import type { LayoutOption } from "../../hooks/ui";
import { FindNodeSearchWidget } from "../panels/find-node/FindNodeSearchWidget";

const ERROR_MAIN = "error.main";
const SUCCESS_MAIN = "success.main";
/** Below the context panel drawer (1200); menus still portal above. */
const NAVBAR_Z_INDEX = 1100;
/** Size container for the room between the side panels; the toolbar filter collapses when it is tight. */
const TOOLBAR_CONTAINER = "topoviewer-toolbar";
/** Inset of the floating bar from the canvas edges (px). */
const FLOATING_NAVBAR_INSET = 8;
/** Toolbar glyphs use the 18px icon size. */
const TOOLBAR_ICON_SX = { fontSize: 18 } as const;
/** Short vertical rules between button groups. */
const TOOLBAR_DIVIDER_SX = { mx: 0.5, my: 0.75 } as const;
/** An engaged toolbar button: the lock while locked, or a button whose menu is open. */
const PRESSED_SX = {
  color: "text.primary",
  bgcolor: "action.selected",
  "&:hover": { bgcolor: "action.selected" }
} as const;
/** Destructive menu rows read red as a whole, icon included. */
const DANGER_MENU_ITEM_SX = {
  color: ERROR_MAIN,
  "& .MuiListItemIcon-root": { color: "inherit" }
} as const;
/** The node filter in the bar matches the explorer filter: slim, tinted, focus-colored outline. */
function pressedSx(pressed: boolean) {
  return pressed ? PRESSED_SX : undefined;
}

function isGeneratedLayoutOption(layout: LayoutOption): boolean {
  return layout === "force" || layout === "auto" || layout === "radial";
}

function getApplyTooltip(isInSync: boolean, isDeployed: boolean): string {
  if (isInSync) return "Topology in sync — nothing to apply";
  if (!isDeployed) return "Apply Topology (deploys the lab)";
  return "Apply Topology Changes";
}

function floatingDockSx(barSide: "left" | "right", edge: "top" | "bottom") {
  return {
    position: "absolute" as const,
    [edge]: FLOATING_NAVBAR_INSET,
    ...(barSide === "left"
      ? { left: `calc(var(--clab-ui-panel-left, 0px) + ${FLOATING_NAVBAR_INSET}px)` }
      : { right: `calc(var(--clab-ui-panel-right, 0px) + ${FLOATING_NAVBAR_INSET}px)` })
  };
}

function CanvasZoomControls({
  barSide,
  fitDisabled,
  zoomDisabled,
  onFit,
  onZoomIn,
  onZoomOut
}: {
  barSide: "left" | "right";
  fitDisabled: boolean;
  zoomDisabled: boolean;
  onFit?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const tooltipPlacement = barSide === "left" ? "right" : "left";
  return (
    <Paper
      elevation={0}
      data-testid="canvas-zoom-controls"
      sx={{
        ...floatingDockSx(barSide, "bottom"),
        width: "auto",
        borderRadius: floatingRadius,
        zIndex: NAVBAR_Z_INDEX,
        ...floatingSurfaceSx,
        display: "flex",
        flexDirection: "column",
        p: 0.5,
        gap: 0.5
      }}
    >
      <Tooltip title="Zoom in" placement={tooltipPlacement}>
        <span>
          <IconButton aria-label="Zoom in" size="small" onClick={onZoomIn} disabled={zoomDisabled}>
            <AddIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Zoom out" placement={tooltipPlacement}>
        <span>
          <IconButton aria-label="Zoom out" size="small" onClick={onZoomOut} disabled={zoomDisabled}>
            <RemoveIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Fit to Viewport" placement={tooltipPlacement}>
        <span>
          <IconButton
            aria-label="Fit to Viewport"
            size="small"
            onClick={onFit}
            disabled={fitDisabled}
            data-testid="navbar-fit-viewport"
          >
            <FitScreenIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Paper>
  );
}

function getToolbarAnchorPosition(
  appBar: HTMLDivElement | null,
  button: HTMLElement
): { top: number; left: number } | null {
  if (!appBar) return null;
  const appBarRect = appBar.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  return {
    top: appBarRect.bottom,
    left: buttonRect.left + buttonRect.width / 2
  };
}

export interface NavbarProps {
  lifecycleActionsAvailable?: boolean;
  hasActiveTopology?: boolean;
  /** Which canvas corner the floating bar docks to. */
  barSide?: "left" | "right";
  rfInstance?: ReactFlowInstance | null;
  onZoomToFit?: () => void;
  layout: LayoutOption;
  onLayoutChange: (layout: LayoutOption) => void;
  onLabSettings?: () => void;
  onToggleSplit?: () => void;
  onCaptureViewport?: () => void;
  onShowShortcuts?: () => void;
  onShowBulkLink?: () => void;
  /** Toggle shortcut display props */
  shortcutDisplayEnabled?: boolean;
  onToggleShortcutDisplay?: () => void;
  /** Undo/Redo props */
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  linkLabelMode: LinkLabelMode;
  onLinkLabelModeChange: (mode: LinkLabelMode) => void;
  showDummyLinks?: boolean;
  onToggleDummyLinks?: () => void;
  renderDeployMenuItems?: (context: {
    isViewerMode: boolean;
    closeMenu: () => void;
  }) => React.ReactNode;
}

// This is a UI composition component with lots of conditional rendering and menu wiring.
/* eslint-disable complexity */
export const Navbar: React.FC<NavbarProps> = ({
  hasActiveTopology = true,
  lifecycleActionsAvailable = true,
  barSide = "right",
  rfInstance = null,
  onZoomToFit,
  layout,
  onLayoutChange,
  onLabSettings,
  onToggleSplit,
  onCaptureViewport,
  onShowShortcuts,
  onShowBulkLink,
  shortcutDisplayEnabled = false,
  onToggleShortcutDisplay,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  linkLabelMode,
  onLinkLabelModeChange,
  showDummyLinks = true,
  onToggleDummyLinks,
  renderDeployMenuItems
}) => {
  const isTopologyActive = hasActiveTopology;
  const mode = useMode();
  const isLocked = useIsLocked();
  const isProcessing = useIsProcessing();
  const deploymentState = useDeploymentState();
  const isDirty = useIsDirty();
  const { toggleLock, setProcessing } = useTopoViewerActions();
  const deploymentCommands = useDeploymentCommands();

  const isEditMode = mode === "edit" && !isProcessing;
  const isViewerMode = mode === "view";
  const isGeneratedLayoutDisabled = !isTopologyActive || isLocked;

  // Apply covers both worlds: it deploys an absent lab and reconciles a
  // running one, so the UI no longer branches on running vs. undeployed for
  // its primary action. Only a confirmed in-sync lab has nothing to apply.
  const isDeployed = deploymentState === "deployed";
  const isInSync = isDeployed && isDirty === false;
  const showDirtyBadge = isDeployed && isDirty === true;
  const isApplyDisabled = isProcessing || !isTopologyActive || isInSync;
  // Lifecycle actions that need a running lab stay listed but disabled when
  // the lab is confirmed undeployed.
  const isRunningActionDisabled =
    isProcessing || !isTopologyActive || deploymentState === "undeployed";
  const applyTooltip = getApplyTooltip(isInSync, isDeployed);

  const appBarRef = React.useRef<HTMLDivElement>(null);
  const [linkLabelMenuPosition, setLinkLabelMenuPosition] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const linkLabelMenuOpen = Boolean(linkLabelMenuPosition);

  const handleLinkLabelClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!isTopologyActive) return;
      const anchorPosition = getToolbarAnchorPosition(appBarRef.current, event.currentTarget);
      if (anchorPosition) {
        setLinkLabelMenuPosition(anchorPosition);
      }
    },
    [isTopologyActive]
  );

  const handleLinkLabelClose = React.useCallback(() => {
    setLinkLabelMenuPosition(null);
  }, []);

  const handleLinkLabelSelect = React.useCallback(
    (newMode: LinkLabelMode) => {
      onLinkLabelModeChange(newMode);
      setLinkLabelMenuPosition(null);
    },
    [onLinkLabelModeChange]
  );

  // Split button menu state for deploy/destroy
  const [deployMenuPosition, setDeployMenuPosition] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const deployMenuOpen = Boolean(deployMenuPosition);

  const handleDeployMenuOpen = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!isTopologyActive) return;
      const anchorPosition = getToolbarAnchorPosition(appBarRef.current, event.currentTarget);
      if (anchorPosition) {
        setDeployMenuPosition(anchorPosition);
      }
    },
    [isTopologyActive]
  );

  const handleDeployMenuClose = React.useCallback(() => {
    setDeployMenuPosition(null);
  }, []);

  const extraDeployMenuItems = renderDeployMenuItems?.({
    isViewerMode,
    closeMenu: handleDeployMenuClose
  });

  const handleApply = React.useCallback(() => {
    setDeployMenuPosition(null);
    setProcessing(true, "apply");
    deploymentCommands.onApply();
  }, [setProcessing, deploymentCommands]);

  const handleDeployCleanup = React.useCallback(() => {
    setDeployMenuPosition(null);
    setProcessing(true, "deploy");
    deploymentCommands.onDeployCleanup();
  }, [setProcessing, deploymentCommands]);

  const handleDestroy = React.useCallback(() => {
    setDeployMenuPosition(null);
    setProcessing(true, "destroy");
    deploymentCommands.onDestroy();
  }, [setProcessing, deploymentCommands]);

  const handleDestroyCleanup = React.useCallback(() => {
    setDeployMenuPosition(null);
    setProcessing(true, "destroy");
    deploymentCommands.onDestroyCleanup();
  }, [setProcessing, deploymentCommands]);

  const handleRedeploy = React.useCallback(() => {
    setDeployMenuPosition(null);
    setProcessing(true, "deploy");
    deploymentCommands.onRedeploy();
  }, [setProcessing, deploymentCommands]);

  const handleRedeployCleanup = React.useCallback(() => {
    setDeployMenuPosition(null);
    setProcessing(true, "deploy");
    deploymentCommands.onRedeployCleanup();
  }, [setProcessing, deploymentCommands]);

  const handleStartLab = React.useCallback(() => {
    setDeployMenuPosition(null);
    setProcessing(true, "start");
    deploymentCommands.onStartLab();
  }, [setProcessing, deploymentCommands]);

  const handleStopLab = React.useCallback(() => {
    setDeployMenuPosition(null);
    setProcessing(true, "stop");
    deploymentCommands.onStopLab();
  }, [setProcessing, deploymentCommands]);

  const handleRestartLab = React.useCallback(() => {
    setDeployMenuPosition(null);
    setProcessing(true, "restart");
    deploymentCommands.onRestartLab();
  }, [setProcessing, deploymentCommands]);

  // Primary action: apply the on-disk topology (deploys when absent,
  // reconciles when running).
  const handlePrimaryAction = React.useCallback(() => {
    if (!isTopologyActive) return;
    handleApply();
  }, [isTopologyActive, handleApply]);

  const [layoutMenuPosition, setLayoutMenuPosition] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const layoutMenuOpen = Boolean(layoutMenuPosition);

  const handleLayoutClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!isTopologyActive) return;
      const anchorPosition = getToolbarAnchorPosition(appBarRef.current, event.currentTarget);
      if (anchorPosition) {
        setLayoutMenuPosition(anchorPosition);
      }
    },
    [isTopologyActive]
  );

  const handleLayoutClose = React.useCallback(() => {
    setLayoutMenuPosition(null);
  }, []);

  const handleLayoutSelect = React.useCallback(
    (newLayout: LayoutOption) => {
      if (isGeneratedLayoutOption(newLayout) && isGeneratedLayoutDisabled) {
        setLayoutMenuPosition(null);
        return;
      }
      onLayoutChange(newLayout);
      setLayoutMenuPosition(null);
    },
    [isGeneratedLayoutDisabled, onLayoutChange]
  );

  const [moreMenuPosition, setMoreMenuPosition] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const moreMenuOpen = Boolean(moreMenuPosition);

  const handleMoreMenuOpen = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const anchorPosition = getToolbarAnchorPosition(appBarRef.current, event.currentTarget);
    if (anchorPosition) {
      setMoreMenuPosition(anchorPosition);
    }
  }, []);

  const handleMoreMenuClose = React.useCallback(() => {
    setMoreMenuPosition(null);
  }, []);

  const handleShortcuts = React.useCallback(() => {
    setMoreMenuPosition(null);
    onShowShortcuts?.();
  }, [onShowShortcuts]);

  const handleToggleShortcutDisplay = React.useCallback(() => {
    setMoreMenuPosition(null);
    onToggleShortcutDisplay?.();
  }, [onToggleShortcutDisplay]);

  React.useEffect(() => {
    if (isTopologyActive) return;
    setDeployMenuPosition(null);
    setLayoutMenuPosition(null);
    setLinkLabelMenuPosition(null);
    setMoreMenuPosition(null);
  }, [isTopologyActive]);

  const handleZoomIn = React.useCallback(() => {
    void rfInstance?.zoomIn({ duration: 160 });
  }, [rfInstance]);

  const handleZoomOut = React.useCallback(() => {
    void rfInstance?.zoomOut({ duration: 160 });
  }, [rfInstance]);

  const zoomDisabled = !isTopologyActive || rfInstance === null;

  return (
    <>
    {/* Spans the canvas between the side panels, so the toolbar can adapt to the room it has. */}
    <Box
      sx={{
        position: "absolute",
        top: 0,
        left: "var(--clab-ui-panel-left, 0px)",
        right: "var(--clab-ui-panel-right, 0px)",
        height: 0,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: NAVBAR_Z_INDEX,
        containerType: "inline-size",
        containerName: TOOLBAR_CONTAINER
      }}
    >
    <Paper
      ref={appBarRef}
      elevation={0}
      data-testid="topoviewer-navbar"
      sx={{
        position: "absolute",
        top: FLOATING_NAVBAR_INSET,
        [barSide]: FLOATING_NAVBAR_INSET,
        width: "auto",
        maxWidth: `calc(100% - ${FLOATING_NAVBAR_INSET * 2}px)`,
        overflow: "visible",
        borderRadius: floatingRadius,
        pointerEvents: "auto",
        ...floatingSurfaceSx
      }}
    >
      <Toolbar
        variant="dense"
        disableGutters
        sx={{ minHeight: 0, p: 0.5, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px", "& > *": { flexShrink: 0 } }}
      >
        {lifecycleActionsAvailable && (
          <>
            {/* Apply topology (deploys when absent, reconciles when running) */}
            <Tooltip title={applyTooltip}>
              <span>
                <IconButton
                  aria-label={applyTooltip}
                  size="small"
                  onClick={handlePrimaryAction}
                  disabled={isApplyDisabled}
                  sx={{ color: SUCCESS_MAIN }}
                  data-testid="navbar-deploy"
                >
                  <Badge
                    variant="dot"
                    color="warning"
                    overlap="circular"
                    invisible={!showDirtyBadge}
                    data-testid="navbar-apply-dirty-badge"
                  >
                    <PlayArrowRoundedIcon sx={TOOLBAR_ICON_SX} />
                  </Badge>
                </IconButton>
              </span>
            </Tooltip>
            <IconButton
              size="small"
              onClick={handleDeployMenuOpen}
              disabled={isProcessing || !isTopologyActive}
              aria-controls={deployMenuOpen ? "deploy-split-menu" : undefined}
              aria-haspopup="true"
              aria-expanded={deployMenuOpen ? "true" : undefined}
              sx={{ px: 0, width: 18, ...pressedSx(deployMenuOpen) }}
              data-testid="navbar-deploy-menu"
            >
              <ExpandMoreRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <Menu
              id="deploy-split-menu"
              open={deployMenuOpen}
              onClose={handleDeployMenuClose}
              anchorReference="anchorPosition"
              anchorPosition={deployMenuPosition ?? undefined}
              transformOrigin={{ vertical: "top", horizontal: "center" }}
            >
              <MenuItem
                onClick={handleApply}
                disabled={isApplyDisabled}
                data-testid="navbar-deploy-item-apply"
              >
                <ListItemIcon>
                  <PlayArrowRoundedIcon sx={{ color: SUCCESS_MAIN }} />
                </ListItemIcon>
                <ListItemText>Apply</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={handleDeployCleanup}
                disabled={isProcessing || !isTopologyActive || isDeployed}
                data-testid="navbar-deploy-item-deploy-cleanup"
              >
                <ListItemIcon>
                  <CleaningServicesOutlinedIcon />
                </ListItemIcon>
                <ListItemText>Deploy (cleanup)</ListItemText>
              </MenuItem>
              <Divider />
              <MenuItem
                onClick={handleRedeploy}
                disabled={isRunningActionDisabled}
                data-testid="navbar-deploy-item-redeploy"
              >
                <ListItemIcon>
                  <ReplayRoundedIcon />
                </ListItemIcon>
                <ListItemText>Redeploy</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={handleRedeployCleanup}
                disabled={isRunningActionDisabled}
                data-testid="navbar-deploy-item-redeploy-cleanup"
              >
                <ListItemIcon>
                  <CleaningServicesOutlinedIcon />
                </ListItemIcon>
                <ListItemText>Redeploy (cleanup)</ListItemText>
              </MenuItem>
              <Divider />
              <MenuItem
                onClick={handleDestroy}
                disabled={isRunningActionDisabled}
                data-testid="navbar-deploy-item-destroy"
                sx={DANGER_MENU_ITEM_SX}
              >
                <ListItemIcon>
                  <StopRoundedIcon />
                </ListItemIcon>
                <ListItemText>Destroy</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={handleDestroyCleanup}
                disabled={isRunningActionDisabled}
                data-testid="navbar-deploy-item-destroy-cleanup"
                sx={DANGER_MENU_ITEM_SX}
              >
                <ListItemIcon>
                  <CleaningServicesOutlinedIcon />
                </ListItemIcon>
                <ListItemText>Destroy (cleanup)</ListItemText>
              </MenuItem>
              <Divider />
              <MenuItem
                onClick={handleStartLab}
                disabled={isRunningActionDisabled}
                data-testid="navbar-deploy-item-start-lab"
              >
                <ListItemIcon>
                  <PlayArrowRoundedIcon sx={{ color: SUCCESS_MAIN }} />
                </ListItemIcon>
                <ListItemText>Start Nodes</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={handleStopLab}
                disabled={isRunningActionDisabled}
                data-testid="navbar-deploy-item-stop-lab"
              >
                <ListItemIcon>
                  <StopRoundedIcon sx={{ color: ERROR_MAIN }} />
                </ListItemIcon>
                <ListItemText>Stop Nodes</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={handleRestartLab}
                disabled={isRunningActionDisabled}
                data-testid="navbar-deploy-item-restart-lab"
              >
                <ListItemIcon>
                  <ReplayRoundedIcon />
                </ListItemIcon>
                <ListItemText>Restart Nodes</ListItemText>
              </MenuItem>
              {extraDeployMenuItems ? <Divider /> : null}
              {extraDeployMenuItems}
            </Menu>

            <Divider orientation="vertical" flexItem sx={TOOLBAR_DIVIDER_SX} />
          </>
        )}
        {/* Lock / Unlock */}
        <Tooltip title={isLocked ? "Unlock lab to edit" : "Lock Lab"}>
          <span>
            <IconButton
              aria-label={isLocked ? "Unlock lab to edit" : "Lock Lab"}
              size="small"
              onClick={toggleLock}
              disabled={isProcessing || !isTopologyActive}
              sx={pressedSx(isLocked)}
              data-testid="navbar-lock"
            >
              {isLocked ? <LockOutlinedIcon sx={TOOLBAR_ICON_SX} /> : <LockOpenOutlinedIcon sx={TOOLBAR_ICON_SX} />}
            </IconButton>
          </span>
        </Tooltip>

        <FindNodeSearchWidget
          isActive={isTopologyActive}
          rfInstance={rfInstance}
          variant="toolbar"
          collapseBelow={`@container ${TOOLBAR_CONTAINER} (max-width: 640px)`}
        />

        {/* Undo - only show in edit mode */}
        {isEditMode && (
          <Tooltip title="Undo (Ctrl+Z)">
            <span>
              <IconButton
                aria-label="Undo (Ctrl+Z)"
                size="small"
                onClick={onUndo}
                disabled={!isTopologyActive || !canUndo}
                data-testid="navbar-undo"
              >
                <UndoRoundedIcon sx={TOOLBAR_ICON_SX} />
              </IconButton>
            </span>
          </Tooltip>
        )}

        {/* Redo - only show in edit mode */}
        {isEditMode && (
          <Tooltip title="Redo (Ctrl+Y)">
            <span>
              <IconButton
                aria-label="Redo (Ctrl+Y)"
                size="small"
                onClick={onRedo}
                disabled={!isTopologyActive || !canRedo}
                data-testid="navbar-redo"
              >
                <RedoRoundedIcon sx={TOOLBAR_ICON_SX} />
              </IconButton>
            </span>
          </Tooltip>
        )}

        <Divider orientation="vertical" flexItem sx={TOOLBAR_DIVIDER_SX} />

        {/* Bulk Link - only show in edit mode */}
        {isEditMode && (
          <Tooltip title="Bulk Link Devices">
            <span>
              <IconButton
                aria-label="Bulk Link Devices"
                size="small"
                onClick={onShowBulkLink}
                disabled={!isTopologyActive || isLocked}
                data-testid="navbar-bulk-link"
              >
                <AddLinkRoundedIcon sx={TOOLBAR_ICON_SX} />
              </IconButton>
            </span>
          </Tooltip>
        )}

        {/* Toggle YAML Split View */}
        <Tooltip title="Toggle YAML Split View">
          <span>
            <IconButton
              aria-label="Toggle YAML Split View"
              size="small"
              onClick={onToggleSplit}
              disabled={!isTopologyActive}
              data-testid="navbar-split-view"
            >
              <VerticalSplitOutlinedIcon sx={TOOLBAR_ICON_SX} />
            </IconButton>
          </span>
        </Tooltip>

        {/* Layout Manager */}
        <Tooltip title="Layout">
          <span>
            <IconButton
              aria-label="Layout"
              size="small"
              onClick={handleLayoutClick}
              disabled={!isTopologyActive}
              sx={pressedSx(layoutMenuOpen)}
              data-testid="navbar-layout"
            >
              <AccountTreeOutlinedIcon sx={TOOLBAR_ICON_SX} />
            </IconButton>
          </span>
        </Tooltip>
        <Menu
          open={layoutMenuOpen}
          onClose={handleLayoutClose}
          anchorReference="anchorPosition"
          anchorPosition={layoutMenuPosition ?? undefined}
          transformOrigin={{ vertical: "top", horizontal: "center" }}
        >
          <MenuItem onClick={() => handleLayoutSelect("preset")} data-testid="navbar-layout-preset">
            <ListItemIcon>{layout === "preset" && <CheckRoundedIcon />}</ListItemIcon>
            <ListItemText>Preset</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLayoutSelect("force")}
            disabled={isGeneratedLayoutDisabled}
            data-testid="navbar-layout-force"
          >
            <ListItemIcon>{layout === "force" && <CheckRoundedIcon />}</ListItemIcon>
            <ListItemText>Force</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLayoutSelect("auto")}
            disabled={isGeneratedLayoutDisabled}
            data-testid="navbar-layout-auto"
          >
            <ListItemIcon>{layout === "auto" && <CheckRoundedIcon />}</ListItemIcon>
            <ListItemText>Auto</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLayoutSelect("radial")}
            disabled={isGeneratedLayoutDisabled}
            data-testid="navbar-layout-radial"
          >
            <ListItemIcon>{layout === "radial" && <CheckRoundedIcon />}</ListItemIcon>
            <ListItemText>Radial</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleLayoutSelect("geo")} data-testid="navbar-layout-geo">
            <ListItemIcon>{layout === "geo" && <CheckRoundedIcon />}</ListItemIcon>
            <ListItemText>Geo</ListItemText>
          </MenuItem>
        </Menu>

        {/* Links Dropdown */}
        <Tooltip title="Links">
          <span>
            <IconButton
              size="small"
              onClick={handleLinkLabelClick}
              disabled={!isTopologyActive}
              aria-label="Links"
              aria-haspopup="menu"
              aria-controls={linkLabelMenuOpen ? "navbar-links-menu" : undefined}
              aria-expanded={linkLabelMenuOpen}
              sx={pressedSx(linkLabelMenuOpen)}
              data-testid="navbar-link-labels"
            >
              <LabelOutlinedIcon sx={TOOLBAR_ICON_SX} />
            </IconButton>
          </span>
        </Tooltip>
        <Menu
          id="navbar-links-menu"
          open={linkLabelMenuOpen}
          onClose={handleLinkLabelClose}
          anchorReference="anchorPosition"
          anchorPosition={linkLabelMenuPosition ?? undefined}
          transformOrigin={{ vertical: "top", horizontal: "center" }}
        >
          <MenuItem
            onClick={() => handleLinkLabelSelect("show-all")}
            data-testid="navbar-link-label-show-all"
          >
            <ListItemIcon>{linkLabelMode === "show-all" && <CheckRoundedIcon />}</ListItemIcon>
            <ListItemText>Show All Labels</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLinkLabelSelect("on-select")}
            data-testid="navbar-link-label-on-select"
          >
            <ListItemIcon>{linkLabelMode === "on-select" && <CheckRoundedIcon />}</ListItemIcon>
            <ListItemText>Labels on Select</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLinkLabelSelect("hide")}
            data-testid="navbar-link-label-hide"
          >
            <ListItemIcon>{linkLabelMode === "hide" && <CheckRoundedIcon />}</ListItemIcon>
            <ListItemText>Hide Labels</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={!showDummyLinks}
            onClick={() => {
              onToggleDummyLinks?.();
              handleLinkLabelClose();
            }}
            disabled={!onToggleDummyLinks}
            data-testid="navbar-hide-dummy-links"
          >
            <ListItemIcon>{!showDummyLinks && <CheckRoundedIcon />}</ListItemIcon>
            <ListItemText>Hide Dummy Links</ListItemText>
          </MenuItem>
        </Menu>

        {/* Capture Viewport */}
        <Tooltip title="Capture Viewport as SVG">
          <span>
            <IconButton
              aria-label="Capture Viewport as SVG"
              size="small"
              onClick={onCaptureViewport}
              disabled={!isTopologyActive}
              data-testid="navbar-capture"
            >
              <PhotoCameraOutlinedIcon sx={TOOLBAR_ICON_SX} />
            </IconButton>
          </span>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={TOOLBAR_DIVIDER_SX} />

        <Tooltip title="Lab Settings">
          <span>
            <IconButton
              aria-label="Lab Settings"
              size="small"
              onClick={onLabSettings}
              disabled={!isTopologyActive}
              data-testid="navbar-lab-settings"
            >
              <SettingsOutlinedIcon sx={TOOLBAR_ICON_SX} />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="More">
          <IconButton
            size="small"
            onClick={handleMoreMenuOpen}
            aria-haspopup="true"
            aria-expanded={moreMenuOpen ? "true" : undefined}
            sx={pressedSx(moreMenuOpen)}
            data-testid="navbar-more"
          >
            <MoreHorizRoundedIcon sx={TOOLBAR_ICON_SX} />
          </IconButton>
        </Tooltip>
        <Menu
          id="navbar-more-menu"
          open={moreMenuOpen}
          onClose={handleMoreMenuClose}
          anchorReference="anchorPosition"
          anchorPosition={moreMenuPosition ?? undefined}
          transformOrigin={{ vertical: "top", horizontal: "center" }}
          slotProps={{ paper: { sx: { minWidth: 200 } } }}
        >
          <MenuItem onClick={handleShortcuts} data-testid="navbar-shortcuts">
            <ListItemIcon>
              <KeyboardOutlinedIcon />
            </ListItemIcon>
            <ListItemText>Keyboard Shortcuts</ListItemText>
          </MenuItem>
          <MenuItem onClick={handleToggleShortcutDisplay} data-testid="navbar-shortcut-display">
            <ListItemIcon>
              {shortcutDisplayEnabled ? <VisibilityOutlinedIcon /> : <VisibilityOffOutlinedIcon />}
            </ListItemIcon>
            <ListItemText>Shortcut Display</ListItemText>
            {/* The state reads at a glance, where a shortcut hint would sit. */}
            <Typography
              variant="body2"
              aria-hidden="true"
              sx={{ ml: 2, color: shortcutDisplayEnabled ? "text.primary" : "text.secondary" }}
            >
              {shortcutDisplayEnabled ? "On" : "Off"}
            </Typography>
          </MenuItem>
        </Menu>
      </Toolbar>
    </Paper>
    </Box>
    <CanvasZoomControls
      barSide={barSide}
      zoomDisabled={zoomDisabled}
      fitDisabled={!isTopologyActive}
      onFit={onZoomToFit}
      onZoomIn={handleZoomIn}
      onZoomOut={handleZoomOut}
    />
    </>
  );
};
/* eslint-enable complexity */
