// Capture dialog for a canvas node, fed by the graph and sent to the topology host.
import React from "react";

import { useClabUiHost } from "../../../host";
import { useGraphStore } from "../../../stores/graphStore";
import { useCaptureDialogStore } from "../../../stores/captureDialogStore";

import { CaptureInterfacesDialog } from "./CaptureInterfacesDialog";
import { buildCaptureNodeTarget, type CaptureRequestGroup } from "./captureInterfaceOptions";
import { initialCaptureSelection, rememberCaptureSelection } from "./captureSelectionMemory";

export const CanvasCaptureDialog: React.FC<{ nodeId: string }> = ({ nodeId }) => {
  const { topoViewer } = useClabUiHost();
  const closeCaptureDialog = useCaptureDialogStore((state) => state.closeCaptureDialog);
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const target = React.useMemo(
    () => buildCaptureNodeTarget(nodeId, nodes, edges),
    [nodeId, nodes, edges]
  );
  const [initialSelection] = React.useState(() =>
    target ? initialCaptureSelection(target.containerName, target.options) : []
  );

  React.useEffect(() => {
    if (!target) closeCaptureDialog();
  }, [target, closeCaptureDialog]);

  const handleCapture = React.useCallback(
    (groups: CaptureRequestGroup[]) => {
      if (!target) return;
      rememberCaptureSelection(
        target.containerName,
        groups.flatMap((group) => group.interfaceNames)
      );
      for (const group of groups) {
        topoViewer.captureInterfaces(group.containerName, group.interfaceNames, {
          nodeNamespace: group.nodeNamespace
        });
      }
      closeCaptureDialog();
    },
    [closeCaptureDialog, target, topoViewer]
  );

  if (!target) return null;

  return (
    <CaptureInterfacesDialog
      open
      nodeLabel={target.label}
      containerName={target.containerName}
      options={target.options}
      initialSelection={initialSelection}
      onClose={closeCaptureDialog}
      onCapture={handleCapture}
    />
  );
};
