// The color control used everywhere: a swatch that opens the system picker, and a text field.
import React, { useCallback, useEffect, useRef, useState } from "react";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";

import { isHexColor, isThemeColor, toOpaqueHex } from "../../../theme/themeColor";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { normalizeHexColor } from "../../../utils/color";

import { ColorSwatch } from "./ColorSwatch";

interface ColorFieldProps {
  id?: string;
  /** Visible field label; without it, `ariaLabel` names the field. */
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Also accept `#rrggbbaa` and `rgba()`, e.g. for theme tokens. */
  allowAlpha?: boolean;
  /** Fixed width in pixels; the field fills its container when unset. */
  width?: number;
  testId?: string;
}

/** Picker changes reach `onChange` at most this often while dragging. */
const PICKER_THROTTLE_MS = 40;
const SHORT_HEX = /^#?[0-9a-f]{3}$/i;

/** `#rgb`, `#rrggbb` (with or without `#`), and with `allowAlpha` any theme color; null if invalid. */
export function parseColorInput(text: string, allowAlpha: boolean): string | null {
  const value = text.trim().toLowerCase();
  const hex = value.startsWith("#") ? value : `#${value}`;
  const expanded = /^#[0-9a-f]{3}$/.test(hex)
    ? `#${hex
        .slice(1)
        .split("")
        .map((digit) => digit + digit)
        .join("")}`
    : hex;
  if (isHexColor(expanded)) return expanded;
  if (!allowAlpha) return null;
  if (isThemeColor(value)) return value;
  return isThemeColor(hex) ? hex : null;
}

export const ColorField: React.FC<ColorFieldProps> = ({
  id,
  label,
  ariaLabel,
  value,
  onChange,
  disabled = false,
  className,
  allowAlpha = false,
  width,
  testId
}) => {
  const shown = allowAlpha && isThemeColor(value) ? value : normalizeHexColor(value);
  const [draft, setDraft] = useState(shown);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(shown);
  }, [shown]);
  const invalid = draft !== shown && parseColorInput(draft, allowAlpha) === null;

  // The system picker fires on every drag step; pass changes on at a steady rate.
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (pending.current !== null) onChange(pending.current);
    pending.current = null;
  }, [onChange]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const handlePick = useCallback(
    (hex: string) => {
      pending.current = hex;
      setDraft(hex);
      timer.current ??= setTimeout(flush, PICKER_THROTTLE_MS);
    },
    [flush]
  );

  const name = label ?? ariaLabel ?? "Color";
  return (
    <TextField
      id={id}
      className={className}
      size="small"
      label={label}
      value={draft}
      error={invalid}
      disabled={disabled}
      fullWidth={width === undefined}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        // Short #rgb forms wait for blur, so typing "ff6600" never applies "#ffff66" on the way.
        if (SHORT_HEX.test(text.trim())) return;
        const next = parseColorInput(text, allowAlpha);
        if (next !== null && next !== shown) onChange(next);
      }}
      onBlur={() => {
        editing.current = false;
        const next = parseColorInput(draft, allowAlpha);
        if (next !== null && next !== shown) onChange(next);
        setDraft(next ?? shown);
      }}
      sx={{
        ...(width !== undefined ? { width } : {}),
        "& .MuiInputBase-input": { fontFamily: MONO_FONT_FAMILY, fontSize: 12 }
      }}
      slotProps={{
        htmlInput: {
          "aria-label": ariaLabel ?? label,
          "aria-invalid": invalid,
          spellCheck: false,
          "data-testid": testId
        },
        input: {
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0.75 }}>
              <ColorSwatch
                color={shown}
                pickerValue={toOpaqueHex(shown) ?? "#000000"}
                onPick={handlePick}
                onPickEnd={flush}
                ariaLabel={`${name} picker`}
                disabled={disabled}
              />
            </InputAdornment>
          )
        }
      }}
    />
  );
};
