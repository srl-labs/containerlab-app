// Text or number input field.
import React from "react";
import { ActionIcon, NumberInput, Text, TextInput, Tooltip } from "@mantine/core";
import { IconInfoCircle, IconX } from "@tabler/icons-react";

interface InputFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  type?: "text" | "number";
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  helperText?: string;
  tooltip?: string;
  required?: boolean;
  error?: boolean;
  /** Fixed text suffix shown inside the input (e.g. "seconds") */
  suffix?: string;
  /** Show a clear (×) button when the field has a value */
  clearable?: boolean;
}

const hasContent = (value?: string): boolean => value !== undefined && value.length > 0;

export const InputField: React.FC<InputFieldProps> = ({
  id,
  value,
  onChange,
  label,
  placeholder,
  type = "text",
  min,
  max,
  step,
  disabled,
  helperText,
  tooltip,
  required,
  error,
  suffix,
  clearable
}) => {
  const isNumberField = type === "number";
  const canInteract = disabled !== true;
  const showClear = clearable === true && value.length > 0 && canInteract;
  const hasTooltip = hasContent(tooltip);
  const hasSuffix = hasContent(suffix);

  const rightSectionItems: React.ReactNode[] = [];
  // Text fields render the suffix as a static adornment; number fields use the
  // built-in NumberInput suffix so the stepper controls remain visible.
  if (hasSuffix && !isNumberField) {
    rightSectionItems.push(
      <Text key="suffix" size="sm" c="dimmed">
        {suffix}
      </Text>
    );
  }
  if (showClear) {
    rightSectionItems.push(
      <ActionIcon
        key="clear"
        variant="subtle"
        color="gray"
        size="sm"
        tabIndex={-1}
        onClick={() => onChange("")}
        aria-label="Clear"
      >
        <IconX size={18} />
      </ActionIcon>
    );
  }
  if (hasTooltip) {
    rightSectionItems.push(
      <Tooltip key="tooltip" label={tooltip} withArrow>
        <ActionIcon variant="subtle" color="gray" size="sm" tabIndex={-1} aria-label="Info">
          <IconInfoCircle size={16} />
        </ActionIcon>
      </Tooltip>
    );
  }

  const hasRightSection = rightSectionItems.length > 0;
  const rightSection = hasRightSection ? (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>{rightSectionItems}</div>
  ) : undefined;
  const rightSectionWidth = hasRightSection ? rightSectionItems.length * 30 + 8 : undefined;

  if (isNumberField) {
    return (
      <NumberInput
        id={id}
        value={value}
        onChange={(val) => onChange(val === "" ? "" : String(val))}
        label={label}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        error={error}
        description={helperText}
        min={min}
        max={max}
        step={step}
        clampBehavior="strict"
        suffix={hasSuffix ? ` ${suffix}` : undefined}
        rightSection={rightSection}
        rightSectionWidth={rightSectionWidth}
        rightSectionPointerEvents="all"
      />
    );
  }

  return (
    <TextInput
      id={id}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      label={label}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      error={error}
      description={helperText}
      rightSection={rightSection}
      rightSectionWidth={rightSectionWidth}
      rightSectionPointerEvents="all"
    />
  );
};
