import React from "react";
import AddIcon from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import type { SystemStyleObject } from "@mui/system";

// Sections are separated by whitespace, not rules: 16px above a title, and 12px
// between the title and the first field so its notched label clears the title.
const HEADER_SX = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 1,
  minHeight: 24,
  px: 2,
  pt: 2
} as const;
const BODY_PADDING_SX = { px: 2, pt: 1.5, pb: 0.5 } as const;
const DEFAULT_FORM_BODY_SX = { display: "flex", flexDirection: "column", gap: 1.5 } as const;
// An empty list collapses so its header sits directly above the next section.
const DEFAULT_LIST_BODY_SX = {
  "&:empty, &:has(> :only-child:empty)": { display: "none" }
} as const;

function withBodyPadding(bodySx: SystemStyleObject<Theme>): SystemStyleObject<Theme> {
  return { ...BODY_PADDING_SX, ...bodySx };
}

interface PanelSectionHeaderProps {
  title: string;
  action?: React.ReactNode;
}

export const PanelSectionHeader: React.FC<PanelSectionHeaderProps> = ({ title, action }) => (
  <Box sx={HEADER_SX}>
    <Typography variant="subtitle2">{title}</Typography>
    {action}
  </Box>
);

interface PanelSectionProps {
  title: string;
  children: React.ReactNode;
  /** Layout of the section body; the panel gutter is always applied. */
  bodySx?: SystemStyleObject<Theme>;
}

export const PanelSection: React.FC<PanelSectionProps> = ({
  title,
  children,
  bodySx = DEFAULT_FORM_BODY_SX
}) => (
  <>
    <PanelSectionHeader title={title} />
    <Box sx={withBodyPadding(bodySx)}>{children}</Box>
  </>
);

interface PanelAddSectionProps {
  title: string;
  children: React.ReactNode;
  onAdd: () => void;
  addLabel?: string;
  bodySx?: SystemStyleObject<Theme>;
  addDisabled?: boolean;
  addTitle?: string;
}

export const PanelAddSection: React.FC<PanelAddSectionProps> = ({
  title,
  children,
  onAdd,
  addLabel = "Add",
  bodySx = DEFAULT_LIST_BODY_SX,
  addDisabled = false,
  addTitle
}) => (
  <>
    <PanelSectionHeader
      title={title}
      action={
        <Button
          variant="text"
          size="small"
          startIcon={<AddIcon />}
          onClick={onAdd}
          disabled={addDisabled}
          title={addDisabled ? addTitle : undefined}
          sx={{ minHeight: 24, py: 0, mr: -1 }}
        >
          {addLabel}
        </Button>
      }
    />
    <Box sx={withBodyPadding(bodySx)}>{children}</Box>
  </>
);
