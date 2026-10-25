// Inputs for node editor fields built from the containerlab schema (Kind and Other tabs).
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
  KindConfigItemField,
  KindConfigScalarControl
} from "../../../core/schema/KindSpecificConfig";
import { isRecord } from "../../../core/utilities/typeHelpers";

import { withCurrentOption } from "./selectOptions";

export type ListControl = Extract<KindConfigControl, { type: "stringList" | "objectList" }>;

const WHOLE_NUMBER = /^[-+]?\d+$/;
const CAPTION_SX = { color: "text.secondary", display: "block", mb: 1.5 } as const;

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

export const ScalarInput: React.FC<ScalarInputProps> = ({
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

/** Caption under a list section title: the inherited value or the description */
export const SectionCaption: React.FC<{ text?: string }> = ({ text }) =>
  text !== undefined ? (
    <Typography variant="caption" sx={CAPTION_SX}>
      {text}
    </Typography>
  ) : null;

interface ListFieldProps {
  /** Prefix of the element ids, e.g. `kind-config-breakouts` */
  id: string;
  label: string;
  control: ListControl;
  value: unknown;
  onChange: (value: unknown) => void;
  helperText?: string;
  /** Items inherited from defaults, a kind or a group, with where they come from */
  inheritedItems?: ReadonlyMap<string, string>;
}

/** A fixed set of choices, e.g. FRR daemons; none ticked means the key is not set. */
const OptionList: React.FC<ListFieldProps & { options: string[] }> = ({
  label,
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
    <PanelSection title={label}>
      <SectionCaption text={helperText} />
      <Box
        role="group"
        aria-label={label}
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
  id,
  label,
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
      title={label}
      onAdd={() => update([...rows, {}])}
    >
      <SectionCaption text={helperText} />
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {rows.map((row, index) => (
          <Box
            // Rows have no identity of their own; the values are controlled, so the index is enough
            key={index}
            data-testid={`${id}-row`}
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
                id={`${id}-${index}-${item.key}`}
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

const StringList: React.FC<ListFieldProps> = ({
  id,
  label,
  value,
  onChange,
  helperText,
  inheritedItems
}) => {
  const items = Array.isArray(value) ? value.map(toText) : [];
  return (
    <PanelAddSection
      title={label}
      onAdd={() => onChange([...items, ""])}
    >
      <SectionCaption text={helperText} />
      <Box data-testid={`${id}-items`}>
        <DynamicList
          items={items}
          onChange={(next) => onChange(next.length > 0 ? next : undefined)}
          hideAddButton
          inheritedItems={inheritedItems}
        />
      </Box>
    </PanelAddSection>
  );
};

export const ListField: React.FC<ListFieldProps> = (props) => {
  const { control } = props;
  if (control.type === "objectList") return <ObjectList {...props} fields={control.fields} />;
  if (control.options) return <OptionList {...props} options={control.options} />;
  return <StringList {...props} />;
};

export function isListControl(control: { type: string }): control is ListControl {
  return control.type === "stringList" || control.type === "objectList";
}
