import React from "react";
import { Box, Text } from "@mantine/core";

interface PanelEmptyStateProps {
  icon: React.ReactNode;
  message: string;
}

export const PanelEmptyState: React.FC<PanelEmptyStateProps> = ({ icon, message }) => (
  <Box
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      gap: 16,
      color: "var(--mantine-color-dimmed)",
      padding: 32
    }}
  >
    {icon}
    <Text size="sm" c="dimmed" ta="center">
      {message}
    </Text>
  </Box>
);
