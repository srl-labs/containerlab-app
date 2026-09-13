/* eslint-disable import-x/max-dependencies */
// Text annotation editor form.
import React from "react";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiIconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

import type { FreeTextAnnotation } from "../../../core/types/topology";
import { ColorField, InputField, PanelSection } from "../../ui/form";

// Helper functions to avoid duplicate calculations
const DEFAULT_FILL_COLOR = "#000000";

const isNoFillBackground = (bg: string | undefined): boolean => {
  if (bg === undefined) return true;
  const normalized = bg.trim().toLowerCase();
  return normalized.length === 0 || normalized === "transparent";
};

const FONTS = [
  "monospace",
  "sans-serif",
  "serif",
  "Arial",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Times New Roman",
  "Verdana"
];

// Static menu items, hoisted so they are not rebuilt on every render
const FONT_MENU_ITEMS = FONTS.map((f) => (
  <MenuItem key={f} value={f}>
    {f}
  </MenuItem>
));

interface Props {
  formData: FreeTextAnnotation;
  updateField: <K extends keyof FreeTextAnnotation>(field: K, value: FreeTextAnnotation[K]) => void;
}

// Icon button for toolbar
const IconBtn: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}> = ({ active, onClick, children, title }) => (
  <MuiIconButton
    title={title}
    onClick={onClick}
    size="small"
    sx={{
      borderRadius: 0.5,
      color: active ? "primary.contrastText" : "text.primary",
      bgcolor: active ? "primary.main" : "transparent",
      "&:hover": { bgcolor: active ? "primary.dark" : "action.hover" }
    }}
  >
    {children}
  </MuiIconButton>
);

// Formatting toolbar
const Toolbar: React.FC<{ formData: FreeTextAnnotation; updateField: Props["updateField"] }> = ({
  formData,
  updateField
}) => {
  const isBold = formData.fontWeight === "bold";
  const isItalic = formData.fontStyle === "italic";
  const isUnderline = formData.textDecoration === "underline";
  const align = formData.textAlign ?? "left";

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        pb: 0.75,
        borderRadius: 0.5
      }}
    >
      <IconBtn
        active={isBold}
        onClick={() => updateField("fontWeight", isBold ? "normal" : "bold")}
        title="Bold"
      >
        <FormatBoldIcon fontSize="small" />
      </IconBtn>
      <IconBtn
        active={isItalic}
        onClick={() => updateField("fontStyle", isItalic ? "normal" : "italic")}
        title="Italic"
      >
        <FormatItalicIcon fontSize="small" />
      </IconBtn>
      <IconBtn
        active={isUnderline}
        onClick={() => updateField("textDecoration", isUnderline ? "none" : "underline")}
        title="Underline"
      >
        <FormatUnderlinedIcon fontSize="small" />
      </IconBtn>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.75 }} />
      <IconBtn
        active={align === "left"}
        onClick={() => updateField("textAlign", "left")}
        title="Align Left"
      >
        <FormatAlignLeftIcon fontSize="small" />
      </IconBtn>
      <IconBtn
        active={align === "center"}
        onClick={() => updateField("textAlign", "center")}
        title="Align Center"
      >
        <FormatAlignCenterIcon fontSize="small" />
      </IconBtn>
      <IconBtn
        active={align === "right"}
        onClick={() => updateField("textAlign", "right")}
        title="Align Right"
      >
        <FormatAlignRightIcon fontSize="small" />
      </IconBtn>
    </Box>
  );
};

// Font controls
const FontControls: React.FC<{
  formData: FreeTextAnnotation;
  updateField: Props["updateField"];
}> = ({ formData, updateField }) => (
  <Box sx={{ display: "flex", gap: 1 }}>
    <TextField
      select
      label="Font Family"
      size="small"
      value={formData.fontFamily ?? "monospace"}
      onChange={(e) => updateField("fontFamily", e.target.value)}
      sx={{ flex: 7 }}
    >
      {FONT_MENU_ITEMS}
    </TextField>
    <Box sx={{ flex: 3 }}>
      <InputField
        id="text-font-size"
        label="Font Size"
        type="number"
        value={String(formData.fontSize ?? 14)}
        onChange={(v) => updateField("fontSize", parseInt(v) || 14)}
        min={1}
        max={72}
        suffix="px"
      />
    </Box>
  </Box>
);

// Style options (colors, toggles, rotation)
const StyleOptions: React.FC<{
  formData: FreeTextAnnotation;
  updateField: Props["updateField"];
}> = ({ formData, updateField }) => {
  const isNoFill = isNoFillBackground(formData.backgroundColor);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
        <Box sx={{ flex: 1 }}>
          <ColorField
            label="Text"
            value={formData.fontColor ?? "#FFFFFF"}
            onChange={(v) => updateField("fontColor", v)}
          />
        </Box>
        <Box sx={{ flex: 1 }}>
          <ColorField
            label="Fill"
            value={isNoFill ? DEFAULT_FILL_COLOR : (formData.backgroundColor ?? DEFAULT_FILL_COLOR)}
            onChange={(v) => updateField("backgroundColor", v)}
            disabled={isNoFill}
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={isNoFill}
                onChange={() =>
                  updateField("backgroundColor", isNoFill ? DEFAULT_FILL_COLOR : undefined)
                }
              />
            }
            label="No fill"
            slotProps={{ typography: { variant: "caption" } }}
          />
        </Box>
      </Box>
      <InputField
        id="text-rotation"
        label="Rotation"
        type="number"
        value={String(formData.rotation ?? 0)}
        onChange={(v) => updateField("rotation", parseInt(v) || 0)}
        min={-360}
        max={360}
        suffix="deg"
      />
    </Box>
  );
};

// Main component
export const FreeTextFormContent: React.FC<Props> = ({ formData, updateField }) => (
  <Box sx={{ display: "flex", flexDirection: "column" }}>
    <PanelSection title="Text" withTopDivider={false} bodySx={{ p: 2 }}>
      <Toolbar formData={formData} updateField={updateField} />
      <TextField
        multiline
        minRows={2}
        fullWidth
        value={formData.text}
        onChange={(e) => updateField("text", e.target.value)}
        placeholder="Enter your text... (Markdown and fenced code blocks supported)"
        sx={{ "& textarea": { resize: "vertical", overflow: "auto" } }}
      />
    </PanelSection>

    <PanelSection title="Font" bodySx={{ p: 2 }}>
      <FontControls formData={formData} updateField={updateField} />
    </PanelSection>

    <PanelSection title="Style" bodySx={{ p: 2 }}>
      <StyleOptions formData={formData} updateField={updateField} />
    </PanelSection>
  </Box>
);
