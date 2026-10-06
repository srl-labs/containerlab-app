import React, { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ColorizeIcon from "@mui/icons-material/ColorizeOutlined";

import { normalizeRotation, uprightRotation } from "../../../annotations/rotation";
import { useRotationStore } from "../../../stores/rotationStore";
import { useIsLocked } from "../../../stores/topoViewerStore";
import { PanelSectionHeader } from "../../ui/form";

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
  const hint = picking ? "Click a link, line, text or shape · Esc to cancel" : matchHint;
  return (
    <Box data-testid="rotation-control">
      <PanelSectionHeader title="Rotation" />
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, px: 2, pt: 1.5, pb: 0.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <RotationDial
            angle={displayAngle}
            onChange={editable ? apply : undefined}
            disabled={Boolean(onChange) && !editable}
          />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <RotationAngleField
                  inputId={inputId}
                  angle={angle}
                  editable={editable}
                  computed={!onChange}
                  onChange={apply}
                />
              </Box>
              <RotationActions
                angle={angle}
                editable={editable}
                onChange={onChange ? apply : undefined}
              />
            </Box>
            {onChange ? (
              <Box sx={{ display: "flex", gap: 0.5 }}>
                {[0, 30, 45, 90].map((preset) => {
                  const selected = Math.abs(normalizeRotation(displayAngle - preset)) < 0.001;
                  return (
                    <Button
                      key={preset}
                      size="small"
                      variant="outlined"
                      disabled={!editable}
                      onClick={() => apply(preset)}
                      aria-label={`Set rotation to ${preset}°`}
                      sx={{
                        flex: 1,
                        fontVariantNumeric: "tabular-nums",
                        ...(selected ? { bgcolor: "action.selected" } : undefined)
                      }}
                    >
                      {preset}°
                    </Button>
                  );
                })}
              </Box>
            ) : (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {unavailable
                  ? "No direction available for this link."
                  : "Direction at the link midpoint. Copy it to align an annotation."}
              </Typography>
            )}
          </Box>
        </Box>
        {onChange ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Button
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
              sx={{ flexShrink: 0 }}
            >
              {picking ? "Choose an object on the canvas…" : "Match rotation"}
            </Button>
            <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 0 }}>
              {hint}
            </Typography>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
