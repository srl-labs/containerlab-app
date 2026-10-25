// Opens the lab operation dialogs and learns what the lab host supports.
import React from "react";

import { useClabUiHost } from "../../../host";
import { NO_LAB_OPERATIONS } from "../../../host/labOperations";
import { useLabOperationsStore } from "../../../stores/labOperationsStore";
import { useDeploymentState } from "../../../stores/topoViewerStore";

const LazyExecCommandDialog = React.lazy(async () => ({
  default: (await import("./ExecCommandDialog")).ExecCommandDialog
}));
const LazySaveConfigsDialog = React.lazy(async () => ({
  default: (await import("./SaveConfigsDialog")).SaveConfigsDialog
}));
const LazySnapshotSaveDialog = React.lazy(async () => ({
  default: (await import("./SnapshotSaveDialog")).SnapshotSaveDialog
}));
const LazyInspectDetailsDialog = React.lazy(async () => ({
  default: (await import("./InspectDetailsDialog")).InspectDetailsDialog
}));

/**
 * What the lab host supports does not depend on the lab running (deploy
 * restore matters before it runs). Ask again when the state changes anyway:
 * hosts switch between labs on different lab hosts.
 */
function useLabOperationSupportLoader(): void {
  const { topoViewer } = useClabUiHost();
  const operations = topoViewer.labOperations;
  const deploymentState = useDeploymentState();
  const setSupport = useLabOperationsStore((state) => state.setSupport);
  React.useEffect(() => {
    if (!operations) {
      setSupport(NO_LAB_OPERATIONS);
      return;
    }
    let cancelled = false;
    operations.support().then(
      (support) => {
        if (!cancelled) setSupport(support);
      },
      () => {
        if (!cancelled) setSupport(NO_LAB_OPERATIONS);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [operations, deploymentState, setSupport]);
}

export const LabOperationsDialogs: React.FC = () => {
  useLabOperationSupportLoader();
  const { topoViewer } = useClabUiHost();
  const operations = topoViewer.labOperations;
  const dialog = useLabOperationsStore((state) => state.dialog);
  const support = useLabOperationsStore((state) => state.support);
  const closeDialog = useLabOperationsStore((state) => state.closeDialog);
  if (!operations || !dialog) return null;

  const common = { operations, initialNodes: dialog.nodeNames, onClose: closeDialog };
  return (
    <React.Suspense fallback={null}>
      {dialog.kind === "exec" && <LazyExecCommandDialog {...common} canUseLabels={support.execByLabel} />}
      {dialog.kind === "saveConfigs" && <LazySaveConfigsDialog {...common} canCopy={support.saveCopy} />}
      {dialog.kind === "snapshots" && <LazySnapshotSaveDialog {...common} />}
      {dialog.kind === "details" && <LazyInspectDetailsDialog {...common} />}
    </React.Suspense>
  );
};
