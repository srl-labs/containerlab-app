// Other tab for node editor: node keys without a form of their own, with fields built from the schema.
import React, { useState } from "react";
import Box from "@mui/material/Box";

import { KeyValueList, PanelAddSection, PanelSection } from "../../ui/form";
import { deepEqual } from "../../../core/io/YamlDocumentIO";
import type { KindConfigScalarControl } from "../../../core/schema/KindSpecificConfig";
import type { NodeConfigControl, NodeConfigField } from "../../../core/schema/NodeConfigFields";
import {
  OTHER_CONFIG_FIELDS,
  formatYamlValue,
  parseYamlValue,
  readConfigPath,
  writeConfigPath
} from "../../../core/utilities/nodeOtherConfig";
import { isRecord } from "../../../core/utilities/typeHelpers";

import type { TabProps } from "./types";
import { inheritedKeyItems, inheritedPathEntries, inheritedPathHint } from "./inheritanceHints";
import {
  ListField,
  ScalarInput,
  SectionCaption,
  isListControl,
  type ListControl
} from "./SchemaFieldInputs";

type MapControl = Extract<NodeConfigControl, { type: "map" }>;

function fieldId(field: NodeConfigField): string {
  return `other-config-${field.path.join("-")}`;
}

/** A map value as its row shows it: text as written, other values as one line of YAML */
function mapText(control: MapControl, value: unknown): string {
  if (control.values === "text" && typeof value === "string") return value;
  return formatYamlValue(value);
}

function mapRows(control: MapControl, value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, mapText(control, entry)])
  );
}

/** Rows back to map values; an entry whose text did not change keeps its value and type */
function mapFromRows(
  control: MapControl,
  rows: Record<string, string>,
  previous: unknown
): Record<string, unknown> {
  const before = isRecord(previous) ? previous : {};
  return Object.fromEntries(
    Object.entries(rows).map(([key, text]) => {
      if (Object.hasOwn(before, key) && mapText(control, before[key]) === text) {
        return [key, before[key]];
      }
      return [key, control.values === "yaml" ? parseYamlValue(text) : text];
    })
  );
}

interface MapFieldProps {
  field: NodeConfigField;
  control: MapControl;
  value: unknown;
  onChange: (value: unknown) => void;
  inheritedEntries?: Record<string, { source: string; value: string }>;
}

const MapField: React.FC<MapFieldProps> = ({
  field,
  control,
  value,
  onChange,
  inheritedEntries
}) => {
  // Keep the text as typed while it is not valid YAML yet, e.g. `[2,`
  const [draft, setDraft] = useState<{ value: unknown; rows: Record<string, string> } | null>(
    null
  );
  const rows = draft && deepEqual(draft.value, value) ? draft.rows : mapRows(control, value);
  const change = (next: Record<string, string>) => {
    const parsed = mapFromRows(control, next, value);
    setDraft({ value: parsed, rows: next });
    onChange(Object.keys(parsed).length > 0 ? parsed : undefined);
  };
  return (
    <PanelAddSection title={field.label} onAdd={() => change({ ...rows, "": "" })}>
      <SectionCaption text={field.description} />
      <Box data-testid={`${fieldId(field)}-entries`}>
        <KeyValueList
          items={rows}
          onChange={change}
          hideAddButton
          inheritedEntries={inheritedEntries}
        />
      </Box>
    </PanelAddSection>
  );
};

export const OtherConfigTab: React.FC<TabProps> = (props) => {
  const { data, onChange } = props;
  const read = (field: NodeConfigField) => readConfigPath(data.otherConfig, field.path);
  const set = (field: NodeConfigField, value: unknown) =>
    onChange({ otherConfig: writeConfigPath(data.otherConfig, field.path, value) });
  const scalars: Array<{ field: NodeConfigField; control: KindConfigScalarControl }> = [];
  const lists: Array<{ field: NodeConfigField; control: ListControl }> = [];
  const maps: Array<{ field: NodeConfigField; control: MapControl }> = [];
  for (const field of OTHER_CONFIG_FIELDS) {
    const { control } = field;
    if (control.type === "map") maps.push({ field, control });
    else if (isListControl(control)) lists.push({ field, control });
    else scalars.push({ field, control });
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      {scalars.length > 0 && (
        <PanelSection title="Settings">
          {scalars.map(({ field, control }) => (
            <ScalarInput
              key={fieldId(field)}
              id={fieldId(field)}
              label={field.label}
              control={control}
              value={read(field)}
              onChange={(value) => set(field, value)}
              helperText={inheritedPathHint(props, field.path) ?? field.description}
            />
          ))}
        </PanelSection>
      )}
      {lists.map(({ field, control }) => (
        <ListField
          key={fieldId(field)}
          id={fieldId(field)}
          label={field.label}
          control={control}
          value={read(field)}
          onChange={(value) => set(field, value)}
          helperText={field.description}
          inheritedItems={
            field.path.length === 1 ? inheritedKeyItems(props, field.path[0]) : undefined
          }
        />
      ))}
      {maps.map(({ field, control }) => (
        <MapField
          key={fieldId(field)}
          field={field}
          control={control}
          value={read(field)}
          onChange={(value) => set(field, value)}
          inheritedEntries={inheritedPathEntries(props, field.path, (value) =>
            mapText(control, value)
          )}
        />
      ))}
    </Box>
  );
};
