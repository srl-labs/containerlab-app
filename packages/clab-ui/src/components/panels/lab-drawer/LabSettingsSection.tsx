// Lab settings with Basic and Management tabs.
import React, { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";

import { useTopologySessionClient } from "../../../host";
import { useLabSettingsState } from "../../../hooks/editor";
import {
  saveAnnotationNodesAndViewerSettings,
  saveViewerSettings
} from "../../../services";
import { useGraphStore, useTopoViewerStore } from "../../../stores";
import type { GridSettingsControlsProps } from "../GridSettingsPopover";
import { BasicTab, MgmtTab, AppearanceTab, type LabSettings } from "../lab-settings";

import { syncRateLabelAnnotationsForLinks } from "./trafficRateAnnotationAutoCreate";

export interface LabSettingsSectionProps extends GridSettingsControlsProps {
  mode: "view" | "edit";
  isLocked: boolean;
  labSettings?: LabSettings;
  onClose: () => void;
  saveRef?: React.RefObject<(() => Promise<void>) | null>;
}

export const LabSettingsSection: React.FC<LabSettingsSectionProps> = ({
  mode,
  isLocked,
  labSettings,
  onClose,
  saveRef,
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
  const [activeTab, setActiveTab] = useState("basic");
  const areTopologySettingsReadOnly = mode === "view" || isLocked;
  const isAppearanceReadOnly = isLocked;

  const state = useLabSettingsState(labSettings);
  const sessionClient = useTopologySessionClient();
  const showRateLabels = useTopoViewerStore((store) => store.showRateLabels);
  const setShowRateLabels = useTopoViewerStore((store) => store.setShowRateLabels);
  const [draftShowRateLabels, setDraftShowRateLabels] = useState(showRateLabels);
  const showRateLabelsEditedRef = useRef(false);

  useEffect(() => {
    if (showRateLabelsEditedRef.current) return;
    setDraftShowRateLabels(showRateLabels);
  }, [showRateLabels]);

  const handleShowRateLabelsChange = useCallback((enabled: boolean) => {
    showRateLabelsEditedRef.current = true;
    setDraftShowRateLabels(enabled);
  }, []);

  const handleSave = async () => {
    if (!areTopologySettingsReadOnly) {
      await state.handleSave();
    }
    const {
      linkLabelMode,
      lastNonTelemetryLinkLabelMode,
      telemetryNodeSizePx,
      telemetryInterfaceSizePercent
    } = useTopoViewerStore.getState();
    const graphStore = useGraphStore.getState();
    const result = syncRateLabelAnnotationsForLinks(
      graphStore.nodes,
      graphStore.edges,
      draftShowRateLabels
    );
    const style: "default" | "telemetry-style" =
      linkLabelMode === "telemetry-style" ? "telemetry-style" : "default";
    const nextLastNonTelemetryLinkLabelMode =
      linkLabelMode === "telemetry-style" ? lastNonTelemetryLinkLabelMode : linkLabelMode;
    const viewerSettings = {
      style,
      linkLabelMode,
      lastNonTelemetryLinkLabelMode: nextLastNonTelemetryLinkLabelMode,
      telemetryNodeSizePx,
      telemetryInterfaceSizePercent,
      showRateLabels: draftShowRateLabels,
      autoCreateTrafficRateAnnotations: draftShowRateLabels,
      gridLineWidth,
      gridStyle,
      gridColor,
      gridBgColor
    };
    setShowRateLabels(draftShowRateLabels);
    if (result.createdCount > 0 || result.removedCount > 0) {
      graphStore.setNodes(result.nodes);
      await saveAnnotationNodesAndViewerSettings(sessionClient, result.nodes, viewerSettings);
    } else {
      await saveViewerSettings(sessionClient, viewerSettings);
    }
    onClose();
  };

  if (saveRef) saveRef.current = handleSave;

  const handleTabChange = (_event: React.SyntheticEvent, newValue: string) => {
    setActiveTab(newValue);
  };

  return (
    <Box>
      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        sx={{ position: "sticky", top: 0, zIndex: 1, bgcolor: "background.paper" }}
      >
        <Tab label="Basic" value="basic" data-testid="lab-settings-tab-basic" />
        <Tab label="Management Network" value="mgmt" data-testid="lab-settings-tab-mgmt" />
        <Tab label="Appearance" value="appearance" data-testid="lab-settings-tab-appearance" />
      </Tabs>
      <Divider />

      {activeTab === "basic" && (
        <Box sx={{ p: 2 }}>
          <BasicTab
            basic={state.basic}
            setBasic={state.setBasic}
            isViewMode={areTopologySettingsReadOnly}
          />
        </Box>
      )}

      {activeTab === "mgmt" && (
        <MgmtTab
          mgmt={state.mgmt}
          setMgmt={state.setMgmt}
          driverOpts={state.driverOpts}
          isViewMode={areTopologySettingsReadOnly}
        />
      )}

      {activeTab === "appearance" && (
        <Box sx={{ p: 2 }}>
          <AppearanceTab
            gridLineWidth={gridLineWidth}
            onGridLineWidthChange={onGridLineWidthChange}
            gridStyle={gridStyle}
            onGridStyleChange={onGridStyleChange}
            gridColor={gridColor}
            onGridColorChange={onGridColorChange}
            gridBgColor={gridBgColor}
            onGridBgColorChange={onGridBgColorChange}
            onResetGridColors={onResetGridColors}
            isReadOnly={isAppearanceReadOnly}
            showRateLabels={draftShowRateLabels}
            onShowRateLabelsChange={handleShowRateLabelsChange}
          />
        </Box>
      )}
    </Box>
  );
};
