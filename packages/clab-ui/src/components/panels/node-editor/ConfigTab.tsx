// Configuration tab for node editor.
import React from "react";
import Box from "@mui/material/Box";

import {
  InputField,
  SelectField,
  DynamicList,
  KeyValueList,
  PanelAddSection,
  PanelSection
} from "../../ui/form";

import type { TabProps } from "./types";
import { inheritedFieldHint, inheritedListItems, inheritedMapEntries } from "./inheritanceHints";
import { CredentialsSection } from "./CredentialsSection";

type StartupConfigMode = "default" | "enforce" | "suppress";

const STARTUP_CONFIG_MODE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "enforce", label: "Enforce startup config" },
  { value: "suppress", label: "Suppress startup config" }
];

function isStartupConfigMode(value: string): value is StartupConfigMode {
  return value === "default" || value === "enforce" || value === "suppress";
}

function getStartupConfigMode(data: {
  enforceStartupConfig?: boolean;
  suppressStartupConfig?: boolean;
}): StartupConfigMode {
  if (data.enforceStartupConfig === true) return "enforce";
  if (data.suppressStartupConfig === true) return "suppress";
  return "default";
}

export const ConfigTab: React.FC<TabProps> = (props) => {
  const { data, onChange } = props;
  const mode = getStartupConfigMode(data);
  const modeHint =
    inheritedFieldHint(props, "enforceStartupConfig") ??
    inheritedFieldHint(props, "suppressStartupConfig");

  const handleModeChange = (newMode: StartupConfigMode) => {
    onChange({
      enforceStartupConfig: newMode === "enforce",
      suppressStartupConfig: newMode === "suppress"
    });
  };

  const handleAddBind = () => {
    onChange({ binds: [...(data.binds ?? []), ""] });
  };

  const handleAddEnvVar = () => {
    onChange({ env: { ...data.env, "": "" } });
  };

  const handleAddEnvFile = () => {
    onChange({ envFiles: [...(data.envFiles ?? []), ""] });
  };

  const handleAddLabel = () => {
    onChange({ labels: { ...data.labels, "": "" } });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <PanelSection title="Startup Configuration">
        <InputField
          id="node-startup-config"
          label="Startup configuration Path"
          value={data.startupConfig ?? ""}
          onChange={(value) => onChange({ startupConfig: value })}
          placeholder="Path to startup configuration file"
          helperText={inheritedFieldHint(props, "startupConfig")}
          magicVariables
        />
        <SelectField
          id="node-startup-config-mode"
          label="Startup configuration mode"
          value={mode}
          onChange={(value) => {
            if (isStartupConfigMode(value)) {
              handleModeChange(value);
            }
          }}
          options={STARTUP_CONFIG_MODE_OPTIONS}
          helperText={modeHint}
        />
      </PanelSection>

      <PanelSection title="License">
        <InputField
          id="node-license"
          label="License File"
          value={data.license ?? ""}
          onChange={(value) => onChange({ license: value })}
          placeholder="Path to license file"
          helperText={inheritedFieldHint(props, "license")}
        />
      </PanelSection>

      <CredentialsSection {...props} />

      <PanelAddSection title="Bind Mounts" onAdd={handleAddBind}>
        <DynamicList
          items={data.binds ?? []}
          onChange={(items) => onChange({ binds: items })}
          placeholder="host:container[:options]"
          hideAddButton
          inheritedItems={inheritedListItems(props, "binds")}
          id="node-binds"
          magicVariables
        />
      </PanelAddSection>

      <PanelAddSection title="Environment Variables" onAdd={handleAddEnvVar}>
        <KeyValueList
          items={data.env ?? {}}
          onChange={(items) => onChange({ env: items })}
          keyPlaceholder="Variable"
          valuePlaceholder="Value"
          hideAddButton
          inheritedEntries={inheritedMapEntries(props, "env")}
        />
      </PanelAddSection>

      <PanelAddSection title="Environment Files" onAdd={handleAddEnvFile}>
        <DynamicList
          items={data.envFiles ?? []}
          onChange={(items) => onChange({ envFiles: items })}
          placeholder="Path to env file"
          hideAddButton
          inheritedItems={inheritedListItems(props, "envFiles")}
        />
      </PanelAddSection>

      <PanelAddSection title="Labels" onAdd={handleAddLabel}>
        <KeyValueList
          items={data.labels ?? {}}
          onChange={(items) => onChange({ labels: items })}
          keyPlaceholder="Label"
          valuePlaceholder="Value"
          hideAddButton
          inheritedEntries={inheritedMapEntries(props, "labels")}
        />
      </PanelAddSection>
    </Box>
  );
};
