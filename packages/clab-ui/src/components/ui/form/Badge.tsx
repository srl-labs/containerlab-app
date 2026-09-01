// Badge components for form fields.
import React from "react";
import { Badge, Box } from "@mantine/core";

/**
 * Inheritance badge - shown when a field value comes from defaults, kinds, or groups
 */
export const InheritanceBadge: React.FC = () => (
  <Badge variant="outline" size="sm" style={{ marginLeft: 8 }}>
    inherited
  </Badge>
);

/**
 * Read-only badge for displaying non-editable values
 */
export const ReadOnlyBadge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    component="span"
    style={{
      display: "inline-block",
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 4,
      backgroundColor: "var(--mantine-color-default-hover)"
    }}
  >
    {children}
  </Box>
);
