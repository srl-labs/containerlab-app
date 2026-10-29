// "Add lab host" choices, the Kubernetes cluster form and the check list, shared by every app.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ComputerOutlinedIcon from "@mui/icons-material/ComputerOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutlined";

import { PER_LAB_PULL_SECRET_NOTE } from "../../host/kubernetesLimits";
import type { LabHostCheck } from "../../host/labHostSupport";
import { C9S_EXPOSE_TYPES, isValidKubeNamespace, isValidKubeSecretName, type C9sExposeType } from "../../host/lifecycleOptions";
import { C9S_EXPOSE_DESCRIPTIONS, LAB_HOST_KIND_LABELS, type LabHostKind } from "../endpoints";
import type { ClusterHostSettings, ClusterHostsSupport, KubeconfigContextList } from "../types";
import { MONO_FONT_FAMILY } from "../../theme/typography";

/** The icon of a lab host kind, in the list and in "Add lab host". */
export function LabHostKindIcon(props: { kind: LabHostKind; fontSize?: number }) {
  const sx = { fontSize: props.fontSize ?? 20 };
  if (props.kind === "cluster") return <HubOutlinedIcon sx={sx} />;
  if (props.kind === "server") return <DnsOutlinedIcon sx={sx} />;
  return <ComputerOutlinedIcon sx={sx} />;
}

function CopyCommand(props: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 0.5,
        mt: 0.5,
        px: 1,
        py: 0.5,
        borderRadius: 1,
        bgcolor: "action.hover"
      }}
    >
      <Box
        component="code"
        sx={{ flex: 1, fontFamily: MONO_FONT_FAMILY, fontSize: 12, overflowWrap: "anywhere", py: 0.25 }}
      >
        {props.command}
      </Box>
      <IconButton
        size="small"
        aria-label={copied ? "Copied" : "Copy command"}
        title={copied ? "Copied" : "Copy"}
        onClick={() => {
          void navigator.clipboard?.writeText(props.command).then(() => setCopied(true), () => undefined);
        }}
        sx={{ mt: -0.25 }}
      >
        <ContentCopyOutlinedIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );
}

const CHECK_ICONS: Record<LabHostCheck["status"], React.ReactNode> = {
  ok: <CheckCircleIcon sx={{ fontSize: 16, color: "success.main" }} titleAccess="passed" />,
  failed: <CancelIcon sx={{ fontSize: 16, color: "error.main" }} titleAccess="failed" />,
  skipped: <RemoveCircleOutlineIcon sx={{ fontSize: 16, color: "text.disabled" }} titleAccess="not checked" />
};

/** Each check of a lab host: ✓, ✗ or – with what was found and, for a failure, the fix. */
export function LabHostCheckList(props: { checks: readonly LabHostCheck[]; dense?: boolean }) {
  return (
    <Stack component="ul" spacing={props.dense ? 0.5 : 0.75} sx={{ m: 0, p: 0, listStyle: "none" }} data-testid="lab-host-checks">
      {props.checks.map((check) => (
        <Box component="li" key={check.id} data-status={check.status} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
          <Box sx={{ display: "inline-flex", mt: "2px", flexShrink: 0 }}>{CHECK_ICONS[check.status]}</Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ color: check.status === "skipped" ? "text.secondary" : "text.primary" }}>
              {check.label}
            </Typography>
            {check.message && check.status !== "skipped" ? (
              <Typography variant="caption" sx={{ display: "block", color: check.status === "failed" ? "error.main" : "text.secondary", overflowWrap: "anywhere" }}>
                {check.message}
              </Typography>
            ) : null}
            {check.status === "failed" && check.fix ? (
              <Typography variant="caption" sx={{ display: "block", color: "text.primary", mt: 0.25 }}>
                {check.fix}
              </Typography>
            ) : null}
            {check.status === "failed" && check.command ? <CopyCommand command={check.command} /> : null}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

/** "Check connection" of a lab host on this machine: runs the checks and lists them. */
export function LabHostCheckDialog(props: {
  label: string;
  open: boolean;
  onClose: () => void;
  runCheck: () => Promise<LabHostCheck[]>;
}) {
  const { open, runCheck } = props;
  const [state, setState] = useState<{ status: "running" } | { status: "done"; checks: LabHostCheck[] } | { status: "error"; message: string }>({ status: "running" });
  const run = useCallback(() => {
    setState({ status: "running" });
    runCheck().then(
      (checks) => setState({ status: "done", checks }),
      (error: unknown) => setState({ status: "error", message: error instanceof Error ? error.message : String(error) })
    );
  }, [runCheck]);
  useEffect(() => {
    if (open) run();
  }, [open, run]);
  const passed = state.status === "done" && state.checks.every((check) => check.status === "ok");
  return (
    <Dialog open={open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>{`Check ${props.label}`}</DialogTitle>
      <DialogContent dividers>
        {state.status === "running" ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <CircularProgress size={16} />
            <Typography variant="body2">Checking…</Typography>
          </Stack>
        ) : null}
        {state.status === "error" ? <Alert severity="error" variant="outlined">{state.message}</Alert> : null}
        {state.status === "done" ? (
          <Stack spacing={1.5}>
            <Alert severity={passed ? "success" : "warning"} variant="outlined">
              {passed ? "Everything is ready: labs can run here." : "Labs cannot run here until the failed checks are fixed."}
            </Alert>
            <LabHostCheckList checks={state.checks} />
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={run} disabled={state.status === "running"}>
          Check again
        </Button>
        <Button variant="contained" onClick={props.onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** One choice of "Where should labs run?". */
export interface LabHostChoice {
  kind: LabHostKind;
  description: string;
  /** Why it cannot be chosen here, and what to do instead. */
  unavailable?: string;
}

/** The three answers to "Where should labs run?", the unavailable ones disabled with why. */
export function LabHostChoices(props: {
  choices: readonly LabHostChoice[];
  selected: LabHostKind | null;
  onSelect: (kind: LabHostKind) => void;
}) {
  return (
    <Box
      role="radiogroup"
      aria-label="Where should labs run?"
      sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1 }}
    >
      {props.choices.map((choice) => {
        const selected = props.selected === choice.kind;
        const disabled = choice.unavailable !== undefined;
        return (
          <ButtonBase
            key={choice.kind}
            role="radio"
            aria-checked={selected}
            aria-label={LAB_HOST_KIND_LABELS[choice.kind]}
            data-testid={`lab-host-choice-${choice.kind}`}
            onClick={() => props.onSelect(choice.kind)}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "flex-start",
              textAlign: "left",
              gap: 0.5,
              p: 1.5,
              borderRadius: 1,
              border: 1,
              borderColor: selected ? "primary.main" : "divider",
              bgcolor: selected ? "action.selected" : "transparent",
              "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" }
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: disabled ? "text.secondary" : "text.primary" }}>
              <LabHostKindIcon kind={choice.kind} />
              <Typography variant="subtitle2">{LAB_HOST_KIND_LABELS[choice.kind]}</Typography>
            </Stack>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {choice.description}
            </Typography>
            {disabled ? (
              <Typography variant="caption" sx={{ color: "warning.main" }}>
                Not available here
              </Typography>
            ) : null}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

const EXPOSE_DEFAULT = "";

interface ClusterForm {
  label: string;
  kubeconfig: string;
  kubeContext: string;
  namespaceMode: "per-lab" | "fixed";
  namespace: string;
  exposeType: "" | C9sExposeType;
  persistence: boolean;
  imagePullSecret: string;
  /** Deploy defaults the lab host's page edits; the form keeps them as they are. */
  deployTimeout: string;
  noTopologyCR: boolean;
}

function formFrom(settings: Partial<ClusterHostSettings> | undefined): ClusterForm {
  return {
    label: settings?.label ?? "",
    kubeconfig: settings?.kubeconfig ?? "",
    kubeContext: settings?.kubeContext ?? "",
    namespaceMode: settings?.namespace ? "fixed" : "per-lab",
    namespace: settings?.namespace ?? "",
    exposeType: settings?.exposeType ?? EXPOSE_DEFAULT,
    persistence: settings?.persistence !== false,
    imagePullSecret: settings?.imagePullSecret ?? "",
    deployTimeout: settings?.deployTimeout ?? "",
    noTopologyCR: settings?.noTopologyCR === true
  };
}

function settingsFrom(form: ClusterForm): ClusterHostSettings {
  const namespace = form.namespaceMode === "fixed" ? form.namespace.trim() : "";
  return {
    kubeContext: form.kubeContext.trim(),
    ...(form.label.trim() ? { label: form.label.trim() } : {}),
    ...(form.kubeconfig.trim() ? { kubeconfig: form.kubeconfig.trim() } : {}),
    ...(namespace ? { namespace } : {}),
    ...(form.exposeType ? { exposeType: form.exposeType } : {}),
    ...(form.persistence ? {} : { persistence: false }),
    ...(form.imagePullSecret.trim() ? { imagePullSecret: form.imagePullSecret.trim() } : {}),
    ...(form.deployTimeout.trim() ? { deployTimeout: form.deployTimeout.trim() } : {}),
    ...(form.noTopologyCR ? { noTopologyCR: true } : {})
  };
}

function namespaceError(form: ClusterForm): string | undefined {
  if (form.namespaceMode !== "fixed") return undefined;
  const name = form.namespace.trim();
  if (!name) return "Enter the namespace";
  return isValidKubeNamespace(name) ? undefined : "Lowercase letters, digits and '-' only";
}

function secretError(form: ClusterForm): string | undefined {
  const name = form.imagePullSecret.trim();
  return name === "" || isValidKubeSecretName(name) ? undefined : "Lowercase letters, digits, '-' and '.' only";
}

function useKubeContexts(support: ClusterHostsSupport, kubeconfig: string, open: boolean) {
  const [state, setState] = useState<{ loading: boolean; list?: KubeconfigContextList; error?: string }>({ loading: false });
  const request = useRef(0);
  // The host may hand a new support object on every update; the contexts depend on the file only.
  const supportRef = useRef(support);
  supportRef.current = support;
  useEffect(() => {
    if (!open) return undefined;
    const id = ++request.current;
    setState((current) => ({ ...current, loading: true }));
    // Typed paths load once typing pauses.
    const timer = setTimeout(() => {
      supportRef.current.listContexts(kubeconfig.trim() || undefined).then(
        (list) => {
          if (request.current === id) setState({ loading: false, list });
        },
        (error: unknown) => {
          if (request.current === id) {
            setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [kubeconfig, open]);
  return state;
}

function saveLabel(saving: boolean, editing: boolean): string {
  if (saving) return "Saving…";
  return editing ? "Save" : "Add lab host";
}

/**
 * Add or edit a Kubernetes cluster lab host: the kubeconfig and context,
 * where labs go, the deploy defaults, and "Check connection" before saving.
 */
export function ClusterHostDialog(props: {
  open: boolean;
  support: ClusterHostsSupport;
  /** The cluster being edited; a new one when unset. */
  editing?: { endpointId: string; settings: ClusterHostSettings };
  onClose: () => void;
  /** After a save. */
  onSaved?: () => void;
  /**
   * Only the connection (name, kubeconfig, context, namespaces): the lab
   * host's page edits its deploy defaults itself. They are kept as they are.
   */
  connectionOnly?: boolean;
}) {
  const { open, support, editing } = props;
  const [form, setForm] = useState<ClusterForm>(() => formFrom(editing?.settings));
  const [checks, setChecks] = useState<LabHostCheck[] | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(formFrom(editing?.settings));
      setChecks(null);
      setError(null);
    }
  }, [open, editing]);
  const contexts = useKubeContexts(support, form.kubeconfig, open);
  const contextList = contexts.list?.contexts ?? [];

  // Pick the file's current context when none is chosen yet, or the chosen one is not in the file.
  useEffect(() => {
    if (!contexts.list || contextList.length === 0) return;
    setForm((current) =>
      contextList.some((context) => context.name === current.kubeContext)
        ? current
        : { ...current, kubeContext: (contextList.find((context) => context.current) ?? contextList[0]).name }
    );
  }, [contexts.list, contextList]);

  const update = <K extends keyof ClusterForm>(key: K, value: ClusterForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setChecks(null);
  };
  const nsError = namespaceError(form);
  const pullSecretError = secretError(form);
  const invalid = !form.kubeContext.trim() || nsError !== undefined || pullSecretError !== undefined;

  const runCheck = async () => {
    setBusy("check");
    setError(null);
    try {
      setChecks(await support.check(settingsFrom(form)));
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await support.save(settingsFrom(form), editing?.endpointId);
      props.onSaved?.();
      props.onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(null);
    }
  };
  const chooseFile = support.chooseKubeconfig
    ? async () => {
        const file = await support.chooseKubeconfig?.();
        if (file) update("kubeconfig", file);
      }
    : undefined;
  const selectedContext = contextList.find((context) => context.name === form.kubeContext);

  return (
    <Dialog open={open} onClose={props.onClose} fullWidth maxWidth="sm" aria-labelledby="cluster-host-dialog-title">
      <DialogTitle id="cluster-host-dialog-title">
        {editing ? `Edit ${editing.settings.label ?? editing.settings.kubeContext}` : "Add Kubernetes lab host"}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.25}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            containerlab on this computer runs the labs on the cluster with clabernetes, using your kubeconfig. The kubeconfig stays on this computer.
          </Typography>
          {error ? <Alert severity="error" variant="outlined">{error}</Alert> : null}
          <TextField
            label="Name"
            value={form.label}
            onChange={(event) => update("label", event.target.value)}
            placeholder={form.kubeContext || "Defaults to the context"}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
            <TextField
              label="kubeconfig file"
              value={form.kubeconfig}
              onChange={(event) => update("kubeconfig", event.target.value)}
              placeholder={support.defaultKubeconfig ?? "~/.kube/config"}
              helperText={form.kubeconfig.trim() ? "This lab host keeps the path." : `Empty: the default, ${support.defaultKubeconfig ?? "KUBECONFIG or ~/.kube/config"}`}
              fullWidth
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { spellCheck: false } }}
            />
            {chooseFile ? (
              <Button variant="outlined" startIcon={<FolderOpenOutlinedIcon />} onClick={() => void chooseFile()} sx={{ flexShrink: 0, mt: "8px" }}>
                Choose file…
              </Button>
            ) : null}
          </Stack>
          <TextField
            select
            label="Context"
            value={contextList.some((context) => context.name === form.kubeContext) ? form.kubeContext : ""}
            onChange={(event) => update("kubeContext", event.target.value)}
            fullWidth
            disabled={contextList.length === 0}
            error={!contexts.loading && contexts.list !== undefined && contextList.length === 0}
            helperText={
              contexts.loading
                ? "Reading the kubeconfig…"
                : contexts.error ?? contexts.list?.error ?? (selectedContext ? `Cluster ${selectedContext.cluster}${selectedContext.namespace ? ` · namespace ${selectedContext.namespace}` : ""}` : " ")
            }
            slotProps={{
              inputLabel: { shrink: true },
              select: {
                renderValue: (value) => {
                  const context = contextList.find((entry) => entry.name === value);
                  return `${String(value)}${context?.current ? "  (current)" : ""}`;
                }
              }
            }}
          >
            {contextList.map((context) => (
              <MenuItem key={context.name} value={context.name}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {context.name}
                    {context.current ? (
                      <Typography component="span" variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
                        current
                      </Typography>
                    ) : null}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
                    cluster {context.cluster}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </TextField>

          <Box>
            <Typography variant="subtitle2">Namespaces</Typography>
            <RadioGroup
              value={form.namespaceMode}
              onChange={(event) => update("namespaceMode", event.target.value as ClusterForm["namespaceMode"])}
            >
              <FormControlLabel
                value="per-lab"
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    One per lab, <Box component="code" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12 }}>c9s-&lt;lab&gt;</Box>
                    <Typography component="span" variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                      Needs the right to create namespaces. Destroy with cleanup deletes the namespace.
                    </Typography>
                  </Typography>
                }
              />
              <FormControlLabel
                value="fixed"
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    One fixed namespace for every lab
                    <Typography component="span" variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                      For accounts that may only use one namespace.
                    </Typography>
                  </Typography>
                }
              />
            </RadioGroup>
            {form.namespaceMode === "fixed" ? (
              <TextField
                label="Namespace"
                value={form.namespace}
                onChange={(event) => update("namespace", event.target.value)}
                error={nsError !== undefined && form.namespace !== ""}
                helperText={nsError ?? " "}
                size="small"
                sx={{ mt: 1, ml: 4, width: "calc(100% - 32px)" }}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { spellCheck: false } }}
              />
            ) : null}
          </Box>

          {props.connectionOnly ? null : (
            <>
          <Typography variant="subtitle2" sx={{ mb: -1 }}>
            Deploy defaults
          </Typography>
          <TextField
            select
            label="Port exposure"
            value={form.exposeType}
            onChange={(event) => update("exposeType", event.target.value as ClusterForm["exposeType"])}
            helperText={form.exposeType ? C9S_EXPOSE_DESCRIPTIONS[form.exposeType] : "As clabernetes is configured."}
            fullWidth
            slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
          >
            <MenuItem value="">clabernetes default</MenuItem>
            {C9S_EXPOSE_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Switch checked={form.persistence} onChange={(event) => update("persistence", event.target.checked)} />}
            label={
              <Typography variant="body2">
                Persistent node storage
                <Typography component="span" variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                  {form.persistence
                    ? "Nodes keep saved configuration and files when their pod is replaced, and across destroy without cleanup."
                    : "Off: every restart starts nodes from their startup config; nothing is kept."}
                </Typography>
              </Typography>
            }
            sx={{ alignItems: "flex-start", ml: 0, "& .MuiSwitch-root": { mt: -0.75 } }}
          />
          <TextField
            label="Image pull secret"
            value={form.imagePullSecret}
            onChange={(event) => update("imagePullSecret", event.target.value)}
            placeholder="None"
            error={pullSecretError !== undefined}
            helperText={
              pullSecretError ??
              (form.namespaceMode === "per-lab"
                ? `Optional: a Secret for private registries. ${PER_LAB_PULL_SECRET_NOTE}`
                : "Optional: a Secret in that namespace for private registries.")
            }
            fullWidth
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { spellCheck: false } }}
          />

            </>
          )}
          <Box>
            <Button
              variant="outlined"
              onClick={() => void runCheck()}
              disabled={busy !== null || !form.kubeContext.trim() || nsError !== undefined}
              startIcon={busy === "check" ? <CircularProgress size={14} /> : undefined}
            >
              {busy === "check" ? "Checking…" : "Check connection"}
            </Button>
            {checks ? (
              <Box sx={{ mt: 1.5 }}>
                <LabHostCheckList checks={checks} />
              </Box>
            ) : null}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={props.onClose}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy !== null || invalid}>
          {saveLabel(busy === "save", editing !== undefined)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
