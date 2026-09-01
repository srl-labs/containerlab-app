// Confirmation dialog for bulk link creation.
import React from "react";
import { Box, Button, Group, Modal, Text } from "@mantine/core";

interface ConfirmBulkLinksModalProps {
  isOpen: boolean;
  count: number;
  sourcePattern: string;
  targetPattern: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmBulkLinksModal: React.FC<ConfirmBulkLinksModalProps> = ({
  isOpen,
  count,
  sourcePattern,
  targetPattern,
  onCancel,
  onConfirm
}) => (
  <Modal opened={isOpen} onClose={onCancel} title="Bulk Link Creation" size="md" centered>
    <Box style={{ padding: 8, borderRadius: 4, border: "1px solid" }}>
      <Text size="sm">
        Create <strong>{count}</strong> new link{count === 1 ? "" : "s"}?
      </Text>
      <Box style={{ marginTop: 4 }}>
        <Text size="xs" c="dimmed">
          Source: <code className="select-text">{sourcePattern}</code>
        </Text>
        <br />
        <Text size="xs" c="dimmed">
          Target: <code className="select-text">{targetPattern}</code>
        </Text>
      </Box>
    </Box>
    <Group justify="flex-end" mt="md">
      <Button size="xs" variant="subtle" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="xs" variant="subtle" onClick={onConfirm}>
        Create Links
      </Button>
    </Group>
  </Modal>
);
