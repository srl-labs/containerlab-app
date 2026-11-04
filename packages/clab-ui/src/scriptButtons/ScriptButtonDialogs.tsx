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

function isHiddenCharacter(code: number): boolean {
  if (code === 0x09 || code === 0x0a) return false;
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** Control and direction characters can hide what a script does, so they show as codes. */
export function revealHiddenCharacters(text: string): string {
  let shown = "";
  for (const character of text) {
    const code = character.charCodeAt(0);
    shown += isHiddenCharacter(code)
      ? `\u27e6U+${code.toString(16).toUpperCase().padStart(4, "0")}\u27e7`
      : character;
  }
  return shown;
}

function countLines(text: string): number {
  return text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
}

const ConfirmRunDialog: React.FC = () => {
  const confirm = useScriptButtonStore((state) => state.confirm);
  const answer = useScriptButtonStore((state) => state.answerConfirm);
  if (!confirm) return null;
  const { script } = confirm;
  const lines = countLines(script.content);
  return (
    <Dialog open onClose={() => answer(false)} maxWidth="md" fullWidth data-testid="script-button-confirm">
      <DialogTitle>Run {revealHiddenCharacters(confirm.label)}?</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 1.5 }}>
        {script.foreign ? (
          <Alert severity="warning" variant="outlined" data-testid="script-button-confirm-foreign">
            You may not have written this script. It comes from a shared folder or from another user{script.owner ? ` (file owner: ${script.owner})` : ""}.
          </Alert>
        ) : null}
        <Typography variant="body2">This runs on the lab host, as your user:</Typography>
        {script.resolvedPath !== undefined ? (
          <Typography variant="body2" sx={{ fontFamily: MONO_FONT_FAMILY, overflowWrap: "anywhere" }} data-testid="script-button-confirm-path">
            {revealHiddenCharacters(script.resolvedPath)}
          </Typography>
        ) : null}
        <Box component="pre" sx={CODE_SX} data-testid="script-button-confirm-content">
          {revealHiddenCharacters(script.content)}
        </Box>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {script.truncated
            ? `Showing the start of the script (${lines} lines of ${script.size} bytes). Read the rest on the lab host first.`
            : `${lines} ${lines === 1 ? "line" : "lines"}. Scroll to read all of it.`}
        </Typography>
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
