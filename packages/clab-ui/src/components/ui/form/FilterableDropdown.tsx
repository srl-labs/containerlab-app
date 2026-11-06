// Searchable dropdown with keyboard navigation.
import React, { useState } from "react";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";

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
  error?: boolean;
  /** Show the dropdown arrow on a field that also takes free text */
  showArrow?: boolean;
  /** Names a field that shows no label */
  ariaLabel?: string;
}

const filterByInput = createFilterOptions<FilterableDropdownOption>();

export const FilterableDropdown: React.FC<FilterableDropdownProps> = ({
  id,
  options,
  value,
  onChange,
  label,
  placeholder = "Type to filter…",
  allowFreeText = false,
  disabled = false,
  renderOption,
  helperText,
  required,
  error,
  showArrow = false,
  ariaLabel
}) => {
  const selectedOption = options.find((opt) => opt.value === value) ?? null;
  // Opening shows every option; only what is typed after that narrows them. Otherwise a
  // free-text value that matches nothing would open an empty list.
  const [isTyping, setIsTyping] = useState(false);

  return (
    <Autocomplete
      id={id}
      options={options}
      value={selectedOption}
      onChange={(_event, newValue) => {
        if (newValue !== null) {
          onChange(typeof newValue === "string" ? newValue : newValue.value);
        } else {
          onChange("");
        }
      }}
      onInputChange={(_event, newInputValue, reason) => {
        if (reason === "input") setIsTyping(true);
        if (allowFreeText && reason === "input") {
          onChange(newInputValue);
        }
      }}
      onClose={() => setIsTyping(false)}
      filterOptions={(all, state) => (isTyping ? filterByInput(all, state) : all)}
      forcePopupIcon={showArrow ? true : "auto"}
      inputValue={allowFreeText ? value : undefined}
      getOptionLabel={(option) => {
        if (typeof option === "string") return option;
        return option.label;
      }}
      isOptionEqualToValue={(option, val) =>
        option.value === (typeof val === "string" ? val : val.value)
      }
      freeSolo={allowFreeText}
      disabled={disabled}
      size="small"
      fullWidth
      renderOption={
        renderOption
          ? (props, option) => {
              const { key, ...otherProps } = props as React.HTMLAttributes<HTMLLIElement> & {
                key: React.Key;
              };
              return (
                <Box component="li" key={key} {...otherProps}>
                  {renderOption(option)}
                </Box>
              );
            }
          : undefined
      }
      renderInput={(params) => (
        <TextField
          {...(params as unknown as React.ComponentProps<typeof TextField>)}
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, "aria-label": ariaLabel }
          }}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          required={required}
          error={error}
        />
      )}
      slotProps={{
        listbox: {
          sx: { maxHeight: 200 }
        }
      }}
    />
  );
};
