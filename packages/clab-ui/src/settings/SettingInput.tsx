import React from "react";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { StructuredSettingEditor } from "./StructuredSettingEditor";
import { ColorSchemePicker } from "./ColorSchemePicker";
import type { SettingDefinition } from "./schema";

export function SettingInput({
  definition,
  text,
  onChange,
  busy,
  validation,
}: {
  definition: SettingDefinition;
  text: string;
  onChange: (text: string) => void;
  busy: boolean;
  validation?: string;
}) {
  if (definition.type === "boolean") return null;
  if (definition.type === "array" || definition.type === "object")
    return (
      <StructuredSettingEditor
        definition={definition}
        text={text}
        onChange={onChange}
        disabled={busy}
      />
    );
  if (definition.key === "containerlab.appearance.colorScheme")
    return (
      <ColorSchemePicker
        value={text}
        onChange={onChange}
        followHost
        disabled={busy}
      />
    );
  return (
    <TextField
      fullWidth
      size="small"
      select={Boolean(definition.enum)}
      type={definition.type === "number" ? "number" : "text"}
      value={text}
      disabled={busy}
      onChange={(event) => onChange(event.target.value)}
      error={Boolean(validation)}
      helperText={validation}
      sx={{
        "& .MuiOutlinedInput-root": { borderRadius: 1.25 },
        "& .MuiInputBase-input": { py: 1 },
      }}
      slotProps={{
        htmlInput: {
          "aria-label": definition.title,
          min: definition.minimum,
          max: definition.maximum,
          step: 1,
        },
        select: { inputProps: { "aria-label": definition.title } },
      }}
    >
      {definition.enum?.map((value) => (
        <MenuItem key={value} value={value}>
          {value}
        </MenuItem>
      ))}
    </TextField>
  );
}
