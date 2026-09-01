/* eslint-disable import-x/max-dependencies */
// Navbar for React TopoViewer.
import React from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { ActionIcon, Divider, Indicator, Menu, Paper, Tooltip } from "@mantine/core";
import {
  IconSitemap,
  IconCheck,
  IconSparkles,
  IconChevronDown,
  IconInfoCircle,
  IconKeyboard,
  IconTag,
  IconLink,
  IconLock,
  IconLockOpen,
  IconDotsVertical,
  IconPhoto,
  IconPlayerPlay,
  IconArrowForwardUp,
  IconReload,
  IconSettings,
  IconPlayerStop,
  IconArrowBackUp,
  IconEye,
  IconEyeOff
} from "@tabler/icons-react";

import type { SettingsSection } from "../panels/lab-settings";
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

import { NavbarNodeSearch } from "./NavbarNodeSearch";

const ERROR_COLOR = "var(--mantine-color-red-6)";
const SUCCESS_COLOR = "var(--mantine-color-green-6)";
/** Sits above the canvas overlays (z 1300) like the old MUI drawer+2 layer. */
const NAVBAR_Z_INDEX = 1202;

/** Inset of the floating bar from the top/side edges (px). */
export const FLOATING_NAVBAR_INSET = 8;
/** Total vertical space the floating bar occupies, for offsetting content below it. */
export const FLOATING_NAVBAR_HEIGHT = FLOATING_NAVBAR_INSET + 40 + FLOATING_NAVBAR_INSET;

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

type AnchorPos = { top: number; left: number } | null;

// Zero-size target positioned at computed coordinates so a Mantine Menu can
// anchor to an arbitrary point (replacing MUI's anchorReference="anchorPosition").
const MenuAnchor = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { position: AnchorPos }
>(({ position, style, ...rest }, ref) => (
  <div
    ref={ref}
    {...rest}
    style={{
      position: "fixed",
      top: position?.top ?? 0,
      left: position?.left ?? 0,
      width: 0,
      height: 0,
      pointerEvents: "none",
      ...style
    }}
  />
));
MenuAnchor.displayName = "MenuAnchor";

// Fixed-width leading slot that shows a check for the selected option, keeping
// menu labels aligned whether or not the check is present.
function checkLeftSection(selected: boolean): React.ReactNode {
  return (
    <span style={{ display: "inline-flex", width: 20, justifyContent: "center" }}>
      {selected ? <IconCheck size={18} /> : null}
    </span>
  );
}

export interface NavbarProps {
  hasActiveTopology?: boolean;
  layout: LayoutOption;
  onLayoutChange: (layout: LayoutOption) => void;
  onOpenSettings?: (section?: SettingsSection) => void;
  /** Which side the floating action bar docks to. */
  barSide?: "left" | "right";
  /** React Flow instance used by the inline node search to fit the viewport. */
  rfInstance?: ReactFlowInstance | null;
  onCaptureViewport?: () => void;
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
  renderDeployMenuItems?: (context: {
    isViewerMode: boolean;
    closeMenu: () => void;
  }) => React.ReactNode;
}

// This is a UI composition component with lots of conditional rendering and menu wiring.
/* eslint-disable complexity */
export const Navbar: React.FC<NavbarProps> = ({
  hasActiveTopology = true,
  layout,
  onLayoutChange,
  onOpenSettings,
  barSide = "right",
  rfInstance = null,
  onCaptureViewport,
  onShowBulkLink,
  shortcutDisplayEnabled = false,
  onToggleShortcutDisplay,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  linkLabelMode,
  onLinkLabelModeChange,
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

  const handleLabSettings = React.useCallback(() => {
    setMoreMenuPosition(null);
    onOpenSettings?.("lab");
  }, [onOpenSettings]);

  const handleAbout = React.useCallback(() => {
    setMoreMenuPosition(null);
    onOpenSettings?.("info");
  }, [onOpenSettings]);

  const handleShortcuts = React.useCallback(() => {
    setMoreMenuPosition(null);
    onOpenSettings?.("shortcuts");
  }, [onOpenSettings]);

  React.useEffect(() => {
    if (isTopologyActive) return;
    setDeployMenuPosition(null);
    setLayoutMenuPosition(null);
    setLinkLabelMenuPosition(null);
  }, [isTopologyActive]);

  return (
    <Paper
      ref={appBarRef}
      withBorder
      shadow="lg"
      data-testid="topoviewer-navbar"
      style={{
        position: "absolute",
        top: FLOATING_NAVBAR_INSET,
        ...(barSide === "left"
          ? { left: FLOATING_NAVBAR_INSET, right: "auto" }
          : { right: FLOATING_NAVBAR_INSET, left: "auto" }),
        width: "auto",
        overflow: "hidden",
        // Fully rounded pill ends (half of the 40px bar height), Google Earth style.
        borderRadius: "20px",
        zIndex: NAVBAR_Z_INDEX
      }}
    >
      <div
        style={{
          minHeight: 40,
          paddingLeft: 6,
          paddingRight: 6,
          display: "flex",
          alignItems: "center",
          gap: 4
        }}
      >
        {/* Inline node search, sitting to the left of the deploy button */}
        <NavbarNodeSearch rfInstance={rfInstance} disabled={!isTopologyActive} />

        {/* Apply topology (deploys when absent, reconciles when running) */}
        <Tooltip label={applyTooltip}>
          <span>
            <ActionIcon
              variant="subtle"
              color="green"
              onClick={handlePrimaryAction}
              disabled={isApplyDisabled}
              data-testid="navbar-deploy"
            >
              <Indicator
                color="yellow"
                size={8}
                disabled={!showDirtyBadge}
                data-testid="navbar-apply-dirty-badge"
              >
                <IconPlayerPlay size={18} />
              </Indicator>
            </ActionIcon>
          </span>
        </Tooltip>
        <ActionIcon
          variant="subtle"
          color="green"
          onClick={handleDeployMenuOpen}
          disabled={isProcessing || !isTopologyActive}
          aria-haspopup="true"
          aria-expanded={deployMenuOpen ? "true" : undefined}
          data-testid="navbar-deploy-menu"
          style={{ marginLeft: -4 }}
        >
          <IconChevronDown size={18} />
        </ActionIcon>
        <Menu
          opened={deployMenuOpen}
          onClose={handleDeployMenuClose}
          position="bottom"
          offset={0}
          zIndex={NAVBAR_Z_INDEX + 1}
          withinPortal
        >
          <Menu.Target>
            <MenuAnchor position={deployMenuPosition} />
          </Menu.Target>
          <Menu.Dropdown id="deploy-split-menu">
            <Menu.Item
              onClick={handleApply}
              disabled={isApplyDisabled}
              data-testid="navbar-deploy-item-apply"
              leftSection={<IconPlayerPlay size={18} style={{ color: SUCCESS_COLOR }} />}
            >
              Apply
            </Menu.Item>
            <Menu.Item
              onClick={handleDeployCleanup}
              disabled={isProcessing || !isTopologyActive || isDeployed}
              data-testid="navbar-deploy-item-deploy-cleanup"
              leftSection={
                <IconSparkles size={18} style={{ color: SUCCESS_COLOR }} />
              }
            >
              Deploy (cleanup)
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              onClick={handleRedeploy}
              disabled={isRunningActionDisabled}
              data-testid="navbar-deploy-item-redeploy"
              leftSection={<IconReload size={18} style={{ color: SUCCESS_COLOR }} />}
            >
              Redeploy
            </Menu.Item>
            <Menu.Item
              onClick={handleRedeployCleanup}
              disabled={isRunningActionDisabled}
              data-testid="navbar-deploy-item-redeploy-cleanup"
              leftSection={
                <IconSparkles size={18} style={{ color: SUCCESS_COLOR }} />
              }
            >
              Redeploy (cleanup)
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              onClick={handleDestroy}
              disabled={isRunningActionDisabled}
              data-testid="navbar-deploy-item-destroy"
              leftSection={<IconPlayerStop size={18} style={{ color: ERROR_COLOR }} />}
            >
              Destroy
            </Menu.Item>
            <Menu.Item
              onClick={handleDestroyCleanup}
              disabled={isRunningActionDisabled}
              data-testid="navbar-deploy-item-destroy-cleanup"
              leftSection={<IconSparkles size={18} style={{ color: ERROR_COLOR }} />}
            >
              Destroy (cleanup)
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              onClick={handleStartLab}
              disabled={isRunningActionDisabled}
              data-testid="navbar-deploy-item-start-lab"
              leftSection={<IconPlayerPlay size={18} style={{ color: SUCCESS_COLOR }} />}
            >
              Start Nodes
            </Menu.Item>
            <Menu.Item
              onClick={handleStopLab}
              disabled={isRunningActionDisabled}
              data-testid="navbar-deploy-item-stop-lab"
              leftSection={<IconPlayerStop size={18} style={{ color: ERROR_COLOR }} />}
            >
              Stop Nodes
            </Menu.Item>
            <Menu.Item
              onClick={handleRestartLab}
              disabled={isRunningActionDisabled}
              data-testid="navbar-deploy-item-restart-lab"
              leftSection={<IconReload size={18} style={{ color: SUCCESS_COLOR }} />}
            >
              Restart Nodes
            </Menu.Item>
            {extraDeployMenuItems ? <Menu.Divider /> : null}
            {extraDeployMenuItems}
          </Menu.Dropdown>
        </Menu>

        <Divider
          orientation="vertical"
          style={{ marginLeft: 8, marginRight: 8, height: 24, alignSelf: "center" }}
        />

        {/* Lock / Unlock */}
        <Tooltip label={isLocked ? "Unlock lab to edit" : "Lock Lab"}>
          <span>
            <ActionIcon
              variant="subtle"
              color={isLocked ? "red" : "gray"}
              onClick={toggleLock}
              disabled={isProcessing || !isTopologyActive}
              data-testid="navbar-lock"
            >
              {isLocked ? <IconLock size={18} /> : <IconLockOpen size={18} />}
            </ActionIcon>
          </span>
        </Tooltip>

        {/* Undo - only show in edit mode */}
        {isEditMode && (
          <Tooltip label="Undo (Ctrl+Z)">
            <span>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={onUndo}
                disabled={!isTopologyActive || !canUndo}
                data-testid="navbar-undo"
              >
                <IconArrowBackUp size={18} />
              </ActionIcon>
            </span>
          </Tooltip>
        )}

        {/* Redo - only show in edit mode */}
        {isEditMode && (
          <Tooltip label="Redo (Ctrl+Y)">
            <span>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={onRedo}
                disabled={!isTopologyActive || !canRedo}
                data-testid="navbar-redo"
              >
                <IconArrowForwardUp size={18} />
              </ActionIcon>
            </span>
          </Tooltip>
        )}

        <Divider
          orientation="vertical"
          style={{ marginLeft: 8, marginRight: 8, height: 24, alignSelf: "center" }}
        />

        {/* Bulk Link - only show in edit mode */}
        {isEditMode && (
          <Tooltip label="Bulk Link Devices">
            <span>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={onShowBulkLink}
                disabled={!isTopologyActive || isLocked}
                data-testid="navbar-bulk-link"
              >
                <IconLink size={18} />
              </ActionIcon>
            </span>
          </Tooltip>
        )}

        {/* Layout Manager */}
        <Tooltip label="Layout">
          <span>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={handleLayoutClick}
              disabled={!isTopologyActive}
              data-testid="navbar-layout"
            >
              <IconSitemap size={18} />
            </ActionIcon>
          </span>
        </Tooltip>
        <Menu
          opened={layoutMenuOpen}
          onClose={handleLayoutClose}
          position="bottom"
          offset={0}
          zIndex={NAVBAR_Z_INDEX + 1}
          withinPortal
        >
          <Menu.Target>
            <MenuAnchor position={layoutMenuPosition} />
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={() => handleLayoutSelect("preset")}
              data-testid="navbar-layout-preset"
              leftSection={checkLeftSection(layout === "preset")}
            >
              Preset
            </Menu.Item>
            <Menu.Item
              onClick={() => handleLayoutSelect("force")}
              disabled={isGeneratedLayoutDisabled}
              data-testid="navbar-layout-force"
              leftSection={checkLeftSection(layout === "force")}
            >
              Force
            </Menu.Item>
            <Menu.Item
              onClick={() => handleLayoutSelect("auto")}
              disabled={isGeneratedLayoutDisabled}
              data-testid="navbar-layout-auto"
              leftSection={checkLeftSection(layout === "auto")}
            >
              Auto
            </Menu.Item>
            <Menu.Item
              onClick={() => handleLayoutSelect("radial")}
              disabled={isGeneratedLayoutDisabled}
              data-testid="navbar-layout-radial"
              leftSection={checkLeftSection(layout === "radial")}
            >
              Radial
            </Menu.Item>
            <Menu.Item
              onClick={() => handleLayoutSelect("geo")}
              data-testid="navbar-layout-geo"
              leftSection={checkLeftSection(layout === "geo")}
            >
              Geo
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>

        {/* Link Labels Dropdown */}
        <Tooltip label="Link Labels">
          <span>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={handleLinkLabelClick}
              disabled={!isTopologyActive}
              data-testid="navbar-link-labels"
            >
              <IconTag size={18} />
            </ActionIcon>
          </span>
        </Tooltip>
        <Menu
          opened={linkLabelMenuOpen}
          onClose={handleLinkLabelClose}
          position="bottom"
          offset={0}
          zIndex={NAVBAR_Z_INDEX + 1}
          withinPortal
        >
          <Menu.Target>
            <MenuAnchor position={linkLabelMenuPosition} />
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={() => handleLinkLabelSelect("show-all")}
              data-testid="navbar-link-label-show-all"
              leftSection={checkLeftSection(linkLabelMode === "show-all")}
            >
              Show All
            </Menu.Item>
            <Menu.Item
              onClick={() => handleLinkLabelSelect("on-select")}
              data-testid="navbar-link-label-on-select"
              leftSection={checkLeftSection(linkLabelMode === "on-select")}
            >
              On Select
            </Menu.Item>
            <Menu.Item
              onClick={() => handleLinkLabelSelect("hide")}
              data-testid="navbar-link-label-hide"
              leftSection={checkLeftSection(linkLabelMode === "hide")}
            >
              Hide
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>

        {/* Capture Viewport */}
        <Tooltip label="Capture Viewport as SVG">
          <span>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={onCaptureViewport}
              disabled={!isTopologyActive}
              data-testid="navbar-capture"
            >
              <IconPhoto size={18} />
            </ActionIcon>
          </span>
        </Tooltip>

        <Divider
          orientation="vertical"
          style={{ marginLeft: 8, marginRight: 8, height: 24, alignSelf: "center" }}
        />

        {/* Toggle Shortcut Display */}
        <Tooltip label="Toggle Shortcut Display">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onToggleShortcutDisplay}
            data-testid="navbar-shortcut-display"
          >
            {shortcutDisplayEnabled ? (
              <IconEye size={18} />
            ) : (
              <IconEyeOff size={18} />
            )}
          </ActionIcon>
        </Tooltip>

        {/* Overflow menu */}
        <Tooltip label="More">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={handleMoreMenuOpen}
            aria-haspopup="true"
            aria-expanded={moreMenuOpen ? "true" : undefined}
            data-testid="navbar-more"
          >
            <IconDotsVertical size={18} />
          </ActionIcon>
        </Tooltip>
        <Menu
          opened={moreMenuOpen}
          onClose={handleMoreMenuClose}
          position="bottom"
          offset={0}
          zIndex={NAVBAR_Z_INDEX + 1}
          withinPortal
        >
          <Menu.Target>
            <MenuAnchor position={moreMenuPosition} />
          </Menu.Target>
          <Menu.Dropdown id="navbar-more-menu">
            <Menu.Item
              onClick={handleLabSettings}
              disabled={!isTopologyActive}
              data-testid="navbar-more-lab-settings"
              leftSection={<IconSettings size={18} />}
            >
              Lab Settings
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              onClick={handleShortcuts}
              data-testid="navbar-more-shortcuts"
              leftSection={<IconKeyboard size={18} />}
            >
              Keyboard Shortcuts
            </Menu.Item>
            <Menu.Item
              onClick={handleAbout}
              data-testid="navbar-more-about"
              leftSection={<IconInfoCircle size={18} />}
            >
              Info
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
    </Paper>
  );
};
/* eslint-enable complexity */
