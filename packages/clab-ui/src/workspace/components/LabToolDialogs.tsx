/* eslint-disable import-x/max-dependencies */
// Renders the lab tool dialogs that hosts request through state/labToolDialogs.
import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import React, { useEffect, useState } from "react";

import { DialogTitleWithClose } from "../../components/ui/dialog/DialogChrome";
import { InputField } from "../../components/ui/form/InputField";
import { ClosGeneratorFields, useClosGeneratorForm } from "../../lab-tools/ClosGeneratorForm";
import type { ClosGeneratorResult } from "../../lab-tools/closGenerator";
import {
  defaultShareOptionsDraft,
  shareOptionsErrors,
  shareOptionsFromDraft,
  type ShareOptionsDraft,
  type ShareOptionsResult
} from "../../lab-tools/shareOptions";
import { controlRadius } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";
import {
  setLabToolDialogPresenter,
  type ActiveLabToolDialog,
  type GenerateTopologyDialogRequest,
  type ShareLinksDialogRequest,
  type ShareOptionsDialogRequest,
  type ValidationResultDialogRequest
} from "../state/labToolDialogs";

function GenerateTopologyDialog(props: {
  request: GenerateTopologyDialogRequest;
  onClose: (result: ClosGeneratorResult | undefined) => void;
}) {
  const { request, onClose } = props;
  const form = useClosGeneratorForm(request.initialDraft, request.defaultEndpointId ?? request.endpointOptions.at(0)?.value);
  const submit = () => {
    const result = form.submit();
    if (result) onClose(result);
  };
  return (
    <Dialog open onClose={() => onClose(undefined)} maxWidth="sm" fullWidth data-testid="clos-generator-dialog">
      <DialogTitleWithClose
        title="Generate Clos Topology"
        onClose={() => onClose(undefined)}
        closeButtonTestId="clos-generator-close"
      />
      <DialogContent dividers>
        <ClosGeneratorFields form={form} endpointOptions={request.endpointOptions} />
      </DialogContent>
      <DialogActions>
        <Button variant="text" size="small" onClick={() => onClose(undefined)}>
          Cancel
        </Button>
        <Button size="small" onClick={submit} data-testid="clos-generator-submit">
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ShareOptionsDialog(props: {
  request: ShareOptionsDialogRequest;
  onClose: (result: ShareOptionsResult | undefined) => void;
}) {
  const { request, onClose } = props;
  const [draft, setDraft] = useState<ShareOptionsDraft>(() => defaultShareOptionsDraft(request.defaultPort));
  const allErrors = shareOptionsErrors(request.tool, draft);
  const valid = Object.keys(allErrors).length === 0;
  // Empty credentials keep Share disabled without turning the fields red.
  const errors = {
    ...allErrors,
    username: draft.username ? allErrors.username : undefined,
    password: draft.password ? allErrors.password : undefined
  };
  const update = (patch: Partial<ShareOptionsDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const verb = request.action === "attach" ? "Share" : "Restart sharing";
  const title = `${verb} ${request.labName} with ${request.tool === "sshx" ? "sshx" : "GoTTY"}`;
  const submit = () => {
    if (valid) onClose(shareOptionsFromDraft(request.tool, draft));
  };

  return (
    <Dialog open onClose={() => onClose(undefined)} maxWidth="xs" fullWidth data-testid="share-options-dialog">
      <DialogTitleWithClose title={title} onClose={() => onClose(undefined)} />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {request.tool === "sshx" ? (
          <>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Anyone with the link gets a shell with access to the lab nodes.
            </Typography>
            {request.readersAvailable ? (
              <FormControlLabel
                sx={{ alignItems: "flex-start", mx: 0, gap: 0.5 }}
                control={
                  <Checkbox
                    size="small"
                    checked={draft.enableReaders}
                    onChange={(event) => update({ enableReaders: event.target.checked })}
                    sx={{ p: 0.5 }}
                    slotProps={{ input: { "aria-label": "Also create a read-only link" } }}
                    data-testid="share-options-readers"
                  />
                }
                label={
                  <Box sx={{ pt: 0.375 }}>
                    <Typography variant="body2">Also create a read-only link</Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                      Viewers with this link watch the terminals but cannot type.
                    </Typography>
                  </Box>
                }
              />
            ) : (
              <Alert severity="info" data-testid="share-options-readers-unavailable">
                This lab host cannot create read-only links. Update its clab-api-server to offer them.
              </Alert>
            )}
          </>
        ) : (
          <>
            <InputField
              id="share-options-port"
              label="Port"
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(port) => update({ port })}
              error={errors.port !== undefined}
              helperText={errors.port ?? "The web terminal listens here on the lab host."}
            />
            {request.credentialsAvailable ? (
              <>
                <FormControlLabel
                  sx={{ mx: 0, gap: 0.5 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={draft.customCredentials}
                      onChange={(event) => update({ customCredentials: event.target.checked })}
                      sx={{ p: 0.5 }}
                      data-testid="share-options-custom-credentials"
                    />
                  }
                  label={<Typography variant="body2">Set a username and password</Typography>}
                />
                {draft.customCredentials ? (
                  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
                    <InputField
                      id="share-options-username"
                      label="Username"
                      value={draft.username}
                      onChange={(username) => update({ username })}
                      error={errors.username !== undefined}
                      helperText={errors.username}
                    />
                    <InputField
                      id="share-options-password"
                      label="Password"
                      type="password"
                      value={draft.password}
                      onChange={(password) => update({ password })}
                      error={errors.password !== undefined}
                      helperText={errors.password}
                    />
                  </Box>
                ) : (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Without them, GoTTY signs in with admin / admin.
                  </Typography>
                )}
                <InputField
                  id="share-options-shell"
                  label="Shell"
                  value={draft.shell}
                  onChange={(shell) => update({ shell })}
                  placeholder="bash"
                  error={errors.shell !== undefined}
                  helperText={errors.shell}
                />
              </>
            ) : (
              <Alert severity="info" data-testid="share-options-credentials-unavailable">
                GoTTY signs in with admin / admin. Update the clab-api-server of this lab host to set
                your own credentials and shell.
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="text" size="small" onClick={() => onClose(undefined)}>
          Cancel
        </Button>
        <Button size="small" onClick={submit} disabled={!valid} data-testid="share-options-submit">
          {request.action === "attach" ? "Share" : "Reattach"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ShareLinkRow(props: { label: string; url: string; description?: string; index: number }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(props.url).then(
      () => setCopied(true),
      () => setCopied(false)
    );
  };
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }} data-testid={`share-link-${props.index}`}>
      <Typography variant="subtitle2">{props.label}</Typography>
      {props.description ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {props.description}
        </Typography>
      ) : null}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          pl: 1.5,
          pr: 0.5,
          py: 0.25,
          border: 1,
          borderColor: "divider",
          borderRadius: controlRadius
        }}
      >
        <Typography
          sx={{ flex: 1, minWidth: 0, fontFamily: MONO_FONT_FAMILY, fontSize: 12, overflowWrap: "anywhere" }}
          data-testid={`share-link-${props.index}-url`}
        >
          {props.url}
        </Typography>
        <Tooltip title={copied ? "Copied" : "Copy link"}>
          <IconButton size="small" aria-label={`Copy ${props.label}`} onClick={copy}>
            <ContentCopyOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Open link">
          <IconButton
            size="small"
            aria-label={`Open ${props.label}`}
            onClick={() => window.open(props.url, "_blank", "noopener,noreferrer")}
          >
            <OpenInNewRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function ShareLinksDialog(props: { request: ShareLinksDialogRequest; onClose: () => void }) {
  const { request, onClose } = props;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="share-links-dialog">
      <DialogTitleWithClose title={request.title} onClose={onClose} />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {request.links.map((link, index) => (
          <ShareLinkRow key={link.url} index={index} {...link} />
        ))}
        {request.note ? (
          <Alert severity="info" data-testid="share-links-note">
            {request.note}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ValidationResultDialog(props: { request: ValidationResultDialogRequest; onClose: () => void }) {
  const { request, onClose } = props;
  const Icon = request.valid ? CheckCircleOutlineRoundedIcon : ErrorOutlineRoundedIcon;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="validation-result-dialog">
      <DialogTitleWithClose
        title={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Icon color={request.valid ? "success" : "error"} fontSize="small" />
            {request.valid ? `${request.labName} is valid` : `${request.labName} is not valid`}
          </Box>
        }
        onClose={onClose}
      />
      <DialogContent dividers>
        <Box
          component="pre"
          sx={{
            m: 0,
            fontFamily: MONO_FONT_FAMILY,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere"
          }}
          data-testid="validation-result-details"
        >
          {request.details}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Hosts the dialogs of the lab tools; one is open at a time. */
export function LabToolDialogs() {
  const [dialog, setDialog] = useState<ActiveLabToolDialog | null>(null);

  useEffect(
    () =>
      setLabToolDialogPresenter((next) => {
        setDialog((current) => {
          // A new request replaces an open one, which counts as cancelled.
          if (current) closeAsCancelled(current);
          return next;
        });
      }),
    []
  );

  if (!dialog) return null;
  const close = () => setDialog(null);
  switch (dialog.kind) {
    case "generate":
      return (
        <GenerateTopologyDialog
          request={dialog.request}
          onClose={(result) => {
            close();
            dialog.resolve(result);
          }}
        />
      );
    case "share-options":
      return (
        <ShareOptionsDialog
          request={dialog.request}
          onClose={(result) => {
            close();
            dialog.resolve(result);
          }}
        />
      );
    case "share-links":
      return (
        <ShareLinksDialog
          request={dialog.request}
          onClose={() => {
            close();
            dialog.resolve();
          }}
        />
      );
    case "validation":
      return (
        <ValidationResultDialog
          request={dialog.request}
          onClose={() => {
            close();
            dialog.resolve();
          }}
        />
      );
  }
}

function closeAsCancelled(dialog: ActiveLabToolDialog): void {
  if (dialog.kind === "generate" || dialog.kind === "share-options") dialog.resolve(undefined);
  else dialog.resolve();
}
