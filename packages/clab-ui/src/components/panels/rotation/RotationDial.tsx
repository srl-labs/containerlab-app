import React from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";

import { normalizeRotation } from "../../../annotations/rotation";

export function RotationDial({
  angle,
  onChange,
  disabled
}: {
  angle: number;
  onChange?: (angle: number) => void;
  disabled: boolean;
}) {
  const changeFromPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const degrees =
      (Math.atan2(
        event.clientY - rect.y - rect.height / 2,
        event.clientX - rect.x - rect.width / 2
      ) *
        180) /
      Math.PI;
    onChange?.(
      normalizeRotation(Math.round(degrees / (event.shiftKey ? 15 : 1)) * (event.shiftKey ? 15 : 1))
    );
  };
  return (
    <Tooltip
      title={
        onChange
          ? "Drag to rotate · Shift snaps to 15° · Arrow keys fine-tune"
          : "Direction at the link midpoint"
      }
    >
      <Box
        component="button"
        type="button"
        aria-label="Rotation dial"
        disabled={disabled}
        onPointerDown={(event) => {
          if (!onChange || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          changeFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) changeFromPointer(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (!onChange) return;
          if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home"].includes(event.key)) {
            event.preventDefault();
            const step = event.shiftKey ? 15 : 1;
            onChange(
              event.key === "Home"
                ? 0
                : normalizeRotation(
                    angle + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -step : step)
                  )
            );
          }
        }}
        sx={{
          width: 76,
          height: 76,
          flexShrink: 0,
          p: 0,
          borderRadius: "50%",
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "background.default",
          color: "primary.main",
          position: "relative",
          cursor: onChange ? "ew-resize" : "default",
          touchAction: "none",
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: 3
          },
          "&:disabled": { cursor: "default" }
        }}
      >
        <svg viewBox="0 0 76 76" width="100%" height="100%" aria-hidden="true">
          <circle
            cx="38"
            cy="38"
            r="29"
            fill="none"
            stroke="currentColor"
            strokeOpacity=".18"
            strokeDasharray="1 6.59"
          />
          <path d="M 9 38 H 67 M 38 9 V 67" stroke="currentColor" strokeOpacity=".12" />
          <g transform={`rotate(${angle} 38 38)`}>
            <path d="M 16 38 H 61" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path
              d="m 55 33 6 5 -6 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="38" cy="38" r="4" fill="currentColor" />
          </g>
        </svg>
      </Box>
    </Tooltip>
  );
}
