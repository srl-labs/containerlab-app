// Capture checklist for the two ends of a canvas link.
import React from "react";

import { useClabUiHost } from "../../../host";
import { useGraphStore } from "../../../stores/graphStore";
import { hostCapturesLinks, useLabHostStore } from "../../../stores/labHostStore";

import { CaptureMenuPanel } from "./CaptureMenuPanel";
import type { CaptureRequestGroup } from "./captureInterfaceOptions";
import { initialCaptureSelection, rememberCaptureSelection } from "./captureSelectionMemory";
import { summarizeLinkCapture } from "./captureSummary";
import { linkCaptureOptions, linkEndsShareNamespace, type LinkCaptureEnd } from "./linkCaptureOptions";

export interface CanvasLinkCapturePanelProps {
  linkId: string;
  ends: readonly LinkCaptureEnd[];
  onDone: () => void;
}

function endLabel(end: LinkCaptureEnd): string {
  return `${end.displayName} · ${end.endpoint}`;
}

export const CanvasLinkCapturePanel: React.FC<CanvasLinkCapturePanelProps> = ({
  linkId,
  ends,
  onDone
}) => {
  const { topoViewer } = useClabUiHost();
  const nodes = useGraphStore((state) => state.nodes);
  // A host that captures lab links as one stream (c9s) takes both ends in one capture.
  const oneStream = useLabHostStore((state) => hostCapturesLinks(state.info));
  const shareNamespace = React.useMemo(
    () => oneStream || linkEndsShareNamespace(ends, nodes),
    [ends, nodes, oneStream]
  );
  const options = React.useMemo(() => linkCaptureOptions(ends, shareNamespace), [ends, shareNamespace]);
  const memoryKey = `link:${linkId}`;
  // Both ends start ticked; afterwards the last pick for this link.
  const [initialSelection] = React.useState(() => initialCaptureSelection(memoryKey, options, false));

  const handleSelectionChange = React.useCallback(
    (names: string[]) => rememberCaptureSelection(memoryKey, names),
    [memoryKey]
  );

  // Each end is captured by its topology port name; the host resolves it.
  const handleCapture = React.useCallback(
    (groups: CaptureRequestGroup[]) => {
      for (const group of groups) {
        const picked = ends.filter((end) => group.interfaceNames.includes(end.id));
        if (picked.length === 1) {
          topoViewer.captureInterface(picked[0].captureName, picked[0].endpoint, {
            label: endLabel(picked[0])
          });
        } else if (picked.length > 1) {
          topoViewer.captureTargets(
            picked.map((end) => ({ nodeName: end.captureName, interfaceName: end.endpoint })),
            { label: picked.map(endLabel).join(" ↔ ") }
          );
        }
      }
      onDone();
    },
    [ends, onDone, topoViewer]
  );

  return (
    <CaptureMenuPanel
      heading={{ name: ends.map((end) => end.displayName).join(" ↔ "), suffix: "link" }}
      options={options}
      initialSelection={initialSelection}
      onSelectionChange={handleSelectionChange}
      onCapture={handleCapture}
      combinable={shareNamespace}
      summarize={summarizeLinkCapture}
      separateLabel="One per end"
    />
  );
};
