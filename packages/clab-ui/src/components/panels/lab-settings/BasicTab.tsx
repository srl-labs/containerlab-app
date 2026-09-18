// Basic settings tab for lab settings.
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
    <SettingsField title="Lab Name" description="Unique name for this topology.">
      <TextField
        id="lab-basic-name"
        size="small"
        placeholder="Unique name for this topology"
        value={basic.labName}
        onChange={(event) => setBasic.setLabName(event.target.value)}
        disabled={isViewMode}
        sx={{ minWidth: 220 }}
      />
    </SettingsField>
    <SettingsField title="Container Name Prefix" description="Prefix applied to deployed container names.">
      <TextField
        id="lab-basic-prefix-type"
        select
        size="small"
        value={basic.prefixType}
        onChange={(event) => setBasic.setPrefixType(event.target.value as PrefixType)}
        disabled={isViewMode}
        sx={{ minWidth: 160 }}
      >
        <MenuItem value="default">Default (clab)</MenuItem>
        <MenuItem value="custom">Custom</MenuItem>
        <MenuItem value="no-prefix">No prefix</MenuItem>
      </TextField>
    </SettingsField>
    {basic.prefixType === "custom" ? (
      <SettingsField title="Custom Prefix" description="Used instead of the default clab prefix.">
        <TextField
          id="lab-basic-custom-prefix"
          size="small"
          placeholder="Enter custom prefix"
          value={basic.customPrefix}
          onChange={(event) => setBasic.setCustomPrefix(event.target.value)}
          disabled={isViewMode}
          sx={{ minWidth: 160 }}
        />
      </SettingsField>
    ) : null}
  </>
);
