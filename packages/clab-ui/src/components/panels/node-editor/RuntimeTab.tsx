// Runtime tab for node editor.
import React from "react";
import Box from "@mui/material/Box";

import {
  InputField,
  SelectField,
  CheckboxField,
  DynamicList,
  PanelAddSection,
  PanelSection,
  RuntimeLimited
} from "../../ui/form";
import { useRuntimeLimit } from "../../../stores/labHostStore";

import type { TabProps } from "./types";
import { withCurrentOption } from "./selectOptions";
import { inheritedFieldHint, inheritedListItems } from "./inheritanceHints";

/** Restart policies a Kubernetes (c9s) lab host refuses. */
const C9S_REFUSED_RESTART_POLICIES = new Set(["no", "on-failure"]);

const RESTART_POLICY_OPTIONS = [
  { value: "", label: "Default" },
  { value: "no", label: "No" },
  { value: "always", label: "Always" },
  { value: "on-failure", label: "On Failure" },
  { value: "unless-stopped", label: "Unless Stopped" }
];

export const RuntimeTab: React.FC<TabProps> = (props) => {
  const { data, onChange } = props;
  const restartLimit = useRuntimeLimit("nodeRestartPolicy");
  const autoRemoveLimit = useRuntimeLimit("nodeAutoRemove");
  const execLimit = useRuntimeLimit("nodeExec");
  const restartOptions = withCurrentOption(RESTART_POLICY_OPTIONS, data.restartPolicy ?? "").map((option) =>
    restartLimit && C9S_REFUSED_RESTART_POLICIES.has(option.value) ? { ...option, disabled: true } : option
  );
  const handleAddExec = () => {
    onChange({ exec: [...(data.exec ?? []), ""] });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <PanelSection title="Container Settings">
        <InputField
          id="node-user"
          label="User"
          value={data.user ?? ""}
          onChange={(value) => onChange({ user: value })}
          placeholder="Container user"
          helperText={inheritedFieldHint(props, "user")}
        />
        <InputField
          id="node-entrypoint"
          label="Entrypoint"
          value={data.entrypoint ?? ""}
          onChange={(value) => onChange({ entrypoint: value })}
          placeholder="Container entrypoint"
          helperText={inheritedFieldHint(props, "entrypoint")}
        />
        <InputField
          id="node-cmd"
          label="Command"
          value={data.cmd ?? ""}
          onChange={(value) => onChange({ cmd: value })}
          placeholder="Container command"
          helperText={inheritedFieldHint(props, "cmd")}
        />
      </PanelSection>

      <PanelAddSection title="Exec Commands" onAdd={handleAddExec} limit={execLimit}>
        <DynamicList
          items={data.exec ?? []}
          onChange={(items) => onChange({ exec: items })}
          placeholder="Command to execute"
          hideAddButton
          inheritedItems={inheritedListItems(props, "exec")}
          id="node-exec"
          magicVariables
        />
      </PanelAddSection>

      <PanelSection title="Lifecycle">
        <InputField
          id="node-startup-delay"
          label="Startup Delay"
          type="number"
          value={String(data.startupDelay ?? "")}
          onChange={(value) => onChange({ startupDelay: value ? parseInt(value, 10) : undefined })}
          placeholder="0"
          min={0}
          suffix="seconds"
          helperText={inheritedFieldHint(props, "startupDelay")}
        />
        <RuntimeLimited limit={restartLimit}>
          <SelectField
            id="node-restart-policy"
            label="Restart Policy"
            value={data.restartPolicy ?? ""}
            onChange={(value) => onChange({ restartPolicy: value })}
            options={restartOptions}
            helperText={inheritedFieldHint(props, "restartPolicy")}
          />
        </RuntimeLimited>
        <RuntimeLimited limit={autoRemoveLimit} keepEditable={data.autoRemove === true}>
          <CheckboxField
            id="node-auto-remove"
            label="Auto-remove container on exit"
            checked={data.autoRemove ?? false}
            onChange={(checked) => onChange({ autoRemove: checked })}
          />
        </RuntimeLimited>
      </PanelSection>
    </Box>
  );
};
