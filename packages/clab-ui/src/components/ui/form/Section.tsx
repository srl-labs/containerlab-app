// Bordered section with title and optional inheritance badge.
import React from "react";
import { Box, Divider, Text } from "@mantine/core";

import { InheritanceBadge } from "./Badge";

interface SectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  hasBorder?: boolean;
  /** When true, shows an "inherited" badge indicating the values come from defaults/kinds/groups */
  inherited?: boolean;
}

export const Section: React.FC<SectionProps> = ({
  title,
  children,
  hasBorder = true,
  inherited
}) => (
  <>
    <Box>
      <Box style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Text size="xs" tt="uppercase" c="dimmed" style={{ letterSpacing: "0.08em" }}>
          {title}
        </Text>
        {inherited === true && <InheritanceBadge />}
      </Box>
      {children}
    </Box>
    {hasBorder && <Divider my={12} />}
  </>
);
