// Custom node template fields.
import React from "react";

import { missingTemplateFields } from "../../../core/utilities/customNodeConversions";
import { InputField } from "../../ui/form";

import type { TabProps } from "./types";

/**
 * Custom Node Template fields - shown only when editing custom node templates
 */
export const CustomNodeTemplateFields: React.FC<TabProps> = ({
  data,
  onChange,
  showRequiredErrors = false
}) => {
  const isMissingName = showRequiredErrors && missingTemplateFields(data).includes("customName");
  return (
    <>
      <InputField
        id="node-custom-name"
        label="Template name"
        value={data.customName ?? ""}
        onChange={(value) => onChange({ customName: value })}
        placeholder="Template name"
        required
        error={isMissingName}
        helperText={isMissingName ? "Give the template a name to save it" : undefined}
      />
      <InputField
        id="node-base-name"
        label="Base name (for canvas)"
        value={data.baseName ?? ""}
        onChange={(value) => onChange({ baseName: value })}
        placeholder="e.g., srl (becomes srl1, srl2, …)"
        helperText="Leave empty to name nodes after the template"
      />
      <InputField
        id="node-interface-pattern"
        label="Interface pattern"
        value={data.interfacePattern ?? ""}
        onChange={(value) => onChange({ interfacePattern: value })}
        placeholder="e.g., e1-{n} or Gi0/0/{n:0}"
      />
    </>
  );
};
