/* eslint-disable import-x/max-dependencies */
// One code block of a lab guide: copy it, run it on its nodes or type it into their terminals.
import React from "react";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import TerminalIcon from "@mui/icons-material/Terminal";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { LabExecResult } from "../../../host/labOperations";
import type { GuideCodeBlock } from "../../../guide/parseGuide";
import { copyToClipboard } from "../../../utils/clipboard";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { ExecResults } from "../lab-operations/ExecCommandDialog";
import { RunError, RunProgress } from "../lab-operations/LabOperationParts";

export type GuideBlockRun =
  | { status: "idle" }
  /** `canTrustGuide`: the reader may agree to every block of the guide at once. */
  | { status: "confirm"; canTrustGuide: boolean }
  | { status: "running" }
  | { status: "done"; result: LabExecResult }
  | { status: "sent" }
  | { status: "error"; message: string };

/** The block's run button; null when the host can only copy it. */
export interface GuideBlockAction {
  /** Why it cannot run now, shown on the disabled button. */
  disabledReason?: string;
}

interface GuideBlockProps {
  block: GuideCodeBlock;
  ticked: boolean;
  action: GuideBlockAction | null;
  run: GuideBlockRun;
  nodeNames: string[];
  onToggleTick: (id: string) => void;
  onRun: (block: GuideCodeBlock) => void;
  /** `trustGuide`: don't ask again for any block of the guide as it is now. */
  onConfirm: (block: GuideCodeBlock, trustGuide: boolean) => void;
  onCancel: (id: string) => void;
}

const KIND_COLOR: Record<GuideCodeBlock["kind"], string> = {
  copy: "text.secondary",
  exec: "primary.main",
  terminal: "warning.main"
};

const CODE_SX = {
  m: 0,
  px: 1.5,
  py: 1,
  fontFamily: MONO_FONT_FAMILY,
  fontSize: 12,
  lineHeight: 1.55,
  overflowX: "auto",
  whiteSpace: "pre"
} as const;

const TickButton: React.FC<{ ticked: boolean; onClick: () => void }> = ({ ticked, onClick }) => (
  <Tooltip title={ticked ? "Done. Click to untick" : "Mark as done"}>
    <IconButton
      size="small"
      aria-pressed={ticked}
      aria-label={ticked ? "Done" : "Mark as done"}
      onClick={onClick}
      data-testid="guide-block-tick"
      sx={{
        width: 22,
        height: 22,
        p: 0,
        border: 1.5,
        borderColor: ticked ? "success.main" : "text.disabled",
        bgcolor: ticked ? "success.main" : "transparent",
        color: ticked ? "success.contrastText" : "transparent",
        "&:hover": {
          bgcolor: ticked ? "success.dark" : "action.hover",
          color: ticked ? "success.contrastText" : "success.main",
          borderColor: "success.main"
        }
      }}
    >
      <CheckIcon sx={{ fontSize: 14 }} />
    </IconButton>
  </Tooltip>
);

function runLabel(block: GuideCodeBlock): string {
  return block.kind === "terminal" ? "Send" : "Run";
}

const CopyButton: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async () => {
    if (!(await copyToClipboard(code))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Tooltip title={copied ? "Copied" : "Copy"}>
      <IconButton
        size="small"
        aria-label="Copy"
        onClick={() => void handleCopy()}
        data-testid="guide-block-copy"
      >
        {copied ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
      </IconButton>
    </Tooltip>
  );
};

const RunButton: React.FC<{
  block: GuideCodeBlock;
  action: GuideBlockAction;
  busy: boolean;
  onRun: (block: GuideCodeBlock) => void;
}> = ({ block, action, busy, onRun }) => {
  const Icon = block.kind === "terminal" ? TerminalIcon : PlayArrowIcon;
  const button = (
    <Button
      size="small"
      variant="contained"
      disableElevation
      startIcon={<Icon sx={{ fontSize: 16 }} />}
      disabled={busy || action.disabledReason !== undefined}
      onClick={() => onRun(block)}
      data-testid="guide-block-run"
      sx={{ minHeight: 24, py: 0, px: 1, fontSize: 12 }}
    >
      {runLabel(block)}
    </Button>
  );
  if (action.disabledReason === undefined) return button;
  // A disabled button gets no pointer events, so the tooltip goes on its wrapper.
  return (
    <Tooltip title={action.disabledReason}>
      <span data-testid="guide-block-run-reason" data-reason={action.disabledReason}>
        {button}
      </span>
    </Tooltip>
  );
};

const ConfirmRun: React.FC<{
  block: GuideCodeBlock;
  canTrustGuide: boolean;
  onConfirm: (block: GuideCodeBlock, trustGuide: boolean) => void;
  onCancel: (id: string) => void;
}> = ({ block, canTrustGuide, onConfirm, onCancel }) => {
  const [trustGuide, setTrustGuide] = React.useState(false);
  return (
    <Box
      role="group"
      aria-label="Confirm run"
      data-testid="guide-block-confirm"
      sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: "divider", bgcolor: "action.hover" }}
    >
      <Typography variant="body2" sx={{ mb: 1 }}>
        {block.kind === "terminal" ? "Type these lines into the terminal of " : "Run this command on "}
        <Box component="strong" sx={{ fontFamily: MONO_FONT_FAMILY }}>
          {block.nodes.join(", ")}
        </Box>
        ? Check what it does first: the guide may have been written by someone else.
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 1 }}>
        {canTrustGuide && (
          <FormControlLabel
            sx={{ mr: "auto", ml: 0 }}
            control={
              <Checkbox
                size="small"
                checked={trustGuide}
                onChange={(event) => setTrustGuide(event.target.checked)}
                sx={{ p: 0.5 }}
                data-testid="guide-block-trust-guide"
              />
            }
            label={<Typography variant="body2">Don&apos;t ask again for this guide</Typography>}
          />
        )}
        <Button size="small" onClick={() => onCancel(block.id)} data-testid="guide-block-cancel">
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          disableElevation
          onClick={() => onConfirm(block, trustGuide)}
          data-testid="guide-block-confirm-run"
        >
          {runLabel(block)}
        </Button>
      </Box>
    </Box>
  );
};

/**
 * What each node printed, open after every run; the arrow folds it away. No
 * exit codes: what they mean differs from one node's OS to the next.
 */
const ExecOutcome: React.FC<{ block: GuideCodeBlock; result: LabExecResult; nodeNames: string[] }> = ({
  block,
  result,
  nodeNames
}) => {
  const [open, setOpen] = React.useState(true);
  const outputId = React.useId();
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider" }}>
      <ButtonBase
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={outputId}
        data-testid="guide-block-output-toggle"
        sx={{
          width: "100%",
          justifyContent: "flex-start",
          gap: 0.5,
          px: 1,
          py: 0.5,
          color: "text.secondary",
          "&:hover": { bgcolor: "action.hover" },
          "&:focus-visible": { outline: "1px solid var(--vscode-focusBorder)", outlineOffset: -1 }
        }}
      >
        <ExpandMoreIcon
          sx={{
            fontSize: 18,
            transform: open ? "none" : "rotate(-90deg)",
            transition: "transform 120ms ease",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" }
          }}
        />
        <Typography variant="caption">Output of {block.nodes.join(", ")}</Typography>
      </ButtonBase>
      {open && (
        <Box id={outputId} sx={{ px: 1.5, pb: 1 }} data-testid="guide-block-output">
          <ExecResults result={result} nodeNames={nodeNames} plain />
        </Box>
      )}
    </Box>
  );
};

const RunOutcome: React.FC<{ block: GuideCodeBlock; run: GuideBlockRun; nodeNames: string[] }> = ({
  block,
  run,
  nodeNames
}) => {
  switch (run.status) {
    case "running":
      return (
        <Box sx={{ borderTop: 1, borderColor: "divider" }}>
          <RunProgress label={`Running on ${block.nodes.join(", ")}…`} testId="guide-block-running" />
        </Box>
      );
    case "done":
      return <ExecOutcome block={block} result={run.result} nodeNames={nodeNames} />;
    case "sent":
      return (
        <Typography
          variant="caption"
          component="p"
          sx={{ m: 0, px: 1.5, py: 0.75, borderTop: 1, borderColor: "divider", color: "text.secondary" }}
          data-testid="guide-block-sent"
        >
          Sent to the terminal of {block.nodes.join(", ")}.
        </Typography>
      );
    case "error":
      return (
        <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
          <RunError message={run.message} testId="guide-block-error" />
        </Box>
      );
    default:
      return null;
  }
};

export const GuideBlock: React.FC<GuideBlockProps> = ({
  block,
  ticked,
  action,
  run,
  nodeNames,
  onToggleTick,
  onRun,
  onConfirm,
  onCancel
}) => {
  const kindLabel = block.kind === "copy" ? block.lang : block.kind;
  return (
    <Box
      data-testid="guide-block"
      data-kind={block.kind}
      data-ticked={ticked}
      sx={{
        border: 1,
        borderColor: ticked ? "success.main" : "divider",
        borderRadius: controlRadius,
        overflow: "hidden"
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          pl: 1,
          pr: 0.5,
          py: 0.5,
          bgcolor: "action.hover",
          borderBottom: 1,
          borderColor: "divider"
        }}
      >
        <TickButton ticked={ticked} onClick={() => onToggleTick(block.id)} />
        {kindLabel !== "" && (
          <Typography
            variant="caption"
            sx={{ fontFamily: MONO_FONT_FAMILY, fontWeight: 600, color: KIND_COLOR[block.kind] }}
          >
            {kindLabel}
          </Typography>
        )}
        {block.nodes.length > 0 && (
          <Typography
            variant="caption"
            noWrap
            sx={{ fontFamily: MONO_FONT_FAMILY, color: "text.secondary", minWidth: 0 }}
          >
            {block.nodes.join(", ")}
          </Typography>
        )}
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5 }}>
          <CopyButton code={block.code} />
          {action && (
            <RunButton
              block={block}
              action={action}
              busy={run.status === "running" || run.status === "confirm"}
              onRun={onRun}
            />
          )}
        </Box>
      </Box>
      <Box component="pre" sx={CODE_SX}>
        {block.code}
      </Box>
      {run.status === "confirm" ? (
        <ConfirmRun block={block} canTrustGuide={run.canTrustGuide} onConfirm={onConfirm} onCancel={onCancel} />
      ) : (
        <RunOutcome block={block} run={run} nodeNames={nodeNames} />
      )}
    </Box>
  );
};
