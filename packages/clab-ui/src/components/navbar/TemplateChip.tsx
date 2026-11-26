// A topology template in the toolbar. The canvas shows what containerlab
// renders from it, read-only: the chip says so, and why when it does not
// render. A click opens the template as text.
import React from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import DataObjectOutlinedIcon from "@mui/icons-material/DataObjectOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";

import type { TopologyTemplateState } from "../../core/types/messages";
import { CAP_CENTERED_TEXT_SX } from "../../theme/typography";

import { templateProblem } from "./templateNotice";

function ChipTooltip(props: {
  template: TopologyTemplateState;
  fileName: string;
  problem: string | undefined;
  clickable: boolean;
}) {
  const varsFiles = props.template.varsFiles ?? [];
  return (
    <Box sx={{ display: "grid", gap: 0.25, py: 0.25, maxWidth: 360 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
        {props.fileName}
      </Typography>
      <Typography variant="caption">
        The canvas shows what containerlab renders from this template. Nodes and links are
        read-only here: edit the template as text.
      </Typography>
      {props.template.source === "rendered" ? (
        <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
          {varsFiles.length > 0 ? `Variables: ${varsFiles.join(", ")}` : "No variables file"}
        </Typography>
      ) : null}
      {props.problem ? (
        <Typography
          variant="caption"
          data-testid="template-chip-problem"
          sx={{ color: "warning.light", overflowWrap: "anywhere" }}
        >
          {props.problem}
        </Typography>
      ) : null}
      {props.clickable ? (
        <Typography variant="caption" sx={{ opacity: 0.75, mt: 0.25 }}>
          Click to edit the template
        </Typography>
      ) : null}
    </Box>
  );
}

/** `{} Template`: the open topology is a template. Narrow toolbars keep the icon. */
export function TemplateChip(props: {
  template: TopologyTemplateState;
  /** The template's file name, e.g. `fabric.clab.gotmpl`. */
  fileName: string;
  /** Opens the template as text. */
  onOpen?: () => void;
  /** The size container of the toolbar, whose width decides what shows. */
  container?: string;
}) {
  const { template, fileName, onOpen } = props;
  const narrow = props.container
    ? `@container ${props.container} (max-width: 640px)`
    : "@media (max-width: 640px)";
  const problem = templateProblem(template, fileName);
  const Icon = problem ? WarningAmberRoundedIcon : DataObjectOutlinedIcon;
  const content = (
    <>
      <Icon
        aria-hidden="true"
        sx={{ fontSize: 16, flex: "0 0 auto", color: problem ? "warning.main" : "text.secondary" }}
      />
      <Typography
        component="span"
        variant="subtitle2"
        noWrap
        sx={{ ...CAP_CENTERED_TEXT_SX, color: "text.primary", [narrow]: { display: "none" } }}
      >
        Template
      </Typography>
    </>
  );
  const sx = {
    display: "inline-flex",
    alignItems: "center",
    gap: 0.75,
    height: 28,
    px: 1,
    borderRadius: 1,
    minWidth: 0,
    border: 1,
    borderColor: problem ? "warning.main" : "divider",
    "&:hover": onOpen ? { bgcolor: "action.hover" } : undefined
  } as const;
  const label = `Topology template ${fileName}, read-only${problem ? `. ${problem}` : ""}`;
  return (
    <Tooltip
      title={
        <ChipTooltip
          template={template}
          fileName={fileName}
          problem={problem}
          clickable={onOpen !== undefined}
        />
      }
      placement="bottom-start"
      enterDelay={300}
    >
      {onOpen ? (
        <ButtonBase
          data-testid="template-chip"
          data-source={template.source}
          aria-label={label}
          onClick={onOpen}
          sx={sx}
        >
          {content}
        </ButtonBase>
      ) : (
        <Box
          data-testid="template-chip"
          data-source={template.source}
          role="note"
          aria-label={label}
          sx={sx}
        >
          {content}
        </Box>
      )}
    </Tooltip>
  );
}
