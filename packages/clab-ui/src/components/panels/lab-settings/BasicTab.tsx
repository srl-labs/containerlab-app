// General settings tab for lab settings.
import React from "react";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

import { SettingsField } from "../../../settings/SettingsField";

import type { BasicSettingsSetters, BasicSettingsState, PrefixType } from "./types";

interface BasicTabProps {
  basic: BasicSettingsState;
  setBasic: BasicSettingsSetters;
  isViewMode: boolean;
}

export const BasicTab: React.FC<BasicTabProps> = ({ basic, setBasic, isViewMode }) => (
  <>
    <SettingsField title="Lab name" description="Unique name for this topology.">
      <TextField
        slotProps={{ htmlInput: { "aria-label": "Lab name" } }}
        id="lab-basic-name"
        size="small"
        placeholder="Unique name for this topology"
        value={basic.labName}
        onChange={(event) => setBasic.setLabName(event.target.value)}
        disabled={isViewMode}
      />
    </SettingsField>
    <SettingsField title="Container name prefix" description="Prefix applied to deployed container names.">
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": "Container name prefix" } } }}
        id="lab-basic-prefix-type"
        select
        size="small"
        value={basic.prefixType}
        onChange={(event) => setBasic.setPrefixType(event.target.value as PrefixType)}
        disabled={isViewMode}
      >
        <MenuItem value="default">Default (clab)</MenuItem>
        <MenuItem value="custom">Custom</MenuItem>
        <MenuItem value="no-prefix">No prefix</MenuItem>
      </TextField>
    </SettingsField>
    {basic.prefixType === "custom" ? (
      <SettingsField title="Custom prefix" description="Used instead of the default clab prefix.">
        <TextField
          slotProps={{ htmlInput: { "aria-label": "Custom prefix" } }}
          id="lab-basic-custom-prefix"
          size="small"
          placeholder="Enter custom prefix"
          value={basic.customPrefix}
          onChange={(event) => setBasic.setCustomPrefix(event.target.value)}
          disabled={isViewMode}
        />
      </SettingsField>
    ) : null}
  </>
);
