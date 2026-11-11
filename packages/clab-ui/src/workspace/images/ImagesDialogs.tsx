/* eslint-disable import-x/max-dependencies -- Keep individual MUI imports tree-shakeable. */
import React, { useEffect, useRef, useState } from "react";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
  errorMessage,
  formatSize,
  keptMissingImage,
  isValidKind,
  isValidTag,
  isValidVersion,
  recordName,
  templateChanges,
  uploadProblem
} from "./imagesModel";
import { Field, MONO_SX } from "./imagesUi";
import type { ImageRecord, ImagesClient, ImagesTemplateResult, ImagesUploadResult } from "./types";

const DL_SX = { display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: 2, rowGap: 0.75, m: 0 } as const;

/** Confirms a pull with what it costs: the download size and the disk left after it. */
export function PullDialog({ record, freeBytes, floorBytes, onCancel, onConfirm }: {
  record: ImageRecord;
  freeBytes?: number;
  floorBytes: number;
  onCancel: () => void;
  onConfirm: (force: boolean) => void;
}): React.JSX.Element {
  const [force, setForce] = useState(false);
  const built = record.status === "built";
  const size = typeof record.size === "number" ? record.size : undefined;
  // The download stays cached next to the built image, so both count against the disk.
  const needed = record.status === "cached" ? 0 : size ?? 0;
  const after = freeBytes === undefined ? undefined : freeBytes - needed;
  const belowFloor = after !== undefined && after < floorBytes;
  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth data-testid="images-pull-confirm" aria-labelledby="images-pull-title">
      <DialogTitle id="images-pull-title">Pull {recordName(record)}?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          {record.status === "cached"
            ? "The file is already downloaded. climg builds the image and adds a Node Template for it."
            : "climg downloads the image from LabHub, builds it and adds a Node Template for it."}
        </Typography>
        <Box component="dl" sx={DL_SX}>
          <Field label="Download">{record.status === "cached" ? "none (cached)" : formatSize(size)}</Field>
          <Field label="Free disk now">{formatSize(freeBytes)}</Field>
          <Field label="Free disk after">
            <Box component="span" sx={{ color: belowFloor ? "error.main" : undefined }}>
              {after === undefined ? "unknown" : `about ${formatSize(after)}`}
            </Box>
          </Field>
          <Field label="Disk floor">{formatSize(floorBytes)}</Field>
          {record.tag ? <Field label="Image tag" mono>{record.tag}</Field> : null}
        </Box>
        {belowFloor ? (
          <Typography variant="body2" sx={{ mt: 1.5, color: "error.main" }}>
            This would leave less than the disk floor; climg will refuse to download.
          </Typography>
        ) : null}
        {built ? (
          <FormControlLabel
            sx={{ mt: 1 }}
            control={<Checkbox size="small" checked={force} onChange={(event) => setForce(event.target.checked)} />}
            label={<Typography variant="body2">Build again although the image exists</Typography>}
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onCancel}>Cancel</Button>
        <Button variant="contained" data-testid="images-pull-confirm-ok" onClick={() => onConfirm(force)}>
          {built && !force ? "Pull" : "Pull and build"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

type UploadState =
  | { phase: "pick" }
  | { phase: "sending"; sent: number; total: number }
  | { phase: "done"; result: ImagesUploadResult }
  | { phase: "failed"; message: string };

/** Sends one image file to the first images folder, with progress; nothing is kept if it stops. */
export function UploadDialog({ client, extensions, maxBytes, onClose, onUploaded, onBuild }: {
  client: ImagesClient;
  extensions: string[];
  maxBytes: number;
  onClose: () => void;
  onUploaded: (result: ImagesUploadResult) => void;
  onBuild: (fileName: string) => void;
}): React.JSX.Element {
  const [file, setFile] = useState<File>();
  const [state, setState] = useState<UploadState>({ phase: "pick" });
  const abort = useRef<AbortController | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const problem = file ? uploadProblem(file, { extensions, maxBytes }) : undefined;
  const sending = state.phase === "sending";
  const percent = sending && state.total > 0 ? Math.min(100, Math.round((state.sent / state.total) * 100)) : 0;

  const start = () => {
    if (!file || problem) return;
    const controller = new AbortController();
    abort.current = controller;
    setState({ phase: "sending", sent: 0, total: file.size });
    client
      .upload(file, { signal: controller.signal, onProgress: (sent, total) => setState({ phase: "sending", sent, total }) })
      .then((result) => {
        setState({ phase: "done", result });
        onUploaded(result);
      })
      .catch((error: unknown) => setState({ phase: "failed", message: errorMessage(error) }))
      .finally(() => {
        if (abort.current === controller) abort.current = undefined;
      });
  };
  const close = () => {
    abort.current?.abort();
    onClose();
  };

  return (
    <Dialog open onClose={sending ? undefined : close} maxWidth="sm" fullWidth data-testid="images-upload-dialog" aria-labelledby="images-upload-title">
      <DialogTitle id="images-upload-title">Upload an image file</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
          The file goes to the images folder of this host. Accepted: {extensions.join(" ")}, up to {formatSize(maxBytes)}.
        </Typography>
        <input
          ref={inputRef}
          type="file"
          hidden
          data-testid="images-upload-input"
          accept={extensions.join(",")}
          onChange={(event) => {
            setFile(event.target.files?.[0]);
            setState({ phase: "pick" });
          }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5, border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: "9px" }}>
          <UploadFileOutlinedIcon sx={{ color: "text.secondary" }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={MONO_SX}>{file ? file.name : "No file chosen"}</Typography>
            {file ? <Typography variant="caption" sx={{ color: "text.secondary" }}>{formatSize(file.size)}</Typography> : null}
          </Box>
          <Button size="small" variant="outlined" disabled={sending} onClick={() => inputRef.current?.click()}>
            {file ? "Choose another" : "Choose file"}
          </Button>
        </Box>
        {problem ? <Typography variant="body2" role="alert" sx={{ mt: 1, color: "error.main" }}>{problem}</Typography> : null}
        {sending ? (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={percent} data-testid="images-upload-progress" aria-label="Upload progress" />
            <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
              {percent} % · {formatSize(state.sent)} of {formatSize(state.total)}
            </Typography>
          </Box>
        ) : null}
        {state.phase === "done" ? (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={100} data-testid="images-upload-progress" aria-label="Upload progress" />
            <Typography variant="body2" role="status" sx={{ mt: 1 }}>
              Uploaded {state.result.name} ({formatSize(state.result.size)}). {formatSize(state.result.freeBytes)} free on the images folder.
            </Typography>
          </Box>
        ) : null}
        {state.phase === "failed" ? <Typography variant="body2" role="alert" sx={{ mt: 1.5, color: "error.main" }}>{state.message}</Typography> : null}
      </DialogContent>
      <DialogActions>
        {state.phase === "done" ? (
          <>
            <Button variant="text" onClick={close}>Close</Button>
            <Button variant="contained" onClick={() => onBuild(state.result.name)}>Register and build…</Button>
          </>
        ) : (
          <>
            <Button variant="text" onClick={close}>{sending ? "Cancel upload" : "Cancel"}</Button>
            <Button variant="contained" data-testid="images-upload-start" disabled={!file || problem !== undefined || sending} onClick={start}>
              Upload
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Registers an image file with its kind and version and builds it as a job. */
export function BuildDialog({ fileName, initialKind, initialVersion, kinds, onCancel, onStart }: {
  fileName: string;
  initialKind?: string;
  initialVersion?: string;
  kinds: string[];
  onCancel: () => void;
  onStart: (input: { kind: string; version: string; tag?: string }) => Promise<void>;
}): React.JSX.Element {
  const [kind, setKind] = useState(initialKind ?? "");
  const [version, setVersion] = useState(initialVersion ?? "");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const kindError = kind !== "" && !isValidKind(kind);
  const versionError = version !== "" && !isValidVersion(version);
  const tagError = tag !== "" && !isValidTag(tag);
  const ready = kind !== "" && version !== "" && !kindError && !versionError && !tagError;
  const submit = () => {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    onStart({ kind, version, ...(tag ? { tag } : {}) })
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth data-testid="images-build-dialog" aria-labelledby="images-build-title">
      <DialogTitle id="images-build-title">Register and build</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2, ...MONO_SX }}>{fileName}</Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Autocomplete
            freeSolo
            options={kinds}
            value={kind}
            onInputChange={(_event, value) => setKind(value.trim())}
            data-testid="images-build-kind"
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label="Kind"
                required
                error={kindError}
                helperText={kindError ? "A containerlab kind such as cisco_vios" : "The containerlab kind the image is for"}
              />
            )}
          />
          <TextField
            size="small"
            label="Version"
            required
            value={version}
            error={versionError}
            helperText={versionError ? "Letters, digits, dot, dash, underscore and plus" : "As the vendor names it, such as 4.32.0F"}
            onChange={(event) => setVersion(event.target.value.trim())}
            slotProps={{ htmlInput: { "data-testid": "images-build-version" } }}
          />
          <TextField
            size="small"
            label="Image tag (optional)"
            value={tag}
            placeholder="vrnetlab/<kind>:<version>"
            error={tagError}
            helperText={tagError ? "Not a valid docker image name" : "Leave empty for the tag vrnetlab gives it"}
            onChange={(event) => setTag(event.target.value.trim())}
            slotProps={{ htmlInput: { "data-testid": "images-build-tag" } }}
          />
        </Box>
        {error ? <Typography variant="body2" role="alert" sx={{ mt: 1.5, color: "error.main" }}>{error}</Typography> : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onCancel}>Cancel</Button>
        <Button variant="contained" data-testid="images-build-start" disabled={!ready || busy} onClick={submit}>Build</Button>
      </DialogActions>
    </Dialog>
  );
}

const CHANGE_LABELS: Record<string, string> = { created: "Add", updated: "Update", deleted: "Remove" };

/** Shows what a template sync would change, then applies it. */
export function SyncDialog({ client, onClose, onApplied }: {
  client: ImagesClient;
  onClose: () => void;
  onApplied: (result: ImagesTemplateResult) => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState<ImagesTemplateResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    client.syncTemplates(true)
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch((reason: unknown) => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, [client]);
  const changes = preview ? templateChanges(preview.changes) : [];
  const keptMissing = preview ? keptMissingImage(preview.skipped) : [];
  const apply = () => {
    setBusy(true);
    client.syncTemplates(false)
      .then(onApplied)
      .catch((reason: unknown) => {
        setError(errorMessage(reason));
        setBusy(false);
      });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="images-sync-dialog" aria-labelledby="images-sync-title">
      <DialogTitle id="images-sync-title">Sync Node Templates</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
          climg writes a template for every built image and removes its own templates whose image is gone.
          Templates it did not create are never changed.
        </Typography>
        {!preview && !error ? <LinearProgress aria-label="Loading the preview" /> : null}
        {preview && changes.length === 0 ? <Typography variant="body2">Everything is in sync. Nothing to change.</Typography> : null}
        {changes.length > 0 ? (
          <Box component="ul" sx={{ m: 0, p: 0, border: 1, borderColor: "divider", borderRadius: "6px" }}>
            {changes.map((change) => (
              <Box
                key={`${change.action}:${change.name}`}
                component="li"
                data-testid="images-sync-change"
                data-action={change.action}
                sx={{ listStyle: "none", display: "flex", gap: 1.5, px: 1.5, py: 0.75, "& + &": { borderTop: 1, borderColor: "divider" } }}
              >
                <Typography
                  variant="caption"
                  sx={{ width: 56, flexShrink: 0, fontWeight: 600, pt: "2px", color: change.action === "deleted" ? "error.main" : "success.main" }}
                >
                  {CHANGE_LABELS[change.action] ?? change.action}
                </Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={MONO_SX}>{change.name}</Typography>
                  {change.action === "updated" && change.kept.length > 0 ? (
                    <Typography variant="caption" data-testid="images-sync-kept" sx={{ color: "text.secondary" }}>
                      keeps your {change.kept.join(", ")}
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            ))}
          </Box>
        ) : null}
        {keptMissing.length > 0 ? (
          <Box component="ul" data-testid="images-sync-kept-missing" sx={{ m: 0, mt: 1.5, p: 0, border: 1, borderColor: "divider", borderRadius: "6px" }}>
            {keptMissing.map((name) => (
              <Box
                key={name}
                component="li"
                data-testid="images-sync-skipped"
                data-name={name}
                sx={{ listStyle: "none", display: "flex", gap: 1.5, px: 1.5, py: 0.75, "& + &": { borderTop: 1, borderColor: "divider" } }}
              >
                <Typography variant="caption" sx={{ width: 56, flexShrink: 0, fontWeight: 600, pt: "2px", color: "warning.main" }}>Kept</Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={MONO_SX}>{name}</Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Kept as you edited it, but its image is missing on this host. Select the template, then use Find this image.
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        ) : null}
        {error ? <Typography variant="body2" role="alert" sx={{ mt: 1.5, color: "error.main" }}>{error}</Typography> : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="contained" data-testid="images-sync-apply" disabled={busy || changes.length === 0} onClick={apply}>
          Apply {changes.length > 0 ? `${changes.length} ${changes.length === 1 ? "change" : "changes"}` : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
