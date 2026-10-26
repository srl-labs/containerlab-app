// Status line at the bottom of the editor canvas: "12 nodes • 16 links • 7 annotations".
import React from "react";
import Box from "@mui/material/Box";
import { shallow } from "zustand/shallow";

import { useGraphStore } from "../../stores/graphStore";
import { countTopologyStats } from "../../utils/graphQueryUtils";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export const CanvasStats: React.FC = React.memo(() => {
  // Counts compare by value, so drags and selections do not re-render the line.
  const stats = useGraphStore((state) => countTopologyStats(state.nodes, state.edges), shallow);
  return (
    <Box
      data-testid="canvas-stats"
      sx={{
        position: "absolute",
        bottom: 8,
        left: "var(--clab-ui-panel-left, 0px)",
        right: "var(--clab-ui-panel-right, 0px)",
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        userSelect: "none",
        zIndex: 5
      }}
    >
      <Box
        component="span"
        sx={{
          px: 1,
          fontSize: 11,
          lineHeight: "18px",
          color: "text.secondary",
          opacity: 0.8,
          whiteSpace: "nowrap"
        }}
      >
        {[
          plural(stats.nodes, "node"),
          plural(stats.links, "link"),
          plural(stats.annotations, "annotation")
        ].join(" • ")}
      </Box>
    </Box>
  );
});
CanvasStats.displayName = "CanvasStats";
