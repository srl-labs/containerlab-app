// Read-only text field with copy button.
import React, { useCallback } from "react";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";

import { MONO_FONT_FAMILY } from "../../../theme/typography";

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
    <TextField
      label={label}
      value={value || "N/A"}
      size="small"
      fullWidth
      slotProps={{
        input: {
          readOnly: true,
          endAdornment: value ? (
            <InputAdornment position="end">
              <Tooltip title="Copy">
                <IconButton size="small" onClick={handleCopy} edge="end" tabIndex={-1}>
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : undefined,
          sx: {
            userSelect: "none",
            WebkitUserSelect: "none",
            caretColor: "transparent",
            cursor: "default",
            ...(mono ? { fontFamily: MONO_FONT_FAMILY, fontSize: 12 } : undefined)
          }
        }
      }}
    />
  );
};
