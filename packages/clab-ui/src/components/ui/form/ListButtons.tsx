/**
 * Shared button components for dynamic list components
 */
import React from "react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import AddIcon from "@mui/icons-material/Add";

interface DeleteItemButtonProps {
  onRemove: () => void;
  disabled?: boolean;
}

export const DeleteItemButton: React.FC<DeleteItemButtonProps> = ({ onRemove, disabled }) => (
  <IconButton
    size="small"
    onClick={onRemove}
    aria-label="Remove"
    disabled={disabled}
    sx={{
      flexShrink: 0,
      "&:hover": {
        color: "error.main",
        bgcolor: "color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent)"
      }
    }}
  >
    <DeleteIcon sx={{ fontSize: 16 }} />
  </IconButton>
);

interface AddItemButtonProps {
  onAdd: () => void;
  label?: string;
  disabled?: boolean;
}

export const AddItemButton: React.FC<AddItemButtonProps> = ({ onAdd, label = "Add", disabled }) => (
  <Button
    variant="text"
    size="small"
    startIcon={<AddIcon />}
    onClick={onAdd}
    disabled={disabled}
    sx={{ alignSelf: "flex-start", ml: -1 }}
  >
    {label}
  </Button>
);
