// Color swatch that opens the system color picker, shared by every color control.
import React from "react";
import Box from "@mui/material/Box";

const CHECKERBOARD =
  "repeating-conic-gradient(rgba(128, 128, 128, 0.35) 0% 25%, transparent 0% 50%) 50% / 8px 8px";
const ACCENT_RING = "var(--clab-ui-button-background, var(--vscode-button-background))";

interface ColorSwatchProps {
  /** Any CSS color; translucent colors show the checkerboard through. */
  color: string;
  /** The opaque `#rrggbb` the system picker starts from. */
  pickerValue: string;
  onPick: (hex: string) => void;
  onPickEnd?: () => void;
  ariaLabel: string;
  size?: number;
  disabled?: boolean;
  /** Rings the swatch, e.g. for a color that differs from its default. */
  highlighted?: boolean;
  testId?: string;
}

/**
 * The native color input sits invisibly over the swatch, so a click, Enter or
 * Space opens the picker and keyboard focus shows on the swatch.
 */
export const ColorSwatch: React.FC<ColorSwatchProps> = ({
  color,
  pickerValue,
  onPick,
  onPickEnd,
  ariaLabel,
  size = 20,
  disabled = false,
  highlighted = false,
  testId
}) => (
  <Box
    component="label"
    sx={{
      position: "relative",
      display: "block",
      width: size,
      height: size,
      flexShrink: 0,
      overflow: "hidden",
      borderRadius: "4px",
      // Mid-grey edges keep dark swatches visible on dark surfaces and light ones on light.
      border: "1px solid rgba(128, 128, 128, 0.6)",
      background: CHECKERBOARD,
      boxShadow: highlighted
        ? `0 0 0 1px var(--clab-ui-editor-background, var(--vscode-editor-background)), 0 0 0 2px ${ACCENT_RING}`
        : "none",
      cursor: disabled ? "default" : "pointer",
      "&:focus-within": { outline: "1px solid var(--vscode-focusBorder)", outlineOffset: 2 }
    }}
  >
    <Box component="span" style={{ background: color }} sx={{ position: "absolute", inset: 0 }} />
    <Box
      component="input"
      type="color"
      aria-label={ariaLabel}
      data-testid={testId}
      value={pickerValue}
      disabled={disabled}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onPick(event.target.value)}
      onBlur={onPickEnd}
      sx={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        p: 0,
        border: 0,
        opacity: 0,
        cursor: "inherit"
      }}
    />
  </Box>
);
