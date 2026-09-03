// Basic settings tab for lab settings.
import React from "react";
import Box from "@mui/material/Box";

import { InputField, SelectField, type SelectOption } from "../../ui/form";

import type { BasicSettingsSetters, BasicSettingsState, PrefixType } from "./types";

interface BasicTabProps {
  basic: BasicSettingsState;
  setBasic: BasicSettingsSetters;
  isViewMode: boolean;
}

const PREFIX_TYPE_OPTIONS: SelectOption[] = [
  { value: "default", label: "Default (clab)" },
  { value: "custom", label: "Custom" },
  { value: "no-prefix", label: "No prefix" }
];

export const BasicTab: React.FC<BasicTabProps> = ({ basic, setBasic, isViewMode }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
    {/* Lab Name */}
    <InputField
      id="lab-basic-name"
      label="Lab Name"
      placeholder="Unique name for this topology"
      value={basic.labName}
      onChange={setBasic.setLabName}
      disabled={isViewMode}
    />

    {/* Prefix */}
    <SelectField
      id="lab-basic-prefix-type"
      label="Container Name Prefix"
      value={basic.prefixType}
      onChange={(v) => setBasic.setPrefixType(v as PrefixType)}
      options={PREFIX_TYPE_OPTIONS}
      disabled={isViewMode}
    />

    {basic.prefixType === "custom" && (
      <InputField
        id="lab-basic-custom-prefix"
        label="Custom Prefix"
        placeholder="Enter custom prefix"
        value={basic.customPrefix}
        onChange={setBasic.setCustomPrefix}
        disabled={isViewMode}
      />
    )}
  </Box>
);
