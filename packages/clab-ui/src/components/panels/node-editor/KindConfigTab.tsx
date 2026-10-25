// Kind tab for node editor: kind-specific config keys, with fields built from the schema.
import React from "react";
import Box from "@mui/material/Box";

import { PanelSection } from "../../ui/form";
import type {
  KindConfigField,
  KindConfigScalarControl
} from "../../../core/schema/KindSpecificConfig";
import {
  kindConfigFormFields,
  kindsAcceptingKey
} from "../../../core/utilities/nodeKindConfig";
import {
  convertSingleComponent,
  parseComponent
} from "../../../core/utilities/nodeEditorConversions";
import { isRecord } from "../../../core/utilities/typeHelpers";

import type { NodeEditorData, TabProps } from "./types";
import { inheritedFieldHint, inheritedKindConfigHint } from "./inheritanceHints";
import { ListField, ScalarInput, isListControl, type ListControl } from "./SchemaFieldInputs";

/** The kind the tab shows fields for; none for topology defaults or a group without a kind. */
function formKind(data: NodeEditorData): string | undefined {
  const kind = data.kind?.trim();
  return kind === undefined || kind === "" ? undefined : kind;
}

/** Fields the Kind tab shows for this node, section or template. */
export function getKindConfigFields(data: NodeEditorData): KindConfigField[] {
  return kindConfigFormFields(formKind(data));
}

// `components` and `sfm` keep their own editor fields; every other key lives in kindConfig.
function readValue(data: NodeEditorData, key: string): unknown {
  if (key === "sfm") return data.sfm;
  if (key === "components") {
    return data.components?.map((component) => convertSingleComponent(component) ?? {});
  }
  return data.kindConfig?.[key];
}

function writeValue(data: NodeEditorData, key: string, value: unknown): Partial<NodeEditorData> {
  if (key === "sfm") return { sfm: typeof value === "string" ? value : undefined };
  if (key === "components") {
    return {
      components: Array.isArray(value) ? value.filter(isRecord).map(parseComponent) : undefined
    };
  }
  const next = { ...data.kindConfig };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return { kindConfig: Object.keys(next).length > 0 ? next : undefined };
}

function fieldHint(props: TabProps, key: string): string | undefined {
  if (key === "sfm" || key === "components") return inheritedFieldHint(props, key);
  return inheritedKindConfigHint(props, key);
}

/** Inherited value or description, plus the kinds a key belongs to when no kind is set. */
function helperFor(props: TabProps, field: KindConfigField): string | undefined {
  const hint = fieldHint(props, field.key);
  if (hint !== undefined) return hint;
  if (formKind(props.data) !== undefined) return field.description;
  const kinds = `Only for ${kindsAcceptingKey(field.key)}.`;
  return field.description !== undefined ? `${field.description} ${kinds}` : kinds;
}

export const KindConfigTab: React.FC<TabProps> = (props) => {
  const { data, onChange } = props;
  const fields = getKindConfigFields(data);
  const kind = formKind(data);
  const set = (key: string, value: unknown) => onChange(writeValue(data, key, value));
  const scalars: Array<{ field: KindConfigField; control: KindConfigScalarControl }> = [];
  const lists: Array<{ field: KindConfigField; control: ListControl }> = [];
  for (const field of fields) {
    const { control } = field;
    if (control === undefined) continue;
    if (isListControl(control)) lists.push({ field, control });
    else scalars.push({ field, control });
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      {scalars.length > 0 && (
        <PanelSection title={kind !== undefined ? `${kind} Settings` : "Kind-Specific Settings"}>
          {scalars.map(({ field, control }) => (
            <ScalarInput
              key={field.key}
              id={`kind-config-${field.key}`}
              label={field.label}
              control={control}
              value={readValue(data, field.key)}
              onChange={(value) => set(field.key, value)}
              helperText={helperFor(props, field)}
            />
          ))}
        </PanelSection>
      )}
      {lists.map(({ field, control }) => (
        <ListField
          key={field.key}
          id={`kind-config-${field.key}`}
          label={field.label}
          control={control}
          value={readValue(data, field.key)}
          onChange={(value) => set(field.key, value)}
          helperText={helperFor(props, field)}
        />
      ))}
    </Box>
  );
};
