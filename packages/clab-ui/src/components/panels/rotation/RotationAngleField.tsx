import React, { useEffect, useState } from "react";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { formatRotation, normalizeRotation } from "../../../annotations/rotation";

export function RotationAngleField({
  inputId,
  angle,
  editable,
  computed,
  onChange
}: {
  inputId?: string;
  angle: number | null;
  editable: boolean;
  computed: boolean;
  onChange: (angle: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [angle]);
  const displayAngle = angle ?? 0;
  const unavailable = angle === null;
  const apply = (value: number) => {
    setDraft(null);
    onChange(normalizeRotation(value));
  };
  const commitDraft = () => {
    if (draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft)))
      apply(Number(draft));
    else setDraft(null);
  };
  return (
    <TextField
      id={inputId}
      size="small"
      fullWidth
      label={computed ? "Computed angle" : "Angle"}
      value={unavailable ? "—" : (draft ?? formatRotation(displayAngle))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitDraft();
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          setDraft(null);
        }
        if (editable && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          const current =
            draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft))
              ? Number(draft)
              : displayAngle;
          apply(current + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 15 : 1));
        }
      }}
      slotProps={{
        input: {
          readOnly: !editable,
          endAdornment: <InputAdornment position="end">°</InputAdornment>
        },
        htmlInput: {
          inputMode: "decimal",
          "aria-label": computed ? "Computed rotation angle" : "Rotation angle"
        }
      }}
      sx={{
        "& input": {
          fontVariantNumeric: "tabular-nums",
          fontSize: 20,
          fontWeight: 500,
          py: 1
        }
      }}
    />
  );
}
