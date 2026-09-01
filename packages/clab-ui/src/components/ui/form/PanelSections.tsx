import React from "react";
import { Box, Button, Divider, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";

const HEADER_STYLE: React.CSSProperties = { paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 };
const HEADER_WITH_ACTION_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  paddingLeft: 16,
  paddingRight: 16,
  paddingTop: 8,
  paddingBottom: 8
};
const DEFAULT_FORM_BODY_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16
};
const DEFAULT_LIST_BODY_STYLE: React.CSSProperties = { padding: 16 };

interface PanelSectionHeaderProps {
  title: string;
  withTopDivider?: boolean;
}

export const PanelSectionHeader: React.FC<PanelSectionHeaderProps> = ({
  title,
  withTopDivider = true
}) => (
  <>
    {withTopDivider && <Divider />}
    <Box style={HEADER_STYLE}>
      <Text size="sm" fw={600}>
        {title}
      </Text>
    </Box>
    <Divider />
  </>
);

interface PanelSectionProps {
  title: string;
  children: React.ReactNode;
  withTopDivider?: boolean;
  bodySx?: React.CSSProperties;
}

export const PanelSection: React.FC<PanelSectionProps> = ({
  title,
  children,
  withTopDivider = true,
  bodySx = DEFAULT_FORM_BODY_STYLE
}) => (
  <>
    <PanelSectionHeader title={title} withTopDivider={withTopDivider} />
    <Box style={bodySx}>{children}</Box>
  </>
);

interface PanelAddSectionProps {
  title: string;
  children: React.ReactNode;
  onAdd: () => void;
  addLabel?: string;
  withTopDivider?: boolean;
  bodySx?: React.CSSProperties;
  addDisabled?: boolean;
  addTitle?: string;
}

export const PanelAddSection: React.FC<PanelAddSectionProps> = ({
  title,
  children,
  onAdd,
  addLabel = "ADD",
  withTopDivider = true,
  bodySx = DEFAULT_LIST_BODY_STYLE,
  addDisabled = false,
  addTitle
}) => (
  <>
    {withTopDivider && <Divider />}
    <Box style={HEADER_WITH_ACTION_STYLE}>
      <Text size="sm" fw={600}>
        {title}
      </Text>
      <Button
        variant="subtle"
        size="compact-sm"
        leftSection={<IconPlus size={18} />}
        onClick={onAdd}
        disabled={addDisabled}
        title={addDisabled ? addTitle : undefined}
      >
        {addLabel}
      </Button>
    </Box>
    <Divider />
    <Box style={bodySx}>{children}</Box>
  </>
);
