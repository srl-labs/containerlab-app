// Lab settings dialog.
import React, { useCallback, useEffect, useRef, useState } from "react";
import AccountTreeIcon from "@mui/icons-material/AccountTreeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import GridOnOutlinedIcon from "@mui/icons-material/GridOnOutlined";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import LockIcon from "@mui/icons-material/LockOutlined";
import LockOpenIcon from "@mui/icons-material/LockOpenOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";

import { SettingsLayout } from "../../../settings/SettingsLayout";
import { useIsProcessing, useTopoViewerActions } from "../../../stores/topoViewerStore";
import { floatingSurfaceSx, lockedButtonSx, overlayShadow } from "../../../theme/surfaces";
import { LabSettingsSection } from "../lab-drawer/LabSettingsSection";
import type { GridSettingsControlsProps } from "../GridSettingsPopover";

import type { LabSettings } from "./types";

const LAB_SETTINGS_SECTIONS = [
  {
    key: "basic",
    label: "Basic",
    description: "Lab name and container prefix",
    icon: <AccountTreeIcon fontSize="small" />
  },
  {
    key: "mgmt",
    label: "Management",
    description: "Management subnet and docker network",
    icon: <LanOutlinedIcon fontSize="small" />
  },
  {
    key: "appearance",
    label: "Appearance",
    description: "Node style, link labels and telemetry appearance",
    icon: <PaletteOutlinedIcon fontSize="small" />
  },
  {
    key: "grid",
    label: "Grid",
    description: "Canvas grid stroke and colors",
    icon: <GridOnOutlinedIcon fontSize="small" />
  }
] as const;

type LabSettingsSectionKey = (typeof LAB_SETTINGS_SECTIONS)[number]["key"];

interface LabSettingsModalProps extends GridSettingsControlsProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "view" | "edit";
  isLocked: boolean;
  labSettings?: LabSettings;
}

export const LabSettingsModal: React.FC<LabSettingsModalProps> = ({
  isOpen,
  onClose,
  mode,
  isLocked,
  labSettings,
  gridLineWidth,
  onGridLineWidthChange,
  gridStyle,
  onGridStyleChange,
  gridColor,
  onGridColorChange,
  gridBgColor,
  onGridBgColorChange,
  onResetGridColors
}) => {
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  const [activeSection, setActiveSection] = useState<LabSettingsSectionKey>("basic");
  const isProcessing = useIsProcessing();
  const { toggleLock } = useTopoViewerActions();
  const canSave = !isLocked;
  const lockLabel = isLocked ? "Unlock lab to edit" : "Lock Lab";
  const active = LAB_SETTINGS_SECTIONS.find((section) => section.key === activeSection) ?? LAB_SETTINGS_SECTIONS[0];
  useEffect(() => {
    if (isOpen) setActiveSection("basic");
  }, [isOpen]);
  const handleSaveClick = useCallback(() => {
    const save = saveRef.current;
    if (!save) {
      return;
    }
    save().catch((error) => {
      console.error("Failed to save lab settings", error);
    });
  }, []);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="containerlab-lab-settings-title"
      data-testid="lab-settings-modal"
      slotProps={{
        paper: {
          sx: {
            ...floatingSurfaceSx,
            boxShadow: overlayShadow,
            // Four short sections: size for the content, not the screen.
            minHeight: { xs: "calc(100vh - 32px)", md: 0 },
            height: { xs: "calc(100vh - 32px)", md: "min(560px, 80vh)" },
            overflow: "hidden"
          }
        }
      }}
    >
      <SettingsLayout
        title="Lab Settings"
        titleId="containerlab-lab-settings-title"
        items={[...LAB_SETTINGS_SECTIONS]}
        active={activeSection}
        onSelect={(key) => setActiveSection(key as LabSettingsSectionKey)}
        navigationTestIdPrefix="lab-settings-tab-"
        sectionTitle={active.label}
        sectionDescription={active.description}
        headerActions={
          <>
            <Tooltip title={lockLabel}>
              <span>
                <IconButton
                  size="small"
                  onClick={toggleLock}
                  disabled={isProcessing}
                  aria-label={lockLabel}
                  data-testid="lab-settings-lock-btn"
                  sx={isLocked ? lockedButtonSx : undefined}
                >
                  {isLocked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
            <IconButton
              size="small"
              onClick={onClose}
              data-testid="lab-settings-close-btn"
              aria-label="Close lab settings"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        }
        footer={
          <>
            <span />
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button variant="outlined" onClick={onClose}>
                Close
              </Button>
              {canSave ? (
                <Button onClick={handleSaveClick} data-testid="lab-settings-save-btn">
                  Apply
                </Button>
              ) : null}
            </Box>
          </>
        }
      >
        <LabSettingsSection
          mode={mode}
          isLocked={isLocked}
          labSettings={labSettings}
          onClose={onClose}
          saveRef={saveRef}
          activeTab={activeSection}
          gridLineWidth={gridLineWidth}
          onGridLineWidthChange={onGridLineWidthChange}
          gridStyle={gridStyle}
          onGridStyleChange={onGridStyleChange}
          gridColor={gridColor}
          onGridColorChange={onGridColorChange}
          gridBgColor={gridBgColor}
          onGridBgColorChange={onGridBgColorChange}
          onResetGridColors={onResetGridColors}
        />
      </SettingsLayout>
    </Dialog>
  );
};
