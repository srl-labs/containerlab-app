// Color picker input with hex display and optional label.
import React, { useState, useRef, useCallback, useEffect } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";

import { MONO_FONT_FAMILY } from "../../../theme/typography";

import { normalizeHexColor } from "../../../utils/color";

interface ColorFieldProps {
  id?: string;
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

const SWATCH_SIZE = 18;
const COLOR_INPUT_THROTTLE_MS = 40;
const LEADING_HASH_REGEX = /^#/;
const HEX_TEXT_REGEX = /^[0-9A-Fa-f]{0,6}$/;

export const ColorField: React.FC<ColorFieldProps> = ({
  id,
  label,
  ariaLabel,
  value,
  onChange,
  disabled,
  className = ""
}) => {
  const normalizedValue = normalizeHexColor(value);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const pendingColorRef = useRef<string | null>(null);
  const colorThrottleRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Local state: hex digits only (no "#").
  const [hexText, setHexText] = useState(normalizedValue.slice(1));

  // Sync the color input imperatively (uncontrolled) to avoid React's
  // controlled-input machinery firing spurious change events on color inputs.
  useEffect(() => {
    if (colorInputRef.current) {
      colorInputRef.current.value = normalizedValue;
    }
  }, [normalizedValue]);

  // Debounced sync: update hex text after the value settles.
  // Skip if the current text already represents the same color (case-insensitive).
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const target = normalizedValue.slice(1);
    debounceRef.current = setTimeout(() => {
      setHexText((prev) => (prev.toLowerCase() === target ? prev : target));
    }, 100);
    return () => clearTimeout(debounceRef.current);
  }, [normalizedValue]);

  const flushPendingColor = useCallback(() => {
    const pending = pendingColorRef.current;
    if (pending === null) return;
    pendingColorRef.current = null;
    onChange(pending);
  }, [onChange]);

  useEffect(
    () => () => {
      if (colorThrottleRef.current) {
        clearTimeout(colorThrottleRef.current);
      }
    },
    []
  );

  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      pendingColorRef.current = e.target.value;
      if (colorThrottleRef.current) {
        return;
      }
      colorThrottleRef.current = setTimeout(() => {
        colorThrottleRef.current = undefined;
        flushPendingColor();
      }, COLOR_INPUT_THROTTLE_MS);
    },
    [flushPendingColor]
  );

  const handleColorBlur = useCallback(() => {
    if (colorThrottleRef.current) {
      clearTimeout(colorThrottleRef.current);
      colorThrottleRef.current = undefined;
    }
    flushPendingColor();
  }, [flushPendingColor]);

  const handleHexBlur = useCallback(() => {
    if (hexText.length === 3 || hexText.length === 6) {
      onChange("#" + hexText);
    }
  }, [hexText, onChange]);

  const handleHexChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(LEADING_HASH_REGEX, "");
      if (HEX_TEXT_REGEX.test(raw)) {
        setHexText(raw);
        if (raw.length === 6) {
          onChange("#" + raw);
        }
      }
    },
    [onChange]
  );

  const handleCopy = useCallback(() => {
    // navigator.clipboard is undefined in non-secure contexts; guard the access itself.
    const clipboard = globalThis.navigator?.clipboard;
    if (typeof clipboard?.writeText !== "function") {
      return;
    }
    clipboard.writeText(normalizedValue).catch(() => undefined);
  }, [normalizedValue]);

  const openPicker = useCallback(() => {
    colorInputRef.current?.click();
  }, []);

  return (
    <Box className={className} sx={{ opacity: disabled === true ? 0.4 : 1 }}>
      {/* Hidden native color input — uncontrolled, updated via ref */}
      <input
        ref={colorInputRef}
        {...(id !== undefined && id.length > 0 ? { id } : {})}
        type="color"
        defaultValue={normalizedValue}
        onChange={handleColorChange}
        onBlur={handleColorBlur}
        disabled={disabled}
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none"
        }}
      />
      <TextField
        size="small"
        label={label}
        value={hexText}
        onChange={handleHexChange}
        onBlur={handleHexBlur}
        placeholder="000000"
        disabled={disabled}
        fullWidth
        sx={{ "& .MuiInputBase-input": { fontFamily: MONO_FONT_FAMILY, fontSize: 12 } }}
        slotProps={{
          htmlInput: { "aria-label": ariaLabel, maxLength: 7 },
          input: {
            startAdornment: (
              <InputAdornment position="start" sx={{ mr: 0.75 }}>
                <Box
                  onClick={disabled === true ? undefined : openPicker}
                  sx={{
                    width: SWATCH_SIZE,
                    height: SWATCH_SIZE,
                    borderRadius: 1,
                    backgroundColor: normalizedValue,
                    // Keeps swatches that match the panel background visible.
                    boxShadow:
                      "inset 0 0 0 1px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)",
                    cursor: disabled === true ? "default" : "pointer",
                    flexShrink: 0
                  }}
                />
                <Box
                  component="span"
                  sx={{
                    ml: 1,
                    color: "text.secondary",
                    fontFamily: MONO_FONT_FAMILY,
                    fontSize: 12,
                    userSelect: "none"
                  }}
                >
                  #
                </Box>
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={handleCopy}
                  disabled={disabled}
                  title="Copy hex color"
                >
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </InputAdornment>
            )
          }
        }}
      />
    </Box>
  );
};
