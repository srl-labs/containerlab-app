/**
 * Shared button components for dynamic list components
 */
import React from "react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import AddIcon from "@mui/icons-material/Add";
import LockIcon from "@mui/icons-material/LockOutlined";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";

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

interface InheritedItemMarkerProps {
  /** Where the entry comes from, e.g. "kind nokia_srlinux" */
  source: string;
}

/** Shown instead of the remove button on a row inherited from defaults, a kind or a group */
export const InheritedItemMarker: React.FC<InheritedItemMarkerProps> = ({ source }) => (
  <Tooltip title={`Inherited from ${source}. Remove it there.`}>
    <Box
      component="span"
      tabIndex={0}
      role="img"
      aria-label={`Inherited from ${source}`}
      data-testid="inherited-item-marker"
      sx={{
        // Same footprint as the remove button it replaces.
        width: 26,
        height: 26,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "text.secondary"
      }}
    >
      <LockIcon sx={{ fontSize: 15 }} />
    </Box>
  </Tooltip>
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
