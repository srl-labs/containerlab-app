import React from "react";
import { useStore } from "@xyflow/react";
import Box from "@mui/material/Box";

import type { HelperLinePositions } from "../../hooks/canvas/useHelperLines";

interface HelperLinesProps {
  lines: HelperLinePositions;
}

const HELPER_LINE_COLOR = "#ff6b6b";
const HELPER_LINE_WIDTH = 1;
const MIDPOINT_LINE_COLOR = "#4ecdc4";
const MIDPOINT_LINE_WIDTH = 1;

export const HelperLines: React.FC<HelperLinesProps> = React.memo(({ lines }) => {
  const { horizontal, vertical, horizontalMidpoint, verticalMidpoint } = lines;

  if (
    horizontal === null &&
    vertical === null &&
    horizontalMidpoint === null &&
    verticalMidpoint === null
  ) {
    return null;
  }

  return <HelperLinesSvg lines={lines} />;
});

HelperLines.displayName = "HelperLines";

// Separate component so the viewport store subscription only exists while
// helper lines are visible (avoids re-rendering on every pan/zoom otherwise).
const HelperLinesSvg: React.FC<HelperLinesProps> = ({ lines }) => {
  const transform = useStore((state) => state.transform);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);

  const { horizontal, vertical, horizontalMidpoint, verticalMidpoint } = lines;

  const [tx, ty, zoom] = transform;

  const horizontalScreenY = horizontal !== null ? horizontal * zoom + ty : null;
  const verticalScreenX = vertical !== null ? vertical * zoom + tx : null;
  const horizontalMidpointScreenY =
    horizontalMidpoint !== null ? horizontalMidpoint * zoom + ty : null;
  const verticalMidpointScreenX = verticalMidpoint !== null ? verticalMidpoint * zoom + tx : null;

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1000,
        overflow: "visible"
      }}
    >
      {horizontalScreenY !== null && (
        <line
          x1={0}
          y1={horizontalScreenY}
          x2={width}
          y2={horizontalScreenY}
          stroke={HELPER_LINE_COLOR}
          strokeWidth={HELPER_LINE_WIDTH}
          strokeDasharray="4 2"
        />
      )}

      {verticalScreenX !== null && (
        <line
          x1={verticalScreenX}
          y1={0}
          x2={verticalScreenX}
          y2={height}
          stroke={HELPER_LINE_COLOR}
          strokeWidth={HELPER_LINE_WIDTH}
          strokeDasharray="4 2"
        />
      )}

      {horizontalMidpointScreenY !== null && (
        <line
          x1={0}
          y1={horizontalMidpointScreenY}
          x2={width}
          y2={horizontalMidpointScreenY}
          stroke={MIDPOINT_LINE_COLOR}
          strokeWidth={MIDPOINT_LINE_WIDTH}
          strokeDasharray="6 3"
        />
      )}

      {verticalMidpointScreenX !== null && (
        <line
          x1={verticalMidpointScreenX}
          y1={0}
          x2={verticalMidpointScreenX}
          y2={height}
          stroke={MIDPOINT_LINE_COLOR}
          strokeWidth={MIDPOINT_LINE_WIDTH}
          strokeDasharray="6 3"
        />
      )}
    </svg>
  );
};

const OverlayIndicator: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    sx={{
      position: "absolute",
      top: 10,
      left: "50%",
      transform: "translateX(-50%)",
      border: 1,
      borderColor: "divider",
      borderRadius: 1,
      px: 1.5,
      py: 0.75,
      fontSize: 12,
      bgcolor: "background.paper",
      color: "text.primary",
      boxShadow: 4,
      zIndex: 1300,
      pointerEvents: "none"
    }}
  >
    {children}
  </Box>
);

export const AnnotationModeIndicator: React.FC<{ message: string }> = ({ message }) => (
  <OverlayIndicator>{message}</OverlayIndicator>
);

export const LinkCreationIndicator: React.FC<{
  linkSourceNode: string;
  linkTargetNode?: string | null;
}> = ({ linkSourceNode, linkTargetNode }) => {
  const hasTarget = linkTargetNode != null && linkTargetNode.length > 0;
  return (
    <OverlayIndicator>
      Creating link from <strong>{linkSourceNode}</strong>
      {hasTarget ? (
        <>
          {" → "}
          <strong>{linkTargetNode}</strong>
        </>
      ) : null}
      {" — "}
      {hasTarget ? "Click to confirm" : "Click on target node"} or press Escape to cancel
    </OverlayIndicator>
  );
};
