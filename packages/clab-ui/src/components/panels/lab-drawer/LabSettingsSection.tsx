// Lab settings with Basic, Deploy, Management, Certificates, Appearance, and Grid sections.
import React, { useCallback, useEffect, useRef, useState } from "react";

import { useClabUiHost, useTopologySessionClient } from "../../../host";
import { labHostRuntimeLabel } from "../../../host/labHostSupport";
import { useLabSettingsState } from "../../../hooks/editor";
import {
  saveAnnotationNodesAndViewerSettings,
  saveViewerSettings
} from "../../../services";
import { useGraphStore, useTopoViewerStore } from "../../../stores";
import { useLabHostStore } from "../../../stores/labHostStore";
import type { GridSettingsControlsProps } from "../GridSettingsPopover";
import {
  BasicTab,
  MgmtTab,
  CertificatesTab,
  InheritanceTab,
  AppearanceTab,
  GridTab,
  type LabSettings
} from "../lab-settings";

import { DeployTab } from "../lab-settings/DeployTab";
import { useLabDeploySettings } from "../lab-settings/useLabDeploySettings";

import { syncRateLabelAnnotationsForLinks } from "./trafficRateAnnotationAutoCreate";

export interface LabSettingsSectionProps extends GridSettingsControlsProps {
  mode: "view" | "edit";
  isLocked: boolean;
  labSettings?: LabSettings;
  saveRef?: React.RefObject<(() => Promise<void>) | null>;
  activeTab: "basic" | "deploy" | "mgmt" | "certificates" | "inheritance" | "appearance" | "grid";
  /** Called instead of saving when a section has errors, with the section to show */
  onInvalid?: (tab: "deploy" | "mgmt" | "certificates") => void;
}

export const LabSettingsSection: React.FC<LabSettingsSectionProps> = ({
  mode,
  isLocked,
  labSettings,
  saveRef,
  activeTab,
  onInvalid,
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
  // The lab's deploy settings on its lab host: kept with the host, not in the topology.
  const labOperations = useClabUiHost().topoViewer.labOperations;
  const labHostInfo = useLabHostStore((store) => store.info);
  const canSetTimeout = labHostInfo?.support.lifecycleTimeout === true;
  const c9sReadOnly = labHostInfo?.profile.runtime === "c9s" && !labHostInfo.support.c9sDeployOptions;
  const deploy = useLabDeploySettings(labOperations, labHostInfo?.profile.runtime ?? "docker", {
    canSetTimeout,
    c9sEditable: !c9sReadOnly
  });

  useEffect(() => {
    if (showRateLabelsEditedRef.current) return;
    setDraftShowRateLabels(showRateLabels);
  }, [showRateLabels]);

  const handleShowRateLabelsChange = useCallback((enabled: boolean) => {
    showRateLabelsEditedRef.current = true;
    setDraftShowRateLabels(enabled);
  }, []);

  const handleSave = async () => {
    if (!areTopologySettingsReadOnly && state.invalidSection !== undefined) {
      onInvalid?.(state.invalidSection);
      return;
    }
    if (deploy.invalid) {
      onInvalid?.("deploy");
      return;
    }
    // Deploy settings go to the lab host, whatever happens to the topology after.
    await deploy.save();
    // A locked lab saves only its deploy settings.
    if (isLocked) return;
    // Save appearance before lab settings: every save pushes a host snapshot into the
    // store, and appearance in that snapshot comes from the annotations file.
    const {
      linkLabelMode,
      lastNonTelemetryLinkLabelMode,
      nodeStyle,
      nodeBoxSpacing,
      linkStyle,
      mgmtNetworkBadge,
      showNodeCpu,
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
      nodeStyle,
      nodeBoxSpacing,
      linkStyle,
      mgmtNetworkBadge,
      showNodeCpu,
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
    if (!areTopologySettingsReadOnly) {
      await state.handleSave();
    }
  };

  if (saveRef) saveRef.current = handleSave;

  if (activeTab === "deploy") {
    return (
      <DeployTab
        state={deploy}
        profile={labHostInfo?.profile}
        hostLabel={labHostInfo ? labHostRuntimeLabel(labHostInfo.profile) : "this lab host"}
        canSetTimeout={canSetTimeout}
        c9sReadOnly={c9sReadOnly}
      />
    );
  }
  if (activeTab === "mgmt") {
    return (
      <MgmtTab
        mgmt={state.mgmt}
        setMgmt={state.setMgmt}
        driverOpts={state.driverOpts}
        isViewMode={areTopologySettingsReadOnly}
        networks={state.mgmtNetworks}
        labSettings={labSettings}
      />
    );
  }
  if (activeTab === "certificates") {
    return (
      <CertificatesTab
        ca={state.ca}
        setCa={state.setCa}
        issues={state.caIssues}
        isViewMode={areTopologySettingsReadOnly}
      />
    );
  }
  if (activeTab === "inheritance") {
    return <InheritanceTab isViewMode={areTopologySettingsReadOnly} />;
  }
  if (activeTab === "appearance") {
    return (
      <AppearanceTab
        isReadOnly={isAppearanceReadOnly}
        showRateLabels={draftShowRateLabels}
        onShowRateLabelsChange={handleShowRateLabelsChange}
      />
    );
  }
  if (activeTab === "grid") {
    return (
      <GridTab
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
      />
    );
  }
  return (
    <BasicTab
      basic={state.basic}
      setBasic={state.setBasic}
      isViewMode={areTopologySettingsReadOnly}
    />
  );
};
