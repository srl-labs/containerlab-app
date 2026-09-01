/**
 * Shared button components for dynamic list components
 */
import React from "react";
import { ActionIcon, Button } from "@mantine/core";
import { IconTrash, IconPlus } from "@tabler/icons-react";

interface DeleteItemButtonProps {
  onRemove: () => void;
  disabled?: boolean;
}

export const DeleteItemButton: React.FC<DeleteItemButtonProps> = ({ onRemove, disabled }) => (
  <ActionIcon
    variant="subtle"
    color="gray"
    onClick={onRemove}
    aria-label="Remove"
    disabled={disabled}
  >
    <IconTrash size={18} />
  </ActionIcon>
);

interface AddItemButtonProps {
  onAdd: () => void;
  label?: string;
  disabled?: boolean;
}

export const AddItemButton: React.FC<AddItemButtonProps> = ({ onAdd, label = "Add", disabled }) => (
  <Button
    variant="subtle"
    size="compact-sm"
    leftSection={<IconPlus size={18} />}
    onClick={onAdd}
    disabled={disabled}
  >
    {label}
  </Button>
);
