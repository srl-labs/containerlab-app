/**
 * usePanelCommands - Hooks providing deployment callbacks and panel visibility management.
 *
 * Simplified for the new UI model:
 * - ContextPanel (left drawer) with auto-open on selection
 * - MUI Dialogs for modals (LabSettings, Shortcuts, SvgExport, BulkLink, About)
 * - MUI Popovers for Grid and Find (anchor-based)
 */
import { useCallback, useState } from "react";

import { useClabUiHost } from "../../host";
import type { SettingsSection } from "../../components/panels/lab-settings";

export interface DeploymentCommands {
  onApply: () => void;
  onDeploy: () => void;
  onDeployCleanup: () => void;
  onDestroy: () => void;
  onDestroyCleanup: () => void;
  onRedeploy: () => void;
  onRedeployCleanup: () => void;
  onStartLab: () => void;
  onStopLab: () => void;
  onRestartLab: () => void;
}

// Keep deployment commands - they need extension to run containerlab CLI
export function useDeploymentCommands(): DeploymentCommands {
  const { topoViewer } = useClabUiHost();

  return {
    onApply: useCallback(() => topoViewer.runLifecycle("applyLab"), [topoViewer]),
    onDeploy: useCallback(() => topoViewer.runLifecycle("deployLab"), [topoViewer]),
    onDeployCleanup: useCallback(() => topoViewer.runLifecycle("deployLabCleanup"), [topoViewer]),
    onDestroy: useCallback(() => topoViewer.runLifecycle("destroyLab"), [topoViewer]),
    onDestroyCleanup: useCallback(
      () => topoViewer.runLifecycle("destroyLabCleanup"),
      [topoViewer]
    ),
    onRedeploy: useCallback(() => topoViewer.runLifecycle("redeployLab"), [topoViewer]),
    onRedeployCleanup: useCallback(
      () => topoViewer.runLifecycle("redeployLabCleanup"),
      [topoViewer]
    ),
    onStartLab: useCallback(() => topoViewer.runLifecycle("startLab"), [topoViewer]),
    onStopLab: useCallback(() => topoViewer.runLifecycle("stopLab"), [topoViewer]),
    onRestartLab: useCallback(() => topoViewer.runLifecycle("restartLab"), [topoViewer])
  };
}

// ============================================================================
// Panel Visibility Management
// ============================================================================

/** Which view the global sidebar shows. */
export type SidebarView = "palette" | "explorer" | "files";

export interface PanelVisibility {
  // Context panel (left drawer)
  isContextPanelOpen: boolean;
  /** Why the panel is open. Used to decide how pane-click should behave. */
  contextPanelOpenReason: "manual" | "auto" | null;
  /** Which side the whole sidebar/rail (and mirrored chrome) sits on. */
  sidebarSide: "left" | "right";
  handleToggleSidebarSide: () => void;
  /** The active view in the global sidebar (rail selection). */
  activeSidebarView: SidebarView;
  setActiveSidebarView: (view: SidebarView) => void;
  /** Whether selecting or editing a node auto-opens the palette panel. */
  autoOpenOnInteraction: boolean;
  /**
   * Open the ContextPanel.
   * Note: this is also used directly as an `onClick` handler, so it may receive a mouse event;
   * non-string inputs are treated as a manual open.
   */
  handleOpenContextPanel: (reason?: "manual" | "auto" | MouseEvent) => void;
  handleCloseContextPanel: () => void;
  handleToggleContextPanel: () => void;
  handleToggleAutoOpen: () => void;

  // Modals
  showLabSettingsModal: boolean;
  showSvgExportModal: boolean;
  showBulkLinkModal: boolean;
  showAboutPanel: boolean;
  settingsSection: SettingsSection;
  handleShowLabSettings: (section?: SettingsSection) => void;
  handleShowSvgExport: () => void;
  handleShowBulkLink: () => void;
  handleShowAbout: () => void;
  handleCloseLabSettings: () => void;
  handleCloseSvgExport: () => void;
  handleCloseBulkLink: () => void;
  handleCloseAbout: () => void;

  // Popovers (position based)
  gridPopoverPosition: { top: number; left: number } | null;
  handleOpenGridPopover: (position: { top: number; left: number }) => void;
  handleCloseGridPopover: () => void;
}

const AUTO_OPEN_KEY = "contextPanelAutoOpen";
const SIDEBAR_SIDE_KEY = "clabSidebarSide";

function useContextPanel() {
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(true);
  const [contextPanelOpenReason, setContextPanelOpenReason] = useState<"manual" | "auto" | null>(
    "manual"
  );
  const [sidebarSide, setSidebarSide] = useState<"left" | "right">(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_SIDE_KEY) === "right" ? "right" : "left";
    } catch {
      return "left";
    }
  });
  const [autoOpenOnInteraction, setAutoOpenOnInteraction] = useState<boolean>(() => {
    try {
      // Defaults to on; only an explicit "false" disables it.
      return window.localStorage.getItem(AUTO_OPEN_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [activeSidebarView, setActiveSidebarView] = useState<SidebarView>("palette");

  return {
    isContextPanelOpen,
    contextPanelOpenReason,
    sidebarSide,
    handleToggleSidebarSide: useCallback(() => {
      setSidebarSide((prev) => {
        const next = prev === "left" ? "right" : "left";
        try {
          window.localStorage.setItem(SIDEBAR_SIDE_KEY, next);
        } catch {
          /* ignore */
        }
        return next;
      });
    }, []),
    activeSidebarView,
    setActiveSidebarView,
    autoOpenOnInteraction,
    handleOpenContextPanel: useCallback((reason?: unknown) => {
      // React passes the click event as the first arg when used as an onClick handler.
      const normalizedReason: "manual" | "auto" = reason === "auto" ? "auto" : "manual";
      setIsContextPanelOpen(true);
      setContextPanelOpenReason(normalizedReason);
    }, []),
    handleCloseContextPanel: useCallback(() => {
      setIsContextPanelOpen(false);
      setContextPanelOpenReason(null);
    }, []),
    handleToggleContextPanel: useCallback(() => {
      setIsContextPanelOpen((prev) => {
        const next = !prev;
        setContextPanelOpenReason(next ? "manual" : null);
        return next;
      });
    }, []),
    handleToggleAutoOpen: useCallback(() => {
      setAutoOpenOnInteraction((prev) => {
        const next = !prev;
        try {
          window.localStorage.setItem(AUTO_OPEN_KEY, String(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }, [])
  };
}

function useModals() {
  const [showLabSettingsModal, setShowLabSettingsModal] = useState(false);
  const [showSvgExportModal, setShowSvgExportModal] = useState(false);
  const [showBulkLinkModal, setShowBulkLinkModal] = useState(false);
  const [showAboutPanel, setShowAboutPanel] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("lab");

  return {
    showLabSettingsModal,
    showSvgExportModal,
    showBulkLinkModal,
    showAboutPanel,
    settingsSection,
    handleShowLabSettings: useCallback((section?: SettingsSection) => {
      setSettingsSection(section ?? "lab");
      setShowLabSettingsModal(true);
    }, []),
    handleShowSvgExport: useCallback(() => setShowSvgExportModal(true), []),
    handleShowBulkLink: useCallback(() => setShowBulkLinkModal(true), []),
    handleShowAbout: useCallback(() => setShowAboutPanel((prev) => !prev), []),
    handleCloseLabSettings: useCallback(() => setShowLabSettingsModal(false), []),
    handleCloseSvgExport: useCallback(() => setShowSvgExportModal(false), []),
    handleCloseBulkLink: useCallback(() => setShowBulkLinkModal(false), []),
    handleCloseAbout: useCallback(() => setShowAboutPanel(false), [])
  };
}

function usePopovers() {
  const [gridPopoverPosition, setGridPopoverPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  return {
    gridPopoverPosition,
    handleOpenGridPopover: useCallback(
      (position: { top: number; left: number }) => setGridPopoverPosition(position),
      []
    ),
    handleCloseGridPopover: useCallback(() => setGridPopoverPosition(null), [])
  };
}

export function usePanelVisibility(): PanelVisibility {
  const contextPanel = useContextPanel();
  const modals = useModals();
  const popovers = usePopovers();

  return { ...contextPanel, ...modals, ...popovers };
}
