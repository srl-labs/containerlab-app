// Kind tab for node editor: kind-specific config keys, with fields built from the schema.
import React from "react";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";

import {
  DynamicList,
  InputField,
  PanelAddSection,
  PanelSection,
  SelectField
} from "../../ui/form";
import { DeleteItemButton } from "../../ui/form/ListButtons";
import type {
  KindConfigControl,
  KindConfigField,
  KindConfigItemField,
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
import { withCurrentOption } from "./selectOptions";

type ListControl = Extract<KindConfigControl, { type: "stringList" | "objectList" }>;

const WHOLE_NUMBER = /^[-+]?\d+$/;
const CAPTION_SX = { color: "text.secondary", display: "block", mb: 1.5 } as const;

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

function toText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

/** Text typed into a field, converted to the YAML value its control expects. */
function parseScalar(control: KindConfigScalarControl, text: string): unknown {
  if (text.trim() === "") return undefined;
  switch (control.type) {
    case "integer": {
      const num = Number(text);
      return Number.isFinite(num) ? Math.trunc(num) : text;
    }
    case "integerOrString":
      return WHOLE_NUMBER.test(text.trim()) ? Number(text.trim()) : text;
    case "boolean":
      return text === "true";
    case "enum":
      return control.options.find((option) => String(option) === text) ?? text;
    case "string":
      return text;
  }
}

function booleanOptions(control: Extract<KindConfigScalarControl, { type: "boolean" }>) {
  let fallback = "Not set";
  if (control.defaultValue !== undefined) {
    fallback = `Default (${control.defaultValue ? "enabled" : "disabled"})`;
  }
  return [
    { value: "", label: fallback },
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" }
  ];
}

interface ScalarInputProps {
  id: string;
  label: string;
  control: KindConfigScalarControl;
  value: unknown;
  onChange: (value: unknown) => void;
  helperText?: string;
  required?: boolean;
}

const ScalarInput: React.FC<ScalarInputProps> = ({
  id,
  label,
  control,
  value,
  onChange,
  helperText,
  required
}) => {
  const text = toText(value);
  const change = (next: string) => onChange(parseScalar(control, next));
  if (control.type === "boolean") {
    return (
      <SelectField
        id={id}
        label={label}
        value={text}
        onChange={change}
        options={booleanOptions(control)}
        helperText={helperText}
      />
    );
  }
  if (control.type === "enum") {
    const options = control.options.map((option) => ({
      value: String(option),
      label: String(option)
    }));
    return (
      <SelectField
        id={id}
        label={label}
        value={text}
        onChange={change}
        options={withCurrentOption(
          required === true ? options : [{ value: "", label: "Not set" }, ...options],
          text
        )}
        helperText={helperText}
        required={required}
      />
    );
  }
  const isInteger = control.type === "integer";
  return (
    <InputField
      id={id}
      label={label}
      value={text}
      onChange={change}
      type={isInteger ? "number" : "text"}
      min={isInteger ? control.minimum : undefined}
      max={isInteger ? control.maximum : undefined}
      placeholder={control.type === "string" ? control.defaultValue : undefined}
      helperText={helperText}
      required={required}
    />
  );
};

interface ListFieldProps {
  field: KindConfigField;
  control: ListControl;
  value: unknown;
  onChange: (value: unknown) => void;
  helperText?: string;
}

/** A fixed set of choices, e.g. FRR daemons; none ticked means the key is not set. */
const OptionList: React.FC<ListFieldProps & { options: string[] }> = ({
  field,
  options,
  value,
  onChange,
  helperText
}) => {
  const selected = Array.isArray(value) ? value.map(toText) : [];
  const toggle = (option: string, checked: boolean) => {
    const next = checked
      ? options.filter((entry) => entry === option || selected.includes(entry))
      : selected.filter((entry) => entry !== option);
    // Keep values the schema does not list, so nothing typed in YAML is lost
    const unknown = selected.filter((entry) => !options.includes(entry));
    onChange(next.length + unknown.length > 0 ? [...next, ...unknown] : undefined);
  };
  return (
    <PanelSection title={field.label}>
      {helperText !== undefined && (
        <Typography variant="caption" sx={CAPTION_SX}>
          {helperText}
        </Typography>
      )}
      <Box
        role="group"
        aria-label={field.label}
        sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}
      >
        {options.map((option) => (
          <FormControlLabel
            key={option}
            label={option}
            control={
              <Checkbox
                size="small"
                checked={selected.includes(option)}
                onChange={(event) => toggle(option, event.target.checked)}
              />
            }
          />
        ))}
      </Box>
    </PanelSection>
  );
};

function objectRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map((item) => (isRecord(item) ? item : {})) : [];
}

const ObjectList: React.FC<ListFieldProps & { fields: KindConfigItemField[] }> = ({
  field,
  fields,
  value,
  onChange,
  helperText
}) => {
  const rows = objectRows(value);
  const update = (next: Array<Record<string, unknown>>) =>
    onChange(next.length > 0 ? next : undefined);
  const setCell = (index: number, key: string, cell: unknown) => {
    update(
      rows.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row };
        if (cell === undefined) delete next[key];
        else next[key] = cell;
        return next;
      })
    );
  };
  return (
    <PanelAddSection
      title={field.label}
      onAdd={() => update([...rows, {}])}
    >
      {helperText !== undefined && (
        <Typography variant="caption" sx={CAPTION_SX}>
          {helperText}
        </Typography>
      )}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {rows.map((row, index) => (
          <Box
            // Rows have no identity of their own; the values are controlled, so the index is enough
            key={index}
            data-testid={`kind-config-${field.key}-row`}
            sx={{
              display: "grid",
              gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr)) auto`,
              gap: 1.5,
              alignItems: "center"
            }}
          >
            {fields.map((item) => (
              <ScalarInput
                key={item.key}
                id={`kind-config-${field.key}-${index}-${item.key}`}
                label={item.label}
                control={item.control}
                value={row[item.key]}
                onChange={(cell) => setCell(index, item.key, cell)}
                required={item.required}
              />
            ))}
            <DeleteItemButton onRemove={() => update(rows.filter((_, i) => i !== index))} />
          </Box>
        ))}
      </Box>
    </PanelAddSection>
  );
};

const StringList: React.FC<ListFieldProps> = ({ field, value, onChange, helperText }) => {
  const items = Array.isArray(value) ? value.map(toText) : [];
  return (
    <PanelAddSection
      title={field.label}
      onAdd={() => onChange([...items, ""])}
    >
      {helperText !== undefined && (
        <Typography variant="caption" sx={CAPTION_SX}>
          {helperText}
        </Typography>
      )}
      <DynamicList
        items={items}
        onChange={(next) => onChange(next.length > 0 ? next : undefined)}
        hideAddButton
      />
    </PanelAddSection>
  );
};

const ListField: React.FC<ListFieldProps> = (props) => {
  const { control } = props;
  if (control.type === "objectList") return <ObjectList {...props} fields={control.fields} />;
  if (control.options) return <OptionList {...props} options={control.options} />;
  return <StringList {...props} />;
};

function isListControl(control: KindConfigControl): control is ListControl {
  return control.type === "stringList" || control.type === "objectList";
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
          field={field}
          control={control}
          value={readValue(data, field.key)}
          onChange={(value) => set(field.key, value)}
          helperText={helperFor(props, field)}
        />
      ))}
    </Box>
  );
};
