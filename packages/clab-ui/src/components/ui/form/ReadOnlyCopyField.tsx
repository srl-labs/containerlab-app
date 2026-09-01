// Read-only text field with copy button.
import React, { useCallback } from "react";
import { ActionIcon, TextInput, Tooltip } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";

export interface ReadOnlyCopyFieldProps {
  label: string;
  value: string;
  mono?: boolean;
}

export const ReadOnlyCopyField: React.FC<ReadOnlyCopyFieldProps> = ({
  label,
  value,
  mono = false
}) => {
  const handleCopy = useCallback(() => {
    if (value) {
      window.navigator.clipboard.writeText(value).catch(() => {});
    }
  }, [value]);

  return (
    <TextInput
      label={label}
      value={value || "N/A"}
      readOnly
      styles={{
        input: {
          userSelect: "none",
          WebkitUserSelect: "none",
          caretColor: "transparent",
          cursor: "default",
          ...(mono ? { fontFamily: "monospace" } : undefined)
        }
      }}
      rightSection={
        value ? (
          <Tooltip label="Copy" withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={handleCopy} tabIndex={-1}>
              <IconCopy size={18} />
            </ActionIcon>
          </Tooltip>
        ) : undefined
      }
    />
  );
};
