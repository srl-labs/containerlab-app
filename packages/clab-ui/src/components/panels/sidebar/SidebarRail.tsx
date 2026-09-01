// Fixed activity rail that switches the global sidebar between views and flips the layout.
import React from "react";
import { ActionIcon, Box, Tooltip } from "@mantine/core";
import {
  IconPencil,
  IconSitemap,
  IconFolder,
  IconArrowsLeftRight,
  IconAdjustments,
  IconSun,
  IconMoon,
  IconHelp
} from "@tabler/icons-react";

import { useLabName } from "../../../stores/topoViewerStore";
import type { SidebarView } from "../../../hooks/ui/usePanelCommands";
import { ContainerlabLogo } from "../../navbar/ContainerlabLogo";

export const SIDEBAR_RAIL_WIDTH = 48;

const RAIL_BUTTON_SIZE = 36;

interface RailItem {
  view: SidebarView;
  label: string;
  icon: React.ReactNode;
}

export interface SidebarRailProps {
  activeView: SidebarView;
  isOpen: boolean;
  /** Which side the rail sits on; controls border and tooltip orientation. */
  side: "left" | "right";
  /** Whether the Explorer (labs) view is available in this build. */
  showExplorer: boolean;
  /** Whether the File Explorer view is available in this build. */
  showFiles: boolean;
  /** Whether the Palette view is available (only meaningful with an active topology). */
  showPalette: boolean;
  /** Open the sidebar on the given view (or switch to it if already open). */
  onSelectView: (view: SidebarView) => void;
  /** Close the sidebar (clicking the already-active view). */
  onClose: () => void;
  /** Flip the whole layout to the opposite side. */
  onToggleSide: () => void;
  /** Open the TopoViewer settings. */
  onOpenSettings: () => void;
  /** Open the Help & Feedback dialog. */
  onOpenHelp: () => void;
  /** Optional light/dark control; hidden when the host doesn't provide one. */
  colorScheme?: {
    mode: "light" | "dark";
    onToggle: () => void;
  };
}

export const SidebarRail: React.FC<SidebarRailProps> = ({
  activeView,
  isOpen,
  side,
  showExplorer,
  showFiles,
  showPalette,
  onSelectView,
  onClose,
  onToggleSide,
  onOpenSettings,
  onOpenHelp,
  colorScheme
}) => {
  const labName = useLabName();
  const tooltipPlacement = side === "left" ? "right" : "left";
  const items: RailItem[] = [
    ...(showPalette
      ? [{ view: "palette" as const, label: "Palette", icon: <IconPencil size={18} /> }]
      : []),
    ...(showExplorer
      ? [{ view: "explorer" as const, label: "Labs", icon: <IconSitemap size={18} /> }]
      : []),
    ...(showFiles
      ? [
          {
            view: "files" as const,
            label: "File Explorer",
            icon: <IconFolder size={18} />
          }
        ]
      : [])
  ];

  return (
    <Box
      data-testid="sidebar-rail"
      role="tablist"
      aria-orientation="vertical"
      style={{
        width: SIDEBAR_RAIL_WIDTH,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        paddingTop: 8,
        paddingBottom: 8,
        [side === "left" ? "borderRight" : "borderLeft"]:
          "1px solid var(--mantine-color-default-border)",
        backgroundColor: "var(--mantine-color-body)",
        zIndex: 1
      }}
    >
      {/* Scoped shrink of the fixed-size logo svg to match the rail. */}
      <style>{".sidebar-rail-logo svg{width:22px;height:22px;}"}</style>
      {/* Fixed brand icon; hover reveals the lab name. Not interactive. */}
      <Tooltip label={labName || "TopoViewer"} position={tooltipPlacement}>
        <Box
          data-testid="sidebar-rail-logo"
          className="sidebar-rail-logo"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: RAIL_BUTTON_SIZE,
            height: RAIL_BUTTON_SIZE,
            marginBottom: 4
          }}
        >
          <ContainerlabLogo />
        </Box>
      </Tooltip>

      {items.map((item) => {
        const isActive = isOpen && activeView === item.view;
        return (
          <Tooltip key={item.view} label={item.label} position={tooltipPlacement}>
            <ActionIcon
              variant={isActive ? "light" : "subtle"}
              color={isActive ? "blue" : "gray"}
              radius="sm"
              role="tab"
              aria-selected={isActive}
              onClick={() => (isActive ? onClose() : onSelectView(item.view))}
              data-testid={`sidebar-rail-${item.view}`}
              style={{ width: RAIL_BUTTON_SIZE, height: RAIL_BUTTON_SIZE }}
            >
              {item.icon}
            </ActionIcon>
          </Tooltip>
        );
      })}

      <Box style={{ flexGrow: 1 }} />

      {/* Help & feedback links. */}
      <Tooltip label="Help & Feedback" position={tooltipPlacement}>
        <ActionIcon
          variant="subtle"
          color="gray"
          radius="sm"
          onClick={onOpenHelp}
          data-testid="sidebar-rail-help"
          style={{ width: RAIL_BUTTON_SIZE, height: RAIL_BUTTON_SIZE }}
        >
          <IconHelp size={18} />
        </ActionIcon>
      </Tooltip>

      {/* Light/dark toggle, when the host exposes theme control. */}
      {colorScheme && (
        <Tooltip
          label={colorScheme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          position={tooltipPlacement}
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            radius="sm"
            onClick={colorScheme.onToggle}
            data-testid="sidebar-rail-theme"
            style={{ width: RAIL_BUTTON_SIZE, height: RAIL_BUTTON_SIZE }}
          >
            {colorScheme.mode === "dark" ? (
              <IconMoon size={18} />
            ) : (
              <IconSun size={18} />
            )}
          </ActionIcon>
        </Tooltip>
      )}

      {/* TopoViewer settings, anchored to the bottom of the rail. */}
      <Tooltip label="TopoViewer Settings" position={tooltipPlacement}>
        <ActionIcon
          variant="subtle"
          color="gray"
          radius="sm"
          onClick={onOpenSettings}
          data-testid="sidebar-rail-settings"
          style={{ width: RAIL_BUTTON_SIZE, height: RAIL_BUTTON_SIZE }}
        >
          <IconAdjustments size={18} />
        </ActionIcon>
      </Tooltip>

      {/* Flip the whole UI to the opposite side. */}
      <Tooltip label="Flip layout" position={tooltipPlacement}>
        <ActionIcon
          variant="subtle"
          color="gray"
          radius="sm"
          onClick={onToggleSide}
          data-testid="sidebar-rail-flip"
          style={{ width: RAIL_BUTTON_SIZE, height: RAIL_BUTTON_SIZE }}
        >
          <IconArrowsLeftRight size={18} />
        </ActionIcon>
      </Tooltip>
    </Box>
  );
};
