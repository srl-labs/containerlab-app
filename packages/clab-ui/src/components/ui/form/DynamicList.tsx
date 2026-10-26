/**
 * DynamicList - Array of string inputs with add/remove
 */
import React, { useRef } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";

import { useFieldVariablePreview, useMagicVariableAutocomplete } from "./FieldVariables";
import { combineHelperText } from "./InputField";
import { AddItemButton, DeleteItemButton, InheritedItemMarker } from "./ListButtons";
import { createRowIds, nextRowId } from "./listRowIds";

interface DynamicListProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  disabled?: boolean;
  hideAddButton?: boolean;
  /** Items inherited from defaults, a kind or a group, with where they come from; shown locked */
  inheritedItems?: ReadonlyMap<string, string>;
  /** Prefix of the item ids, `<id>-<index>` */
  id?: string;
  /** containerlab expands magic variables such as `__clabNodeDir__` in the items */
  magicVariables?: boolean;
  /** An extra control beside an item, such as a button that opens the file it names */
  renderItemAction?: (item: string) => React.ReactNode;
}

export const DynamicList: React.FC<DynamicListProps> = ({
  items,
  onChange,
  placeholder,
  addLabel = "Add",
  disabled,
  hideAddButton,
  inheritedItems,
  id,
  magicVariables,
  renderItemAction
}) => {
  // Stable per-row identities so removing a row doesn't reassign focus/state to
  // its neighbor. Add/remove handlers keep the id list aligned with the items
  // array; an external length change (parent reset) regenerates all ids.
  const rowIdsRef = useRef<number[] | null>(null);
  if (rowIdsRef.current === null || rowIdsRef.current.length !== items.length) {
    rowIdsRef.current = createRowIds(items.length);
  }
  const rowIds = rowIdsRef.current;

  const handleAdd = () => {
    rowIdsRef.current = [...rowIds, nextRowId()];
    onChange([...items, ""]);
  };

  const handleRemove = (index: number) => {
    rowIdsRef.current = rowIds.filter((_, i) => i !== index);
    onChange(items.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, value: string) => {
    const newItems = [...items];
    newItems[index] = value;
    onChange(newItems);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {items.map((item, index) => (
        <DynamicListItem
          key={rowIds[index]}
          id={id ? `${id}-${index}` : undefined}
          magicVariables={magicVariables}
          value={item}
          onChange={(value) => handleChange(index, value)}
          onRemove={() => handleRemove(index)}
          placeholder={placeholder}
          disabled={disabled}
          inheritedFrom={inheritedItems?.get(item)}
          action={renderItemAction?.(item)}
        />
      ))}
      {hideAddButton !== true && (
        <AddItemButton onAdd={handleAdd} label={addLabel} disabled={disabled} />
      )}
    </Box>
  );
};

/**
 * Single list item with input and delete button
 */
interface DynamicListItemProps {
  id?: string;
  magicVariables?: boolean;
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  placeholder?: string;
  disabled?: boolean;
  inheritedFrom?: string;
  action?: React.ReactNode;
}

const DynamicListItem: React.FC<DynamicListItemProps> = ({
  id,
  magicVariables,
  value,
  onChange,
  onRemove,
  placeholder,
  disabled,
  inheritedFrom,
  action
}) => {
  const readOnly = inheritedFrom !== undefined;
  const variablePreview = useFieldVariablePreview(value, magicVariables === true);
  const autocomplete = useMagicVariableAutocomplete({
    enabled: magicVariables === true && disabled !== true && !readOnly,
    id: id ?? "list-item",
    value,
    onChange
  });
  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: variablePreview ? "flex-start" : "center" }}>
      <TextField
        id={id}
        inputRef={autocomplete.inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        size="small"
        fullWidth
        helperText={combineHelperText(id, undefined, variablePreview)}
        slotProps={{
          htmlInput: {
            readOnly,
            onKeyDown: autocomplete.onKeyDown,
            onSelect: autocomplete.onSelect,
            onBlur: autocomplete.onBlur
          }
        }}
        sx={readOnly ? { "& input": { color: "text.secondary" } } : undefined}
      />
      {autocomplete.suggestions}
      {action}
      {inheritedFrom !== undefined ? (
        <InheritedItemMarker source={inheritedFrom} />
      ) : (
        <DeleteItemButton onRemove={onRemove} disabled={disabled} />
      )}
    </Box>
  );
};
