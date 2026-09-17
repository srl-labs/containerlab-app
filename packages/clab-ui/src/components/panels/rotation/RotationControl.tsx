import React, { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ColorizeIcon from "@mui/icons-material/Colorize";

import { normalizeRotation, uprightRotation } from "../../../annotations/rotation";
import { useRotationStore } from "../../../stores/rotationStore";
import { useIsLocked } from "../../../stores/topoViewerStore";

import { RotationDial } from "./RotationDial";
import { RotationActions } from "./RotationActions";
import { RotationAngleField } from "./RotationAngleField";

interface Props {
  objectId: string;
  inputId?: string;
  angle: number | null;
  onChange?: (angle: number) => void;
  keepUpright?: boolean;
}

export function RotationControl({
  objectId,
  inputId,
  angle,
  onChange,
  keepUpright = false
}: Props) {
  const locked = useIsLocked();
  const picking = useRotationStore((state) => state.pick?.targetId === objectId);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editable = Boolean(onChange) && !locked;
  const unavailable = angle === null;
  const displayAngle = angle ?? 0;

  useEffect(() => {
    return () => {
      const store = useRotationStore.getState();
      if (store.pick?.targetId === objectId) store.cancelPick();
    };
  }, [objectId]);

  const apply = (value: number) => {
    onChange?.(normalizeRotation(value));
  };
  const matchAngle = (value: number) =>
    onChangeRef.current?.(keepUpright ? uprightRotation(value) : value);

  const matchHint = keepUpright
    ? "Pick a direction on the canvas · Text stays upright"
    : "Pick a direction from any link, line, text or shape";
  return (
    <Box
      data-testid="rotation-control"
      sx={{
        m: 2,
        p: 2,
        border: "1px solid",
        borderColor: picking ? "primary.main" : "divider",
        borderRadius: 2.5,
        bgcolor: "background.paper",
        boxShadow: "0 2px 12px rgba(0,0,0,.04)"
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 1.5
        }}
      >
        <Typography variant="subtitle2">Rotation</Typography>
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase"
          }}
        >
          {onChange ? "Transform" : "Link direction"}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <RotationDial
          angle={displayAngle}
          onChange={editable ? apply : undefined}
          disabled={Boolean(onChange) && !editable}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <RotationAngleField
            inputId={inputId}
            angle={angle}
            editable={editable}
            computed={!onChange}
            onChange={apply}
          />
          <RotationActions
            angle={angle}
            editable={editable}
            onChange={onChange ? apply : undefined}
          />
        </Box>
      </Box>
      {onChange ? (
        <>
          <Box sx={{ display: "flex", gap: 0.75, mt: 1.5 }}>
            {[0, 30, 45, 90].map((preset) => (
              <Button
                key={preset}
                size="small"
                disabled={!editable}
                onClick={() => apply(preset)}
                aria-label={`Set rotation to ${preset}°`}
                sx={{
                  minWidth: 0,
                  flex: 1,
                  borderRadius: 1.25,
                  bgcolor:
                    Math.abs(normalizeRotation(displayAngle - preset)) < 0.001
                      ? "action.selected"
                      : "action.hover",
                  color: "text.primary",
                  fontVariantNumeric: "tabular-nums"
                }}
              >
                {preset}°
              </Button>
            ))}
          </Box>
          <Button
            fullWidth
            size="small"
            variant={picking ? "contained" : "outlined"}
            startIcon={<ColorizeIcon />}
            disabled={!editable}
            aria-pressed={picking}
            onClick={() => {
              const store = useRotationStore.getState();
              if (picking) store.cancelPick();
              else store.startPick({ targetId: objectId, onPick: matchAngle });
            }}
            sx={{
              mt: 1.5,
              borderRadius: 1.25,
              textTransform: "none",
              py: 0.75
            }}
          >
            {picking ? "Choose an object on the canvas…" : "Match rotation"}
          </Button>
          <Typography
            variant="caption"
            sx={{
              display: "block",
              color: "text.secondary",
              mt: 1,
              textAlign: "center",
              fontSize: 11
            }}
          >
            {picking ? "Click a link, line, text or shape · Esc to cancel" : matchHint}
          </Typography>
        </>
      ) : (
        <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1.5 }}>
          {unavailable
            ? "No direction available for this link."
            : "Direction at the link midpoint. Copy it to align an annotation."}
        </Typography>
      )}
    </Box>
  );
}
