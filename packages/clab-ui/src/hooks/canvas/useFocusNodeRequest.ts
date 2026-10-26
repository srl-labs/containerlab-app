import { useEffect } from "react";
import type { ReactFlowInstance } from "@xyflow/react";

import { useCanvasStore } from "../../stores/canvasStore";
import { useTopoViewerStore } from "../../stores/topoViewerStore";

const POLL_MS = 100;
// A linked lab may still be loading; give up after 15 s.
const MAX_POLLS = 150;
// Lets the fit of a newly opened lab finish before centering on the node.
const SETTLE_POLLS = 3;

/** Selects and centers the requested node once the canvas has drawn it. */
export function useFocusNodeRequest(rfInstance: ReactFlowInstance | null): void {
  const request = useCanvasStore((state) => state.focusNodeRequest);

  useEffect(() => {
    if (!request || !rfInstance) return undefined;
    let polls = 0;
    let drawnPolls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if ((rfInstance.getNode(request.nodeId)?.measured?.width ?? 0) > 0) drawnPolls += 1;
      if (drawnPolls >= SETTLE_POLLS) {
        window.clearInterval(timer);
        useTopoViewerStore.getState().selectNode(request.nodeId);
        void rfInstance.fitView({ nodes: [{ id: request.nodeId }], padding: 1, maxZoom: 1.25, duration: 200 });
        useCanvasStore.getState().clearFocusNodeRequest(request.requestId);
      } else if (polls >= MAX_POLLS) {
        window.clearInterval(timer);
        useCanvasStore.getState().clearFocusNodeRequest(request.requestId);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [request, rfInstance]);
}
