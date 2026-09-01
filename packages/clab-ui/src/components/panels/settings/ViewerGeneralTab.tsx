// TopoViewer-level preferences; these persist locally rather than in the lab files.
import React from "react";
import { Box, Checkbox, Stack, Text } from "@mantine/core";

interface ViewerGeneralTabProps {
  autoOpenOnInteraction: boolean;
  onToggleAutoOpen: () => void;
}

export const ViewerGeneralTab: React.FC<ViewerGeneralTabProps> = ({
  autoOpenOnInteraction,
  onToggleAutoOpen
}) => (
  <Stack gap="lg" p="md">
    <Box>
      <Text size="sm" fw={600}>
        Auto-open palette on interaction
      </Text>
      <Checkbox
        mt={6}
        size="sm"
        checked={autoOpenOnInteraction}
        onChange={() => onToggleAutoOpen()}
        data-testid="settings-auto-open-palette"
        label={
          <Text size="sm" c="dimmed">
            Automatically open the palette panel when you interact with nodes or links.
          </Text>
        }
      />
    </Box>
  </Stack>
);
