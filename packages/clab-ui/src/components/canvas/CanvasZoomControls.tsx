// Floating zoom in/out control, bottom-right of the canvas (Google Maps / Earth style).
import React, { useCallback } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { ActionIcon, Box, Divider, Tooltip } from "@mantine/core";
import { IconPlus, IconMinus, IconArrowsMaximize } from "@tabler/icons-react";

export interface CanvasZoomControlsProps {
  rfInstance: ReactFlowInstance | null;
  onFitView: () => void;
  /** Which bottom corner to dock to. */
  side?: "left" | "right";
}

const ZOOM_TRANSITION = { duration: 200 };

export const CanvasZoomControls: React.FC<CanvasZoomControlsProps> = ({
  rfInstance,
  onFitView,
  side = "right"
}) => {
  const handleZoomIn = useCallback(() => {
    rfInstance?.zoomIn(ZOOM_TRANSITION);
  }, [rfInstance]);

  const handleZoomOut = useCallback(() => {
    rfInstance?.zoomOut(ZOOM_TRANSITION);
  }, [rfInstance]);

  const disabled = rfInstance === null;

  return (
    <Box
      data-testid="canvas-zoom-controls"
      style={{
        position: "absolute",
        ...(side === "left" ? { left: 16 } : { right: 16 }),
        bottom: 16,
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        borderRadius: "16px",
        border: "1px solid var(--mantine-color-default-border)",
        backgroundColor: "var(--mantine-color-body)",
        boxShadow: "var(--mantine-shadow-lg)",
        overflow: "hidden"
      }}
    >
      <Tooltip label="Zoom in" position="left">
        <ActionIcon
          variant="subtle"
          color="gray"
          radius={0}
          style={{ width: 34, height: 34 }}
          onClick={handleZoomIn}
          disabled={disabled}
          data-testid="canvas-zoom-in"
        >
          <IconPlus size={18} />
        </ActionIcon>
      </Tooltip>
      <Divider />
      <Tooltip label="Zoom out" position="left">
        <ActionIcon
          variant="subtle"
          color="gray"
          radius={0}
          style={{ width: 34, height: 34 }}
          onClick={handleZoomOut}
          disabled={disabled}
          data-testid="canvas-zoom-out"
        >
          <IconMinus size={18} />
        </ActionIcon>
      </Tooltip>
      <Divider />
      <Tooltip label="Fit to viewport" position="left">
        <ActionIcon
          variant="subtle"
          color="gray"
          radius={0}
          style={{ width: 34, height: 34 }}
          onClick={onFitView}
          disabled={disabled}
          data-testid="canvas-fit-viewport"
        >
          <IconArrowsMaximize size={18} />
        </ActionIcon>
      </Tooltip>
    </Box>
  );
};
