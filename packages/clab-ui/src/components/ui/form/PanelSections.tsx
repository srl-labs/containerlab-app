import React from "react";
import AddIcon from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import type { SystemStyleObject } from "@mui/system";

import type { RuntimeLimit } from "../../../host/kubernetesLimits";

import { RuntimeLimitNote, RuntimeLimited } from "./RuntimeLimited";

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

/** The lab host's limit on a whole section, said under its title. */
const SectionLimitNote: React.FC<{ limit: RuntimeLimit | undefined }> = ({ limit }) =>
  limit ? (
    <Box sx={{ px: 2, pt: 0.5 }}>
      <RuntimeLimitNote limit={limit} />
    </Box>
  ) : null;

interface PanelSectionProps {
  title: string;
  children: React.ReactNode;
  /** Layout of the section body; the panel gutter is always applied. */
  bodySx?: SystemStyleObject<Theme>;
  /** What the lab host cannot do here (c9s): the section is greyed out or gets a hint. */
  limit?: RuntimeLimit;
}

export const PanelSection: React.FC<PanelSectionProps> = ({
  title,
  children,
  bodySx = DEFAULT_FORM_BODY_SX,
  limit
}) => (
  <>
    <PanelSectionHeader title={title} />
    <SectionLimitNote limit={limit} />
    <Box sx={withBodyPadding(bodySx)}>
      {limit ? (
        <RuntimeLimited limit={limit} note={false}>
          <Box sx={bodySx}>{children}</Box>
        </RuntimeLimited>
      ) : (
        children
      )}
    </Box>
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
  /** What the lab host cannot do here (c9s): the section is greyed out or gets a hint. */
  limit?: RuntimeLimit;
  /** The section holds values: an unsupported one stays editable so they can be removed. */
  limitKeepsEditable?: boolean;
}

export const PanelAddSection: React.FC<PanelAddSectionProps> = ({
  title,
  children,
  onAdd,
  addLabel = "Add",
  bodySx = DEFAULT_LIST_BODY_SX,
  addDisabled = false,
  addTitle,
  limit,
  limitKeepsEditable = false
}) => {
  const greyed = limit?.level === "unsupported";
  let buttonTitle = addDisabled ? addTitle : undefined;
  if (greyed) buttonTitle = limit.reason;
  return (
  <>
    <PanelSectionHeader
      title={title}
      action={
        <Button
          variant="text"
          size="small"
          startIcon={<AddIcon />}
          onClick={onAdd}
          disabled={addDisabled || greyed}
          title={buttonTitle}
          sx={{ minHeight: 24, py: 0, mr: -1 }}
        >
          {addLabel}
        </Button>
      }
    />
    <SectionLimitNote limit={limit} />
    <Box sx={withBodyPadding(bodySx)}>
      {limit ? (
        <RuntimeLimited limit={limit} note={false} keepEditable={limitKeepsEditable}>
          <Box sx={bodySx}>{children}</Box>
        </RuntimeLimited>
      ) : (
        children
      )}
    </Box>
  </>
  );
};
