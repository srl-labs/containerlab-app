import React from "react";
import { ActionIcon, Button, Group, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";

interface DialogTitleWithCloseProps {
  title: React.ReactNode;
  onClose: () => void;
  /** Optional data-testid applied to the close button */
  closeButtonTestId?: string;
  /** Optional style overrides merged onto the default title styling */
  sx?: React.CSSProperties;
}

export const DialogTitleWithClose: React.FC<DialogTitleWithCloseProps> = ({
  title,
  onClose,
  closeButtonTestId,
  sx
}) => (
  <Group justify="space-between" align="center" style={{ paddingTop: 12, paddingBottom: 12, ...sx }}>
    <Text fw={600}>{title}</Text>
    <ActionIcon variant="subtle" color="gray" onClick={onClose} data-testid={closeButtonTestId}>
      <IconX size={18} />
    </ActionIcon>
  </Group>
);

interface DialogCancelSaveActionsProps {
  onCancel: () => void;
  onSave: () => void;
  cancelLabel?: string;
  saveLabel?: string;
  disableSave?: boolean;
}

export const DialogCancelSaveActions: React.FC<DialogCancelSaveActionsProps> = ({
  onCancel,
  onSave,
  cancelLabel = "Cancel",
  saveLabel = "Save",
  disableSave = false
}) => (
  <Group justify="flex-end" gap="sm">
    <Button variant="subtle" size="compact-sm" onClick={onCancel}>
      {cancelLabel}
    </Button>
    <Button size="compact-sm" onClick={onSave} disabled={disableSave}>
      {saveLabel}
    </Button>
  </Group>
);
