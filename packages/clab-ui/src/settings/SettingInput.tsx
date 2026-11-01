import React from "react";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
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
  const enumIndex = definition.enum?.indexOf(text) ?? -1;
  // What the picked choice does, e.g. where "Automatic" opens captures.
  const choiceDescription =
    enumIndex >= 0 ? definition.enumDescriptions?.[enumIndex] : undefined;
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
      helperText={validation ?? choiceDescription}
      slotProps={{
        htmlInput: {
          "aria-label": definition.title,
          min: definition.minimum,
          max: definition.maximum,
          step: 1,
        },
        select: {
          inputProps: { "aria-label": definition.title },
          // The field shows the choice; its description sits under the field.
          renderValue: (value) => String(value),
        },
      }}
    >
      {definition.enum?.map((value, index) => {
        const description = definition.enumDescriptions?.[index];
        return (
          <MenuItem
            key={value}
            value={value}
            sx={description ? { display: "block", whiteSpace: "normal", maxWidth: 520 } : undefined}
          >
            {value}
            {description ? (
              <Typography
                component="span"
                variant="caption"
                sx={{ display: "block", color: "text.secondary" }}
              >
                {description}
              </Typography>
            ) : null}
          </MenuItem>
        );
      })}
    </TextField>
  );
}
