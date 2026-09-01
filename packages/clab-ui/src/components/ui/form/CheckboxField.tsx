/**
 * CheckboxField - Checkbox with label (Mantine)
 */
import React from "react";
import { Checkbox } from "@mantine/core";

interface CheckboxFieldProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
}

export const CheckboxField: React.FC<CheckboxFieldProps> = ({
  id,
  label,
  checked,
  onChange,
  className,
  disabled
}) => (
  <Checkbox
    id={id}
    className={className}
    label={label}
    checked={checked}
    disabled={disabled}
    size="sm"
    onChange={(event) => onChange(event.currentTarget.checked)}
  />
);
