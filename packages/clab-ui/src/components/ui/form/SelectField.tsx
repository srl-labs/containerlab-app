/**
 * SelectField - Dropdown select (Mantine)
 */
import React from "react";
import { Group, Select } from "@mantine/core";

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface SelectFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  helperText?: string;
  required?: boolean;
  clearable?: boolean;
}

export const SelectField: React.FC<SelectFieldProps> = ({
  id,
  value,
  onChange,
  options,
  label,
  placeholder,
  className,
  disabled,
  helperText,
  required,
  clearable
}) => {
  const hasIcons = options.some((opt) => opt.icon !== undefined && opt.icon !== null);
  const selectedIcon = options.find((opt) => opt.value === value)?.icon;

  return (
    <Select
      id={id}
      className={className}
      label={label}
      placeholder={placeholder}
      value={value.length > 0 ? value : null}
      onChange={(next) => onChange(next ?? "")}
      data={options.map((opt) => ({ value: opt.value, label: opt.label }))}
      disabled={disabled}
      required={required}
      clearable={clearable}
      description={helperText !== undefined && helperText.length > 0 ? helperText : undefined}
      leftSection={hasIcons ? selectedIcon : undefined}
      size="sm"
      comboboxProps={{ withinPortal: true }}
      renderOption={
        hasIcons
          ? ({ option }) => {
              const icon = options.find((opt) => opt.value === option.value)?.icon;
              return (
                <Group gap="xs" wrap="nowrap">
                  {icon}
                  <span>{option.label}</span>
                </Group>
              );
            }
          : undefined
      }
    />
  );
};
