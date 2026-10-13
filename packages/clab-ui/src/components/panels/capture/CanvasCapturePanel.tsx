// Capture checklist for a canvas node, fed by the graph and sent to the topology host.
import React from "react";

import { useClabUiHost } from "../../../host";
import { useGraphStore } from "../../../stores/graphStore";

import { CaptureMenuPanel } from "./CaptureMenuPanel";
import { buildCaptureNodeTarget, type CaptureRequestGroup } from "./captureInterfaceOptions";
import { initialCaptureSelection, rememberCaptureSelection } from "./captureSelectionMemory";
import { captureGroupLabel } from "./captureSummary";

export const CanvasCapturePanel: React.FC<{ nodeId: string; onDone: () => void }> = ({
  nodeId,
  onDone
}) => {
  const { topoViewer } = useClabUiHost();
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const target = React.useMemo(
    () => buildCaptureNodeTarget(nodeId, nodes, edges),
    [nodeId, nodes, edges]
  );
  const containerName = target?.containerName;
  const [initialSelection] = React.useState(() =>
    target ? initialCaptureSelection(target.containerName, target.options) : []
  );

  const handleSelectionChange = React.useCallback(
    (interfaceNames: string[]) => {
      if (containerName !== undefined) rememberCaptureSelection(containerName, interfaceNames);
    },
    [containerName]
  );

  const handleCapture = React.useCallback(
    (groups: CaptureRequestGroup[]) => {
      if (!target) return;
      for (const group of groups) {
        topoViewer.captureInterfaces(group.containerName, group.interfaceNames, {
          nodeNamespace: group.nodeNamespace,
          label: captureGroupLabel(target.options, group)
        });
      }
      onDone();
    },
    [onDone, target, topoViewer]
  );

  if (!target) return null;

  return (
    <CaptureMenuPanel
      heading={{ name: target.label, suffix: "interfaces" }}
      options={target.options}
      initialSelection={initialSelection}
      onSelectionChange={handleSelectionChange}
      onCapture={handleCapture}
    />
  );
};
