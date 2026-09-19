import React, { useEffect, useState } from "react";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

import { SettingsField } from "../../../settings/SettingsField";
import { invertHexColor, resolveComputedColor } from "../../../utils/color";
import { ColorField, InputField } from "../../ui/form";
import type { GridSettingsControlsProps } from "../GridSettingsPopover";

interface GridTabProps extends GridSettingsControlsProps {
  isReadOnly: boolean;
}

function isGridStyle(value: unknown): value is GridSettingsControlsProps["gridStyle"] {
  return value === "dotted" || value === "quadratic";
}

export const GridTab: React.FC<GridTabProps> = ({
  gridLineWidth,
  onGridLineWidthChange,
  gridStyle,
  onGridStyleChange,
  gridColor,
  onGridColorChange,
  gridBgColor,
  onGridBgColorChange,
  onResetGridColors,
  isReadOnly
}) => {
  const [themeBgColor, setThemeBgColor] = useState("#1e1e1e");
  const hasCustomGridColors = gridColor !== null || gridBgColor !== null;
  const effectiveGridBgColor = gridBgColor ?? themeBgColor;
  const defaultGridColor = invertHexColor(effectiveGridBgColor);

  useEffect(() => {
    setThemeBgColor(resolveComputedColor("--vscode-editor-background", "#1e1e1e"));
  }, []);

  return (
    <Box data-testid="lab-settings-grid-settings" sx={{ display: "contents" }}>
      <SettingsField title="Stroke Width" description="Thickness of canvas grid lines.">
        <Box data-testid="lab-settings-grid-line-width" sx={{ width: 160 }}>
          <InputField
            id="lab-settings-grid-line-width"
            ariaLabel="Stroke Width"
            type="number"
            value={String(gridLineWidth)}
            min={0.00001}
            max={2}
            step={0.1}
            disabled={isReadOnly}
            onChange={(value) => {
              if (isReadOnly) return;
              const next = Number(value);
              if (!Number.isFinite(next)) return;
              onGridLineWidthChange(Math.min(2, Math.max(0.00001, next)));
            }}
          />
        </Box>
      </SettingsField>
      <SettingsField title="Grid Style" description="Dotted points or quadratic lines.">
        <TextField
          slotProps={{ select: { inputProps: { "aria-label": "Grid Style" } } }}
          data-testid="lab-settings-grid-style"
          select
          size="small"
          value={gridStyle}
          disabled={isReadOnly}
          onChange={(event) => {
            if (isReadOnly) return;
            if (isGridStyle(event.target.value)) {
              onGridStyleChange(event.target.value);
            }
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="dotted">Dotted</MenuItem>
          <MenuItem value="quadratic">Quadratic</MenuItem>
        </TextField>
      </SettingsField>
      <SettingsField title="Grid Color" description="Color of the canvas grid.">
        <Box sx={{ width: 180 }}>
          <ColorField
            ariaLabel="Grid Color"
            value={gridColor ?? defaultGridColor}
            disabled={isReadOnly}
            onChange={(value) => onGridColorChange(value)}
          />
        </Box>
      </SettingsField>
      <SettingsField
        title="Background Color"
        description="Canvas background behind the grid."
        actions={
          hasCustomGridColors ? (
            <Button
              size="small"
              variant="text"
              startIcon={<RestartAltIcon />}
              disabled={isReadOnly}
              onClick={onResetGridColors}
            >
              Reset to theme colors
            </Button>
          ) : undefined
        }
      >
        <Box sx={{ width: 180 }}>
          <ColorField
            ariaLabel="Background Color"
            value={gridBgColor ?? themeBgColor}
            disabled={isReadOnly}
            onChange={(value) => onGridBgColorChange(value)}
          />
        </Box>
      </SettingsField>
    </Box>
  );
};
