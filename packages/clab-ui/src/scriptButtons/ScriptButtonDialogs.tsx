import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";

import type { LabHostScriptResult } from "../host/labOperations";
import { MONO_FONT_FAMILY } from "../theme/typography";

import { useScriptButtonStore } from "./scriptButtonStore";

const CODE_SX = {
  m: 0,
  p: 1.5,
  maxHeight: 320,
  overflow: "auto",
  fontFamily: MONO_FONT_FAMILY,
  fontSize: 12,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  bgcolor: "action.hover",
  borderRadius: 1
} as const;

function statusLine(result: LabHostScriptResult): string {
  const seconds = Math.round(result.durationMs / 100) / 10;
  if (result.timedOut) return `Timed out after ${seconds}s`;
  return `Exited with ${result.exitCode ?? "a signal"} after ${seconds}s`;
}

const ConfirmRunDialog: React.FC = () => {
  const confirm = useScriptButtonStore((state) => state.confirm);
  const answer = useScriptButtonStore((state) => state.answerConfirm);
  if (!confirm) return null;
  return (
    <Dialog open onClose={() => answer(false)} maxWidth="sm" fullWidth data-testid="script-button-confirm">
      <DialogTitle>Run {confirm.label}?</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 1.5 }}>
        <Typography variant="body2">
          {confirm.isPath
            ? "This runs the script file below on the lab host, as your user."
            : "This runs the script below on the lab host, as your user."}
        </Typography>
        <Box component="pre" sx={CODE_SX}>
          {confirm.source}
        </Box>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Only run scripts from labs you trust.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={() => answer(false)}>
          Cancel
        </Button>
        <Button onClick={() => answer(true)} data-testid="script-button-confirm-run">
          Run
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const OutputDialog: React.FC = () => {
  const output = useScriptButtonStore((state) => state.output);
  const close = useScriptButtonStore((state) => state.closeOutput);
  if (!output) return null;
  const { result } = output;
  const failed = result.timedOut || result.exitCode !== 0;
  return (
    <Dialog open onClose={close} maxWidth="md" fullWidth data-testid="script-button-output">
      <DialogTitle>{output.label}</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 1.5 }}>
        <Alert severity={failed ? "error" : "success"} variant="outlined">
          {statusLine(result)}
        </Alert>
        {result.stdout.trim() !== "" ? (
          <Box component="pre" sx={CODE_SX} data-testid="script-button-stdout">
            {result.stdout}
          </Box>
        ) : null}
        {result.stderr.trim() !== "" ? (
          <Box component="pre" sx={{ ...CODE_SX, color: "error.main" }} data-testid="script-button-stderr">
            {result.stderr}
          </Box>
        ) : null}
        {result.stdout.trim() === "" && result.stderr.trim() === "" ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            No output.
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={close}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/** The run confirmation and the output dialog of script buttons. */
export const ScriptButtonDialogs: React.FC = () => (
  <>
    <ConfirmRunDialog />
    <OutputDialog />
  </>
);
