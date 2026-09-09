// Shared form components for annotation editors.
import React from "react";
import Button from "@mui/material/Button";
import type { SxProps, Theme } from "@mui/material/styles";

const TOGGLE_BASE_SX = {
  fontWeight: (theme: Theme) => theme.typography.fontWeightMedium,
  minWidth: 0,
  px: 1.5,
  py: 0.5
};

/**
 * Toggle pill button
 */
export const Toggle: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}> = ({ active, onClick, children, sx }) => {
  const mergedSx =
    sx !== undefined && !Array.isArray(sx) && typeof sx !== "function"
      ? Object.assign({}, TOGGLE_BASE_SX, sx)
      : TOGGLE_BASE_SX;
  return (
    <Button
      variant={active ? "contained" : "outlined"}
      size="small"
      onClick={onClick}
      sx={mergedSx}
    >
      {children}
    </Button>
  );
};

/**
 * Grid pattern background for previews (sx-compatible style object)
 */
export const PREVIEW_GRID_BG_SX = {
  backgroundImage:
    "url('data:image/svg+xml,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22grid%22%20width%3D%2220%22%20height%3D%2220%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Cpath%20d%3D%22M%200%200%20L%2020%200%2020%2020%22%20fill%3D%22none%22%20stroke%3D%22rgba(255%2C255%2C255%2C0.03)%22%20stroke-width%3D%221%22%2F%3E%3C%2Fpattern%3E%3C%2Fdefs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23grid)%22%2F%3E%3C%2Fsvg%3E')"
};
