// Box section of the node editor, shown in the boxed node style.
import React, { useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

import { ColorField, InputField, PanelSectionHeader, SelectField } from "../../ui/form";
import { NODE_BOX_THEME_COLORS } from "../../canvas/nodeBox";
import {
  NODE_BOX_BLUR_RANGE,
  NODE_BOX_BORDER_WIDTH_RANGE,
  NODE_BOX_CORNER_RADIUS_RANGE,
  NODE_BOX_OPACITY_RANGE,
  normalizeNodeBoxAppearance,
  type NodeBoxAppearance
} from "../../../core/utilities/nodeBoxAppearance";

import type { TabProps } from "./types";

/** Blur applied when frosted glass is switched on. */
const GLASS_DEFAULT_BLUR = 8;
/** Fill opacity applied with frosted glass, so the blur behind the box shows through. */
const GLASS_DEFAULT_OPACITY = 60;
const GLASS_MIN_BLUR = 2;

const BORDER_WIDTH_OPTIONS = Array.from(
  { length: NODE_BOX_BORDER_WIDTH_RANGE.max - NODE_BOX_BORDER_WIDTH_RANGE.min + 1 },
  (_, index) => {
    const width = NODE_BOX_BORDER_WIDTH_RANGE.min + index;
    return { value: String(width), label: width === 0 ? "None" : `${width} px` };
  }
);

// Matches the panel section gutter (see PanelSections).
const BODY_SX = { px: 2, pt: 1.5, pb: 0.5, display: "flex", flexDirection: "column", gap: 2 };
const GROUP_SX = { display: "flex", flexDirection: "column", gap: 0.5 } as const;
const CONTROL_ROW_SX = { display: "flex", alignItems: "center", gap: 1.5, minHeight: 32 } as const;
const CONTROL_LABEL_SX = { width: 84, flexShrink: 0, color: "text.secondary" } as const;
const CONTROL_VALUE_SX = {
  width: 40,
  flexShrink: 0,
  textAlign: "right",
  color: "text.secondary",
  fontVariantNumeric: "tabular-nums"
} as const;

let probeContext: CanvasRenderingContext2D | null | undefined;

/** Resolve a CSS color (variables and color-mix() included) to #rrggbb. */
function resolveCssColorToHex(cssColor: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = cssColor;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  // color-mix() computes to color(srgb ...), so paint it and read the pixel back.
  probeContext ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!probeContext || computed.length === 0) return fallback;
  probeContext.clearRect(0, 0, 1, 1);
  probeContext.fillStyle = computed;
  probeContext.fillRect(0, 0, 1, 1);
  const [r, g, b] = probeContext.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Colors the canvas uses for unset box colors; recomputed when the app theme changes. */
function useThemeBoxColors(): Record<keyof typeof NODE_BOX_THEME_COLORS, string> {
  const { palette } = useTheme();
  const paper = palette.background.paper;
  const divider = palette.divider;
  const text = palette.text.primary;
  return useMemo(
    () => ({
      fill: resolveCssColorToHex(NODE_BOX_THEME_COLORS.fill, paper),
      border: resolveCssColorToHex(NODE_BOX_THEME_COLORS.border, divider),
      text: resolveCssColorToHex(NODE_BOX_THEME_COLORS.text, text)
    }),
    [paper, divider, text]
  );
}

interface BoxColorFieldProps {
  testId: string;
  label: string;
  value: string | undefined;
  themeValue: string;
  onChange: (value: string | undefined) => void;
}

/** Color that follows the theme while unset; the reset button returns it to the theme. */
const BoxColorField: React.FC<BoxColorFieldProps> = ({
  testId,
  label,
  value,
  themeValue,
  onChange
}) => {
  const isThemed = value === undefined;
  return (
    <Box data-testid={testId} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <ColorField
          id={`${testId}-input`}
          label={isThemed ? `${label} · Theme` : label}
          value={value ?? themeValue}
          onChange={onChange}
        />
      </Box>
      <Tooltip title={isThemed ? "Follows the theme" : "Use theme color"}>
        <span>
          <IconButton
            size="small"
            aria-label={`Use theme ${label.toLowerCase()}`}
            data-testid={`${testId}-reset`}
            edge="end"
            disabled={isThemed}
            onClick={() => onChange(undefined)}
          >
            <RestartAltIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
};

interface SliderRowProps {
  testId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({
  testId,
  label,
  value,
  min,
  max,
  unit,
  onChange
}) => (
  <Box sx={CONTROL_ROW_SX}>
    <Typography variant="body2" sx={CONTROL_LABEL_SX}>
      {label}
    </Typography>
    <Slider
      data-testid={testId}
      size="small"
      value={value}
      min={min}
      max={max}
      step={1}
      onChange={(_event: Event, next: number | number[]) =>
        onChange(Array.isArray(next) ? next[0] : next)
      }
      slotProps={{ input: { "aria-label": label } }}
      sx={{ flex: 1, mx: 0.5 }}
    />
    <Typography variant="body2" sx={CONTROL_VALUE_SX}>
      {value}
      {unit}
    </Typography>
  </Box>
);

interface SwitchRowProps {
  testId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const SwitchRow: React.FC<SwitchRowProps> = ({ testId, label, checked, onChange }) => (
  <Box sx={{ ...CONTROL_ROW_SX, justifyContent: "space-between" }}>
    <Typography variant="body2" sx={{ color: "text.secondary" }}>
      {label}
    </Typography>
    <Switch
      data-testid={testId}
      size="small"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      slotProps={{ input: { "aria-label": label } }}
      // Flush with the field edges above.
      sx={{ mr: 0 }}
    />
  </Box>
);

function parseCornerRadius(text: string): number | undefined {
  if (text.trim().length === 0) return undefined;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(
    NODE_BOX_CORNER_RADIUS_RANGE.max,
    Math.max(NODE_BOX_CORNER_RADIUS_RANGE.min, parsed)
  );
}

export const BoxAppearanceFields: React.FC<TabProps> = ({ data, onChange }) => {
  const box = useMemo(() => normalizeNodeBoxAppearance(data.box) ?? {}, [data.box]);
  const themeColors = useThemeBoxColors();

  const update = useCallback(
    (patch: Partial<NodeBoxAppearance>) => {
      onChange({ box: normalizeNodeBoxAppearance({ ...box, ...patch }) });
    },
    [box, onChange]
  );

  const opacity = box.opacity ?? NODE_BOX_OPACITY_RANGE.default;
  const blur = box.blur ?? NODE_BOX_BLUR_RANGE.default;
  const isGlass = blur > 0;
  const borderWidth = box.borderWidth ?? NODE_BOX_BORDER_WIDTH_RANGE.default;
  const hasCustomBox = Object.keys(box).length > 0;

  const handleGlassChange = (enabled: boolean) => {
    if (!enabled) {
      update({ blur: undefined });
      return;
    }
    update({
      blur: GLASS_DEFAULT_BLUR,
      opacity: box.opacity ?? GLASS_DEFAULT_OPACITY
    });
  };

  return (
    <>
      <PanelSectionHeader
        title="Box"
        action={
          <Button
            variant="text"
            size="small"
            data-testid="node-box-reset"
            disabled={!hasCustomBox}
            onClick={() => onChange({ box: undefined })}
            sx={{ minHeight: 24, py: 0, mr: -1 }}
          >
            Reset to theme
          </Button>
        }
      />
      <Box sx={BODY_SX}>
        <Box sx={GROUP_SX}>
          <BoxColorField
            testId="node-box-color"
            label="Fill Color"
            value={box.color}
            themeValue={themeColors.fill}
            onChange={(color) => update({ color })}
          />
          <Box sx={{ mt: 0.5 }}>
            <SliderRow
              testId="node-box-opacity"
              label="Opacity"
              value={opacity}
              min={NODE_BOX_OPACITY_RANGE.min}
              max={NODE_BOX_OPACITY_RANGE.max}
              unit="%"
              onChange={(value) => update({ opacity: value })}
            />
            <SwitchRow
              testId="node-box-glass"
              label="Frosted glass"
              checked={isGlass}
              onChange={handleGlassChange}
            />
            {isGlass && (
              <SliderRow
                testId="node-box-blur"
                label="Blur"
                value={blur}
                min={GLASS_MIN_BLUR}
                max={NODE_BOX_BLUR_RANGE.max}
                unit=" px"
                onChange={(value) => update({ blur: value })}
              />
            )}
          </Box>
        </Box>

        <Box sx={GROUP_SX}>
          <BoxColorField
            testId="node-box-border-color"
            label="Border Color"
            value={box.borderColor}
            themeValue={themeColors.border}
            onChange={(borderColor) => update({ borderColor })}
          />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mt: 1 }}>
            <Box data-testid="node-box-border-width">
              <SelectField
                id="node-box-border-width-select"
                label="Border Width"
                value={String(borderWidth)}
                onChange={(value) => update({ borderWidth: Number(value) })}
                options={BORDER_WIDTH_OPTIONS}
              />
            </Box>
            <Box data-testid="node-box-radius">
              <InputField
                id="node-box-radius-input"
                label="Corner Radius"
                type="number"
                value={box.cornerRadius === undefined ? "" : String(box.cornerRadius)}
                onChange={(value) => update({ cornerRadius: parseCornerRadius(value) })}
                placeholder="Auto"
                clearable
                min={NODE_BOX_CORNER_RADIUS_RANGE.min}
                max={NODE_BOX_CORNER_RADIUS_RANGE.max}
                suffix="px"
              />
            </Box>
          </Box>
        </Box>

        <Box sx={GROUP_SX}>
          <BoxColorField
            testId="node-box-text-color"
            label="Name Color"
            value={box.textColor}
            themeValue={themeColors.text}
            onChange={(textColor) => update({ textColor })}
          />
          <Box sx={{ mt: 0.5 }}>
            <SwitchRow
              testId="node-box-shadow"
              label="Shadow"
              checked={box.shadow !== false}
              onChange={(shadow) => update({ shadow: shadow ? undefined : false })}
            />
          </Box>
        </Box>
      </Box>
    </>
  );
};
