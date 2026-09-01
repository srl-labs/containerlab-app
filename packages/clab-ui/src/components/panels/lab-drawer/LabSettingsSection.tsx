// Lab and viewer settings content, one section at a time.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "@mantine/core";

import { useTopologySessionClient } from "../../../host";
import { useLabSettingsState } from "../../../hooks/editor";
import {
  saveAnnotationNodesAndViewerSettings,
  saveViewerSettings
} from "../../../services";
import { useGraphStore, useTopoViewerStore } from "../../../stores";
import type { GridSettingsControlsProps } from "../GridSettingsPopover";
import {
  BasicTab,
  MgmtTab,
  AppearanceTab,
  type LabSettings,
  type SettingsSection
} from "../lab-settings";

import { syncRateLabelAnnotationsForLinks } from "./trafficRateAnnotationAutoCreate";

export interface LabSettingsSectionProps extends GridSettingsControlsProps {
  mode: "view" | "edit";
  isLocked: boolean;
  labSettings?: LabSettings;
  /** Which section to render; "info" is owned by the modal and renders nothing here. */
  section: SettingsSection;
  onClose: () => void;
  saveRef?: React.RefObject<(() => Promise<void>) | null>;
}

export const LabSettingsSection: React.FC<LabSettingsSectionProps> = ({
  mode,
  isLocked,
  labSettings,
  section,
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

  return (
    <Box>
      {section === "lab" && (
        <Box style={{ padding: 16 }}>
          <BasicTab
            basic={state.basic}
            setBasic={state.setBasic}
            isViewMode={areTopologySettingsReadOnly}
          />
        </Box>
      )}

      {section === "mgmt" && (
        <MgmtTab
          mgmt={state.mgmt}
          setMgmt={state.setMgmt}
          driverOpts={state.driverOpts}
          isViewMode={areTopologySettingsReadOnly}
        />
      )}

      {(section === "appearance" || section === "grid") && (
        <AppearanceTab
          section={section === "grid" ? "grid" : "style"}
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
      )}
    </Box>
  );
};
