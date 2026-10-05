import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import InputBase from "@mui/material/InputBase";

import { controlRadius } from "../../theme/surfaces";
import { isHexColor, isThemeColor, toOpaqueHex } from "../../theme/themeColor";
import { MONO_FONT_FAMILY } from "../../theme/typography";

// Same border chain as outlined inputs, so the field matches the text fields around it.
const INPUT_BORDER =
  "var(--clab-ui-input-border, var(--vscode-input-border, var(--vscode-panel-border, transparent)))";
const CHECKERBOARD =
  "repeating-conic-gradient(rgba(128, 128, 128, 0.35) 0% 25%, transparent 0% 50%) 50% / 8px 8px";

function normalize(text: string, allowAlpha: boolean): string | null {
  const value = text.trim().toLowerCase();
  const expanded = /^#[0-9a-f]{3}$/.test(value)
    ? `#${value
        .slice(1)
        .split("")
        .map((digit) => digit + digit)
        .join("")}`
    : value;
  if (isHexColor(expanded)) return expanded;
  return allowAlpha && isThemeColor(value) ? value : null;
}

/**
 * Swatch plus text field. The swatch opens the system color picker; the field takes
 * hex, and with `allowAlpha` also `#rrggbbaa` and `rgba()`.
 */
export function ThemeColorInput({
  label,
  value,
  onChange,
  allowAlpha = false,
  testId
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowAlpha?: boolean;
  testId?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const invalid = draft !== value && normalize(draft, allowAlpha) === null;

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1,
        height: 32,
        boxSizing: "border-box",
        pl: "5px",
        pr: 1,
        flexShrink: 0,
        border: "1px solid",
        borderColor: invalid ? "error.main" : INPUT_BORDER,
        borderRadius: controlRadius,
        transition: "border-color 120ms ease",
        "&:hover": { borderColor: invalid ? "error.main" : `color-mix(in srgb, var(--vscode-foreground) 32%, ${INPUT_BORDER})` },
        "&:focus-within": { borderColor: invalid ? "error.main" : "var(--vscode-focusBorder)" }
      }}
    >
      <Box
        component="label"
        sx={{
          position: "relative",
          width: 20,
          height: 20,
          flexShrink: 0,
          overflow: "hidden",
          borderRadius: "4px",
          // Mid-grey edges keep dark swatches visible on dark inputs and light ones on light.
          border: "1px solid rgba(128, 128, 128, 0.6)",
          background: CHECKERBOARD,
          cursor: "pointer"
        }}
      >
        <Box component="span" style={{ background: value }} sx={{ position: "absolute", inset: 0 }} />
        <Box
          component="input"
          type="color"
          aria-label={`${label} picker`}
          value={toOpaqueHex(value) ?? "#000000"}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            p: 0,
            border: 0,
            opacity: 0,
            cursor: "pointer"
          }}
        />
      </Box>
      <InputBase
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = normalize(event.target.value, allowAlpha);
          if (next !== null && next !== value) onChange(next);
        }}
        onBlur={() => setDraft(value)}
        inputProps={{ "aria-label": label, "aria-invalid": invalid, spellCheck: false, "data-testid": testId }}
        sx={{
          width: allowAlpha ? 168 : 72,
          fontFamily: MONO_FONT_FAMILY,
          fontSize: 12
        }}
      />
    </Box>
  );
}
