// Shared form components for annotation editors.
import React from "react";
import { Button } from "@mantine/core";

const TOGGLE_BASE_STYLE: React.CSSProperties = {
  fontWeight: 500,
  minWidth: 0,
  paddingLeft: 12,
  paddingRight: 12,
  paddingTop: 4,
  paddingBottom: 4
};

/**
 * Toggle pill button
 */
export const Toggle: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  sx?: React.CSSProperties;
}> = ({ active, onClick, children, sx }) => {
  const mergedStyle = sx !== undefined ? { ...TOGGLE_BASE_STYLE, ...sx } : TOGGLE_BASE_STYLE;
  return (
    <Button
      variant={active ? "filled" : "outline"}
      size="compact-sm"
      onClick={onClick}
      style={mergedStyle}
    >
      {children}
    </Button>
  );
};

/**
 * Grid pattern background for previews (style-compatible object)
 */
export const PREVIEW_GRID_BG_SX = {
  backgroundImage:
    "url('data:image/svg+xml,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22grid%22%20width%3D%2220%22%20height%3D%2220%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Cpath%20d%3D%22M%200%200%20L%2020%200%2020%2020%22%20fill%3D%22none%22%20stroke%3D%22rgba(255%2C255%2C255%2C0.03)%22%20stroke-width%3D%221%22%2F%3E%3C%2Fpattern%3E%3C%2Fdefs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23grid)%22%2F%3E%3C%2Fsvg%3E')"
};
