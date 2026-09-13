// Navbar for React TopoViewer.
import React from "react";
import AppBar from "@mui/material/AppBar";
import Badge from "@mui/material/Badge";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CheckIcon from "@mui/icons-material/Check";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import InfoIcon from "@mui/icons-material/Info";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import LabelIcon from "@mui/icons-material/Label";
import LinkIcon from "@mui/icons-material/Link";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import PhotoCameraBackIcon from "@mui/icons-material/PhotoCameraBack";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RedoIcon from "@mui/icons-material/Redo";
import ReplayIcon from "@mui/icons-material/Replay";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import StopIcon from "@mui/icons-material/Stop";
import UndoIcon from "@mui/icons-material/Undo";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";

import type { LinkLabelMode } from "../../stores/topoViewerStore";
import {
  useDeploymentState,
  useIsDirty,
  useIsLocked,
  useIsProcessing,
  useLabName,
  useMode,
  useTopoViewerActions
} from "../../stores/topoViewerStore";
import { useDeploymentCommands } from "../../hooks/ui";
import type { LayoutOption } from "../../hooks/ui";

import { ContainerlabLogo } from "./ContainerlabLogo";

const ERROR_MAIN = "error.main";
const SUCCESS_MAIN = "success.main";

function isGeneratedLayoutOption(layout: LayoutOption): boolean {
  return layout === "force" || layout === "auto" || layout === "radial";
}

function getApplyTooltip(isInSync: boolean, isDeployed: boolean): string {
  if (isInSync) return "Topology in sync — nothing to apply";
  if (!isDeployed) return "Apply Topology (deploys the lab)";
  return "Apply Topology Changes";
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
  hasActiveTopology?: boolean;
  onZoomToFit?: () => void;
  layout: LayoutOption;
  onLayoutChange: (layout: LayoutOption) => void;
  onLabSettings?: () => void;
  onToggleSplit?: () => void;
  onFindNode?: (position: { top: number; left: number }) => void;
  onCaptureViewport?: () => void;
  onShowShortcuts?: () => void;
  onShowAbout?: () => void;
  onShowBulkLink?: () => void;
  /** Toggle shortcut display props */
  shortcutDisplayEnabled?: boolean;
  onToggleShortcutDisplay?: () => void;
  /** Undo/Redo props */
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Easter egg click progress (0-10) */
  logoClickProgress?: number;
  /** Whether party mode is active (logo has exploded) */
  isPartyMode?: boolean;
  /** Easter egg logo click handler and state */
  onLogoClick?: () => void;
  linkLabelMode: LinkLabelMode;
  onLinkLabelModeChange: (mode: LinkLabelMode) => void;
  renderDeployMenuItems?: (context: {
    isViewerMode: boolean;
    closeMenu: () => void;
  }) => React.ReactNode;
}

// This is a UI composition component with lots of conditional rendering and menu wiring.
/* eslint-disable complexity */
export const Navbar: React.FC<NavbarProps> = ({
  hasActiveTopology = true,
  onZoomToFit,
  layout,
  onLayoutChange,
  onLabSettings,
  onToggleSplit,
  onFindNode,
  onCaptureViewport,
  onShowShortcuts,
  onShowAbout,
  onShowBulkLink,
  shortcutDisplayEnabled = false,
  onToggleShortcutDisplay,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onLogoClick,
  logoClickProgress = 0,
  isPartyMode = false,
  linkLabelMode,
  onLinkLabelModeChange,
  renderDeployMenuItems
}) => {
  const isTopologyActive = hasActiveTopology;
  const mode = useMode();
  const labName = useLabName();
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

  const handleLinkLabelClick = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (!isTopologyActive) return;
    const anchorPosition = getToolbarAnchorPosition(appBarRef.current, event.currentTarget);
    if (anchorPosition) {
      setLinkLabelMenuPosition(anchorPosition);
    }
  }, [isTopologyActive]);

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

  const handleDeployMenuOpen = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!isTopologyActive) return;
    const anchorPosition = getToolbarAnchorPosition(appBarRef.current, event.currentTarget);
    if (anchorPosition) {
      setDeployMenuPosition(anchorPosition);
    }
  }, [isTopologyActive]);

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

  const handleLayoutClick = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (!isTopologyActive) return;
    const anchorPosition = getToolbarAnchorPosition(appBarRef.current, event.currentTarget);
    if (anchorPosition) {
      setLayoutMenuPosition(anchorPosition);
    }
  }, [isTopologyActive]);

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

  const handleFindNodeClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!isTopologyActive) return;
      const anchorPosition = getToolbarAnchorPosition(appBarRef.current, event.currentTarget);
      if (anchorPosition) {
        onFindNode?.(anchorPosition);
      }
    },
    [isTopologyActive, onFindNode]
  );

  React.useEffect(() => {
    if (isTopologyActive) return;
    setDeployMenuPosition(null);
    setLayoutMenuPosition(null);
    setLinkLabelMenuPosition(null);
  }, [isTopologyActive]);

  return (
    <AppBar
      ref={appBarRef}
      position="static"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: "divider" }}
    >
      <Toolbar
        variant="dense"
        disableGutters
        sx={{ minHeight: 40, px: 1, display: "flex", alignItems: "center", gap: 0.5 }}
      >
        {/* Left: Logo + Title */}
        <IconButton size="small" onClick={onLogoClick}>
          <ContainerlabLogo clickProgress={logoClickProgress} isExploded={isPartyMode} />
        </IconButton>
        <Typography
          variant="h5"
          fontWeight={500}
          ml={0.5}
          sx={{ lineHeight: 1, flexGrow: 1 }}
          data-testid="navbar-lab-name"
        >
          {labName || "TopoViewer"}
        </Typography>

        {/* Apply topology (deploys when absent, reconciles when running) */}
        <Tooltip title={applyTooltip}>
          <span>
            <IconButton
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
                <PlayArrowIcon fontSize="small" />
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
          sx={{ color: SUCCESS_MAIN, ml: -0.5 }}
          data-testid="navbar-deploy-menu"
        >
          <ExpandMoreIcon fontSize="small" />
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
              <PlayArrowIcon fontSize="small" sx={{ color: SUCCESS_MAIN }} />
            </ListItemIcon>
            <ListItemText>Apply</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={handleDeployCleanup}
            disabled={isProcessing || !isTopologyActive || isDeployed}
            data-testid="navbar-deploy-item-deploy-cleanup"
          >
            <ListItemIcon>
              <CleaningServicesIcon fontSize="small" sx={{ color: SUCCESS_MAIN }} />
            </ListItemIcon>
            <ListItemText>Deploy (cleanup)</ListItemText>
          </MenuItem>
          <Divider sx={{ my: 0.5 }} />
          <MenuItem
            onClick={handleRedeploy}
            disabled={isRunningActionDisabled}
            data-testid="navbar-deploy-item-redeploy"
          >
            <ListItemIcon>
              <ReplayIcon fontSize="small" sx={{ color: SUCCESS_MAIN }} />
            </ListItemIcon>
            <ListItemText>Redeploy</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={handleRedeployCleanup}
            disabled={isRunningActionDisabled}
            data-testid="navbar-deploy-item-redeploy-cleanup"
          >
            <ListItemIcon>
              <CleaningServicesIcon fontSize="small" sx={{ color: SUCCESS_MAIN }} />
            </ListItemIcon>
            <ListItemText>Redeploy (cleanup)</ListItemText>
          </MenuItem>
          <Divider sx={{ my: 0.5 }} />
          <MenuItem
            onClick={handleDestroy}
            disabled={isRunningActionDisabled}
            data-testid="navbar-deploy-item-destroy"
          >
            <ListItemIcon>
              <StopIcon fontSize="small" sx={{ color: ERROR_MAIN }} />
            </ListItemIcon>
            <ListItemText>Destroy</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={handleDestroyCleanup}
            disabled={isRunningActionDisabled}
            data-testid="navbar-deploy-item-destroy-cleanup"
          >
            <ListItemIcon>
              <CleaningServicesIcon fontSize="small" sx={{ color: ERROR_MAIN }} />
            </ListItemIcon>
            <ListItemText>Destroy (cleanup)</ListItemText>
          </MenuItem>
          <Divider sx={{ my: 0.5 }} />
          <MenuItem
            onClick={handleStartLab}
            disabled={isRunningActionDisabled}
            data-testid="navbar-deploy-item-start-lab"
          >
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" sx={{ color: SUCCESS_MAIN }} />
            </ListItemIcon>
            <ListItemText>Start Nodes</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={handleStopLab}
            disabled={isRunningActionDisabled}
            data-testid="navbar-deploy-item-stop-lab"
          >
            <ListItemIcon>
              <StopIcon fontSize="small" sx={{ color: ERROR_MAIN }} />
            </ListItemIcon>
            <ListItemText>Stop Nodes</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={handleRestartLab}
            disabled={isRunningActionDisabled}
            data-testid="navbar-deploy-item-restart-lab"
          >
            <ListItemIcon>
              <ReplayIcon fontSize="small" sx={{ color: SUCCESS_MAIN }} />
            </ListItemIcon>
            <ListItemText>Restart Nodes</ListItemText>
          </MenuItem>
          {extraDeployMenuItems ? <Divider sx={{ my: 0.5 }} /> : null}
          {extraDeployMenuItems}
        </Menu>

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        {/* Lock / Unlock */}
        <Tooltip title={isLocked ? "Unlock lab to edit" : "Lock Lab"}>
          <span>
            <IconButton
              size="small"
              onClick={toggleLock}
              disabled={isProcessing || !isTopologyActive}
              sx={{ color: isLocked ? ERROR_MAIN : "inherit" }}
              data-testid="navbar-lock"
            >
              {isLocked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>

        {/* Lab Settings */}
        <Tooltip title="Lab Settings">
          <span>
            <IconButton
              size="small"
              onClick={onLabSettings}
              disabled={!isTopologyActive}
              data-testid="navbar-lab-settings"
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        {/* Undo - only show in edit mode */}
        {isEditMode && (
          <Tooltip title="Undo (Ctrl+Z)">
            <span>
              <IconButton
                size="small"
                onClick={onUndo}
                disabled={!isTopologyActive || !canUndo}
                data-testid="navbar-undo"
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}

        {/* Redo - only show in edit mode */}
        {isEditMode && (
          <Tooltip title="Redo (Ctrl+Y)">
            <span>
              <IconButton
                size="small"
                onClick={onRedo}
                disabled={!isTopologyActive || !canRedo}
                data-testid="navbar-redo"
              >
                <RedoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        {/* Bulk Link - only show in edit mode */}
        {isEditMode && (
          <Tooltip title="Bulk Link Devices">
            <span>
              <IconButton
                size="small"
                onClick={onShowBulkLink}
                disabled={!isTopologyActive || isLocked}
                data-testid="navbar-bulk-link"
              >
                <LinkIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}

        {/* Fit to Viewport */}
        <Tooltip title="Fit to Viewport">
          <span>
            <IconButton
              size="small"
              onClick={onZoomToFit}
              disabled={!isTopologyActive}
              data-testid="navbar-fit-viewport"
            >
              <FitScreenIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        {/* Toggle YAML Split View */}
        <Tooltip title="Toggle YAML Split View">
          <span>
            <IconButton
              size="small"
              onClick={onToggleSplit}
              disabled={!isTopologyActive}
              data-testid="navbar-split-view"
            >
              <ViewColumnIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        {/* Layout Manager */}
        <Tooltip title="Layout">
          <span>
            <IconButton
              size="small"
              onClick={handleLayoutClick}
              disabled={!isTopologyActive}
              data-testid="navbar-layout"
            >
              <AccountTreeIcon fontSize="small" />
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
            <ListItemIcon>{layout === "preset" && <CheckIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>Preset</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLayoutSelect("force")}
            disabled={isGeneratedLayoutDisabled}
            data-testid="navbar-layout-force"
          >
            <ListItemIcon>{layout === "force" && <CheckIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>Force</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLayoutSelect("auto")}
            disabled={isGeneratedLayoutDisabled}
            data-testid="navbar-layout-auto"
          >
            <ListItemIcon>{layout === "auto" && <CheckIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>Auto</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLayoutSelect("radial")}
            disabled={isGeneratedLayoutDisabled}
            data-testid="navbar-layout-radial"
          >
            <ListItemIcon>{layout === "radial" && <CheckIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>Radial</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleLayoutSelect("geo")} data-testid="navbar-layout-geo">
            <ListItemIcon>{layout === "geo" && <CheckIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>Geo</ListItemText>
          </MenuItem>
        </Menu>

        {/* Find Node */}
        <Tooltip title="Find Node">
          <span>
            <IconButton
              size="small"
              onClick={handleFindNodeClick}
              disabled={!isTopologyActive}
              data-testid="navbar-find-node"
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        {/* Link Labels Dropdown */}
        <Tooltip title="Link Labels">
          <span>
            <IconButton
              size="small"
              onClick={handleLinkLabelClick}
              disabled={!isTopologyActive}
              data-testid="navbar-link-labels"
            >
              <LabelIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Menu
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
            <ListItemIcon>
              {linkLabelMode === "show-all" && <CheckIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>Show All</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLinkLabelSelect("on-select")}
            data-testid="navbar-link-label-on-select"
          >
            <ListItemIcon>
              {linkLabelMode === "on-select" && <CheckIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>On Select</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleLinkLabelSelect("hide")}
            data-testid="navbar-link-label-hide"
          >
            <ListItemIcon>
              {linkLabelMode === "hide" && <CheckIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>Hide</ListItemText>
          </MenuItem>
        </Menu>

        {/* Capture Viewport */}
        <Tooltip title="Capture Viewport as SVG">
          <span>
            <IconButton
              size="small"
              onClick={onCaptureViewport}
              disabled={!isTopologyActive}
              data-testid="navbar-capture"
            >
              <PhotoCameraBackIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        {/* Shortcuts */}
        <Tooltip title="Shortcuts">
          <IconButton size="small" onClick={onShowShortcuts} data-testid="navbar-shortcuts">
            <KeyboardIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Toggle Shortcut Display */}
        <Tooltip title="Toggle Shortcut Display">
          <IconButton
            size="small"
            onClick={onToggleShortcutDisplay}
            data-testid="navbar-shortcut-display"
          >
            {shortcutDisplayEnabled ? (
              <VisibilityIcon fontSize="small" />
            ) : (
              <VisibilityOffIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>

        {/* About */}
        <Tooltip title="About TopoViewer">
          <IconButton size="small" onClick={onShowAbout} data-testid="navbar-about">
            <InfoIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
};
/* eslint-enable complexity */
