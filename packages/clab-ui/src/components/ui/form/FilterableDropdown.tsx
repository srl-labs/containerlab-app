// Searchable dropdown with keyboard navigation.
import React from "react";
import { Autocomplete, Select } from "@mantine/core";

interface FilterableDropdownOption {
  value: string;
  label: string;
}

interface FilterableDropdownProps {
  id: string;
  options: FilterableDropdownOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  allowFreeText?: boolean;
  className?: string;
  disabled?: boolean;
  renderOption?: (option: FilterableDropdownOption) => React.ReactNode;
  menuClassName?: string;
  helperText?: string;
  required?: boolean;
}

export const FilterableDropdown: React.FC<FilterableDropdownProps> = ({
  id,
  options,
  value,
  onChange,
  label,
  placeholder = "Type to filter...",
  allowFreeText = false,
  disabled = false,
  renderOption,
  helperText,
  required
}) => {
  const data = options.map((opt) => ({ value: opt.value, label: opt.label }));
  const mantineRenderOption = renderOption
    ? ({ option }: { option: { value: string; label?: string } }) =>
        renderOption({ value: option.value, label: option.label ?? option.value })
    : undefined;

  if (allowFreeText) {
    return (
      <Autocomplete
        id={id}
        data={data}
        value={value}
        onChange={onChange}
        label={label}
        placeholder={placeholder}
        description={helperText}
        required={required}
        disabled={disabled}
        renderOption={mantineRenderOption}
        maxDropdownHeight={200}
      />
    );
  }

  return (
    <Select
      id={id}
      data={data}
      value={value.length > 0 ? value : null}
      onChange={(newValue) => onChange(newValue ?? "")}
      label={label}
      placeholder={placeholder}
      description={helperText}
      required={required}
      disabled={disabled}
      searchable
      renderOption={mantineRenderOption}
      maxDropdownHeight={200}
    />
  );
};
