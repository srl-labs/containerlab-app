/* eslint-disable import-x/max-dependencies */
// Text annotation editor form.
import React from "react";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconItalic,
  IconUnderline
} from "@tabler/icons-react";
import { ActionIcon, Box, Checkbox, Divider, Select, Textarea } from "@mantine/core";

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

// Static select options, hoisted so they are not rebuilt on every render
const FONT_OPTIONS = FONTS.map((f) => ({ value: f, label: f }));

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
  <ActionIcon
    title={title}
    onClick={onClick}
    variant={active ? "filled" : "subtle"}
    color={active ? "blue" : "gray"}
    radius="sm"
  >
    {children}
  </ActionIcon>
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        paddingBottom: 6,
        borderRadius: 4
      }}
    >
      <IconBtn
        active={isBold}
        onClick={() => updateField("fontWeight", isBold ? "normal" : "bold")}
        title="Bold"
      >
        <IconBold size={18} />
      </IconBtn>
      <IconBtn
        active={isItalic}
        onClick={() => updateField("fontStyle", isItalic ? "normal" : "italic")}
        title="Italic"
      >
        <IconItalic size={18} />
      </IconBtn>
      <IconBtn
        active={isUnderline}
        onClick={() => updateField("textDecoration", isUnderline ? "none" : "underline")}
        title="Underline"
      >
        <IconUnderline size={18} />
      </IconBtn>
      <Divider orientation="vertical" style={{ marginInline: 6, height: 24, alignSelf: "center" }} />
      <IconBtn
        active={align === "left"}
        onClick={() => updateField("textAlign", "left")}
        title="Align Left"
      >
        <IconAlignLeft size={18} />
      </IconBtn>
      <IconBtn
        active={align === "center"}
        onClick={() => updateField("textAlign", "center")}
        title="Align Center"
      >
        <IconAlignCenter size={18} />
      </IconBtn>
      <IconBtn
        active={align === "right"}
        onClick={() => updateField("textAlign", "right")}
        title="Align Right"
      >
        <IconAlignRight size={18} />
      </IconBtn>
    </Box>
  );
};

// Font controls
const FontControls: React.FC<{
  formData: FreeTextAnnotation;
  updateField: Props["updateField"];
}> = ({ formData, updateField }) => (
  <Box style={{ display: "flex", gap: 8 }}>
    <Select
      label="Font Family"
      size="sm"
      data={FONT_OPTIONS}
      value={formData.fontFamily ?? "monospace"}
      onChange={(value) => updateField("fontFamily", value ?? "monospace")}
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
      style={{ flex: 7 }}
    />
    <Box style={{ flex: 3 }}>
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
    <Box style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Box style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <Box style={{ flex: 1 }}>
          <ColorField
            label="Text"
            value={formData.fontColor ?? "#FFFFFF"}
            onChange={(v) => updateField("fontColor", v)}
          />
        </Box>
        <Box style={{ flex: 1 }}>
          <ColorField
            label="Fill"
            value={isNoFill ? DEFAULT_FILL_COLOR : (formData.backgroundColor ?? DEFAULT_FILL_COLOR)}
            onChange={(v) => updateField("backgroundColor", v)}
            disabled={isNoFill}
          />
          <Checkbox
            mt={8}
            size="xs"
            checked={isNoFill}
            onChange={() =>
              updateField("backgroundColor", isNoFill ? DEFAULT_FILL_COLOR : undefined)
            }
            label="No fill"
            styles={{ label: { fontSize: "var(--mantine-font-size-xs)" } }}
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
  <Box style={{ display: "flex", flexDirection: "column" }}>
    <PanelSection title="Text" withTopDivider={false} bodySx={{ padding: 16 }}>
      <Toolbar formData={formData} updateField={updateField} />
      <Textarea
        minRows={2}
        value={formData.text}
        onChange={(e) => updateField("text", e.currentTarget.value)}
        placeholder="Enter your text... (Markdown and fenced code blocks supported)"
        styles={{ input: { resize: "vertical", overflow: "auto" } }}
      />
    </PanelSection>

    <PanelSection title="Font" bodySx={{ padding: 16 }}>
      <FontControls formData={formData} updateField={updateField} />
    </PanelSection>

    <PanelSection title="Style" bodySx={{ padding: 16 }}>
      <StyleOptions formData={formData} updateField={updateField} />
    </PanelSection>
  </Box>
);
