/** Which gNMI port the engine reaches a lab's nodes on, for labs where it is not the default. */
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";

import { isValidGnmiPort } from "../../fabric/engine";

function parsePort(text: string): number | undefined {
  const port = /^\d+$/.test(text.trim()) ? Number(text) : undefined;
  return isValidGnmiPort(port) ? port : undefined;
}

function PortField({ text, onChange, autoFocus = false }: {
  text: string;
  onChange: (text: string) => void;
  autoFocus?: boolean;
}): React.JSX.Element {
  const invalid = parsePort(text) === undefined;
  return (
    <TextField
      size="small"
      label="gNMI port"
      value={text}
      autoFocus={autoFocus}
      error={invalid}
      helperText={invalid ? "A port from 1 to 65535" : undefined}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { inputMode: "numeric", "data-testid": "fabric-gnmi-port-input" } }}
      sx={{ width: 150 }}
    />
  );
}

/**
 * The button that starts the engine, with the port to start it on. A host that
 * does not say which port it uses cannot change it: only the button shows.
 */
export function GnmiPortStart({ gnmiPort, label, testId, onStart }: {
  gnmiPort: number | undefined;
  label: string;
  testId: string;
  /** With the port only when it changed. */
  onStart: (port?: number) => void;
}): React.JSX.Element {
  const [text, setText] = useState(String(gnmiPort ?? ""));
  if (gnmiPort === undefined) {
    return <Button variant="contained" sx={{ mt: 0.5 }} data-testid={testId} onClick={() => onStart()}>{label}</Button>;
  }
  const port = parsePort(text);
  return (
    <Box
      component="form"
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault();
        if (port !== undefined) onStart(port === gnmiPort ? undefined : port);
      }}
      sx={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 1, mt: 0.5 }}
    >
      <PortField text={text} onChange={setText} />
      <Button type="submit" variant="contained" disabled={port === undefined} data-testid={testId} sx={{ mt: "2px" }}>{label}</Button>
    </Box>
  );
}

/** Changes the port of an engine that runs, which restarts it. */
export function GnmiPortDialog({ gnmiPort, onClose, onChange }: {
  gnmiPort: number;
  onClose: () => void;
  onChange: (port: number) => void;
}): React.JSX.Element {
  const [text, setText] = useState(String(gnmiPort));
  const port = parsePort(text);
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          "data-testid": "fabric-gnmi-port-dialog",
          onSubmit: (event: React.FormEvent) => {
            event.preventDefault();
            if (port !== undefined && port !== gnmiPort) onChange(port);
          }
        } as object
      }}
    >
      <DialogTitle>gNMI port</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          The port every node of this lab listens on, for the view and for its reports. Changing it
          restarts the engine; the history stays.
        </Typography>
        <PortField text={text} onChange={setText} autoFocus />
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={port === undefined || port === gnmiPort} data-testid="fabric-gnmi-port-apply">
          Restart engine
        </Button>
      </DialogActions>
    </Dialog>
  );
}
