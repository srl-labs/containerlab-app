/**
 * KeyValueList - Dynamic key-value pairs
 */
import React, { useRef } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";

import { AddItemButton, DeleteItemButton, InheritedItemMarker } from "./ListButtons";
import { createRowIds, nextRowId } from "./listRowIds";

type KeyValueScalar = string | number | boolean;

/**
 * Values may be numbers or booleans (e.g. sysctls read from YAML). Untouched
 * entries keep their type; an edited value is reported as the text typed in.
 */
interface KeyValueListProps<V extends KeyValueScalar = string> {
  items: Record<string, V>;
  onChange: (items: Record<string, V | string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  disabled?: boolean;
  hideAddButton?: boolean;
  /**
   * Keys inherited from defaults, a kind or a group: where each comes from and
   * its inherited value. The key is locked; changing the value overrides it.
   */
  inheritedEntries?: Record<string, { source: string; value: KeyValueScalar }>;
}

export const KeyValueList = <V extends KeyValueScalar = string>({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  addLabel = "Add",
  disabled,
  hideAddButton,
  inheritedEntries
}: KeyValueListProps<V>): React.ReactElement => {
  const entries = Object.entries(items);

  // Stable per-row identities so removing or renaming a row doesn't reassign
  // focus/state to its neighbor. Add/remove handlers keep the id list aligned
  // with the entries; an external length change (parent reset, key collision on
  // rename) regenerates all ids.
  const rowIdsRef = useRef<number[] | null>(null);
  if (rowIdsRef.current === null || rowIdsRef.current.length !== entries.length) {
    rowIdsRef.current = createRowIds(entries.length);
  }
  const rowIds = rowIdsRef.current;

  const handleAdd = () => {
    // Adding "" only grows the object when no empty key exists yet.
    if (!("" in items)) {
      rowIdsRef.current = [...rowIds, nextRowId()];
    }
    onChange({ ...items, "": "" });
  };

  const handleRemove = (key: string, index: number) => {
    rowIdsRef.current = rowIds.filter((_, i) => i !== index);
    const newItems = { ...items };
    delete newItems[key];
    onChange(newItems);
  };

  const handleKeyChange = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    const newItems: Record<string, V | string> = {};
    for (const [k, v] of Object.entries(items)) {
      newItems[k === oldKey ? newKey : k] = v;
    }
    onChange(newItems);
  };

  const handleValueChange = (key: string, value: string) => {
    onChange({ ...items, [key]: value });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {entries.map(([key, value], index) => (
        <KeyValueItem
          key={rowIds[index]}
          itemKey={key}
          value={String(value)}
          onKeyChange={(newKey) => handleKeyChange(key, newKey)}
          onValueChange={(val) => handleValueChange(key, val)}
          onRemove={() => handleRemove(key, index)}
          keyPlaceholder={keyPlaceholder}
          valuePlaceholder={valuePlaceholder}
          disabled={disabled}
          inherited={Object.hasOwn(inheritedEntries ?? {}, key) ? inheritedEntries?.[key] : undefined}
        />
      ))}
      {hideAddButton !== true && (
        <AddItemButton onAdd={handleAdd} label={addLabel} disabled={disabled} />
      )}
    </Box>
  );
};

/**
 * Single key-value item
 */
interface KeyValueItemProps {
  itemKey: string;
  value: string;
  onKeyChange: (key: string) => void;
  onValueChange: (value: string) => void;
  onRemove: () => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  disabled?: boolean;
  inherited?: { source: string; value: KeyValueScalar };
}

function describeInheritedValue(
  value: string,
  inherited: { source: string; value: KeyValueScalar }
): string {
  return value === String(inherited.value)
    ? `From ${inherited.source}`
    : `Overrides ${inherited.source}`;
}

const KeyValueItem: React.FC<KeyValueItemProps> = ({
  itemKey,
  value,
  onKeyChange,
  onValueChange,
  onRemove,
  keyPlaceholder,
  valuePlaceholder,
  disabled,
  inherited
}) => (
  <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
    <TextField
      value={itemKey}
      onChange={(e) => onKeyChange(e.target.value)}
      label={keyPlaceholder}
      disabled={disabled}
      size="small"
      slotProps={{ htmlInput: { readOnly: inherited !== undefined } }}
      sx={{
        width: "33%",
        ...(inherited !== undefined ? { "& input": { color: "text.secondary" } } : {})
      }}
    />
    <TextField
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      label={valuePlaceholder}
      disabled={disabled}
      size="small"
      helperText={inherited !== undefined ? describeInheritedValue(value, inherited) : undefined}
      sx={{ flex: 1 }}
    />
    {inherited !== undefined ? (
      <InheritedItemMarker source={inherited.source} />
    ) : (
      <DeleteItemButton onRemove={onRemove} disabled={disabled} />
    )}
  </Box>
);
