import { useOptionalWorkspaceHost } from "../WorkspaceHost";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import SpeedOutlinedIcon from "@mui/icons-material/SpeedOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";

import { APP_DOCS_URL,
  ENDPOINT_EXPORT_FILENAME,
  DEFAULT_ENDPOINT_SESSION_DURATION,
  endpointSessionDurationLabel,
  isValidEndpointSessionDuration,
  splitSetupCommand,
  type EndpointConfig,
  type EndpointImportResult,
  type EndpointSessionDuration,
  type LocalEndpointOffer } from "../endpoints";
import {
  formatEndpointHealthPercent,
  formatEndpointHealthUsedTotal,
  type EndpointHealthMetrics
} from "../health";
import type { EndpointUiAction } from "../state/endpointActions";
import { endpointStatusHint, endpointStatusLabel, endpointStatusSeverity } from "../state/endpointStatus";
import { downloadJsonFile, pickJsonFile } from "../../utils/jsonFile";
import { MONO_FONT_FAMILY } from "../../theme/typography";

interface EndpointManagerProps {
  defaultApiUrl: string;
  endpoints: EndpointConfig[];
  externalError?: string | null;
  healthStatsEnabled?: boolean;
  mode?: "initial" | "manage";
  onAddEndpoint: (input: {
    label?: string;
    password: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onExportEndpoints?: () => string;
  onImportEndpoints?: (content: string) => EndpointImportResult | Promise<EndpointImportResult>;
  onReconnectEndpoint: (input: {
    endpointId: string;
    password: string;
    username: string;
  }) => Promise<void>;
  onRemoveEndpoint: (endpointId: string) => Promise<void>;
  onUpdateEndpoint: (input: {
    endpointId: string;
    label: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onRequestedActionHandled?: () => void;
  requestedAction?: EndpointUiAction | null;
  onSetEndpointSessionDuration?: (
    endpointId: string,
    sessionDuration: EndpointSessionDuration
  ) => void;
  /** Offered when the host can run labs on this machine. */
  localEndpoint?: LocalEndpointOffer;
  /** Health stats of a signed-in lab host; the workspace host's when unset. */
  fetchHealthMetrics?: HealthMetricsFetcher;
  /** Signs out of a lab host but keeps it, so the user can sign in again later. */
  onSignOutEndpoint?: (endpointId: string) => Promise<void>;
}

type EndpointHealthState =
  | { status: "loading" }
  | { status: "ready"; metrics: EndpointHealthMetrics }
  | { status: "error"; message: string };

function formatEndpointImportResult(result: EndpointImportResult): string {
  if (result.total === 0) {
    return "No lab host profiles were found in the import file.";
  }

  const parts = [
    result.added ? `${result.added} added` : null,
    result.updated ? `${result.updated} updated` : null,
    result.unchanged ? `${result.unchanged} unchanged` : null,
    result.duplicates
      ? `${result.duplicates} duplicate ${result.duplicates === 1 ? "entry" : "entries"} merged`
      : null
  ].filter((value): value is string => value !== null);

  return `Imported ${result.total} lab host ${result.total === 1 ? "profile" : "profiles"}${
    parts.length > 0 ? `: ${parts.join(", ")}` : ""
  }.`;
}

function addEndpointButtonLabel(busyKey: string | null, mode: "initial" | "manage"): string {
  if (busyKey === "add") {
    return "Signing in...";
  }
  return mode === "initial" ? "Sign in" : "Add lab host";
}

function endpointActionButtonLabel(
  endpoint: EndpointConfig | null | undefined,
  busyKey: string | null,
  action: "edit" | "reconnect" | "remove"
): string {
  const defaultLabels = {
    edit: "Save",
    reconnect: "Sign in",
    remove: "Remove"
  };
  if (!endpoint) {
    return defaultLabels[action];
  }

  const busyLabels = {
    edit: "Saving...",
    reconnect: "Signing in...",
    remove: "Removing..."
  };
  return busyKey === `${action}:${endpoint.id}` ? busyLabels[action] : defaultLabels[action];
}

function endpointAddDescription(mode: "initial" | "manage"): string {
  if (mode === "initial") {
    return "Sign in to clab-api-server on the Linux machine that runs your labs.";
  }
  return "Sign in to clab-api-server on another machine. Its labs appear next to the others.";
}

function showManagedEndpoints(mode: "initial" | "manage", endpointCount: number): boolean {
  return mode === "manage" && endpointCount > 0;
}

function EndpointHealthMetric(props: {
  detail: string;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: "flex-start",
        minWidth: 0,
        flex: 1
      }}
    >
      <Box sx={{ color: "text.secondary", display: "inline-flex", flexShrink: 0, mt: "1px" }}>
        {props.icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            display: "block"
          }}
        >
          {props.label}
        </Typography>
        <Typography variant="subtitle2" noWrap>
          {props.value}
        </Typography>
        <Typography
          variant="caption"
          noWrap
          sx={{
            color: "text.secondary",
            display: "block"
          }}
        >
          {props.detail}
        </Typography>
      </Box>
    </Stack>
  );
}

function EndpointHealthReady(props: { metrics: EndpointHealthMetrics }) {
  const { cpu, mem, disk } = props.metrics.metrics;
  const diskDetail = `${formatEndpointHealthUsedTotal(disk?.usedDisk, disk?.totalDisk)}${
    disk?.path ? ` on ${disk.path}` : ""
  }`;

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
      <EndpointHealthMetric
        icon={<SpeedOutlinedIcon sx={{ fontSize: 16 }} />}
        label="CPU"
        value={formatEndpointHealthPercent(cpu?.usagePercent)}
        detail={cpu?.numCPU ? `${cpu.numCPU} cores` : "cores n/a"}
      />
      <EndpointHealthMetric
        icon={<MemoryOutlinedIcon sx={{ fontSize: 16 }} />}
        label="Memory"
        value={formatEndpointHealthPercent(mem?.usagePercent)}
        detail={formatEndpointHealthUsedTotal(mem?.usedMem, mem?.totalMem)}
      />
      <EndpointHealthMetric
        icon={<StorageOutlinedIcon sx={{ fontSize: 16 }} />}
        label="Disk"
        value={formatEndpointHealthPercent(disk?.usagePercent)}
        detail={diskDetail}
      />
    </Stack>
  );
}

function EndpointHealthStats(props: { endpoint: EndpointConfig; state?: EndpointHealthState }) {
  const { endpoint, state } = props;

  if (endpoint.status !== "connected") {
    return (
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          display: "block"
        }}
      >
        Sign in to see health stats.
      </Typography>
    );
  }

  if (!state || state.status === "loading") {
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center"
        }}
      >
        <CircularProgress size={14} />
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary"
          }}
        >
          Loading health stats...
        </Typography>
      </Stack>
    );
  }

  if (state.status === "error") {
    return (
      <Typography
        variant="caption"
        sx={{
          color: "warning.main",
          display: "block"
        }}
      >
        Health stats unavailable.
      </Typography>
    );
  }

  return <EndpointHealthReady metrics={state.metrics} />;
}

function EndpointStatusPill(props: { status: EndpointConfig["status"] }) {
  const { status } = props;
  const severity = endpointStatusSeverity(status);

  return (
    <Box
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        flexShrink: 0,
        height: 20,
        px: 1,
        borderRadius: 999,
        bgcolor: `color-mix(in srgb, ${theme.palette[severity].main} 14%, transparent)`,
        color: "text.primary"
      })}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          bgcolor: `${severity}.main`,
          flexShrink: 0
        }}
      />
      <Typography variant="caption" sx={{ fontWeight: 500, color: "inherit", lineHeight: 1 }}>
        {endpointStatusLabel(status)}
      </Typography>
    </Box>
  );
}

function endpointSessionDurationDraft(
  drafts: Record<string, EndpointSessionDuration>,
  endpoint: EndpointConfig
): EndpointSessionDuration {
  return drafts[endpoint.id] ?? endpoint.sessionDuration;
}

function endpointDurationHasChanges(
  drafts: Record<string, EndpointSessionDuration>,
  endpoint: EndpointConfig
): boolean {
  return endpointSessionDurationDraft(drafts, endpoint).trim() !== endpoint.sessionDuration;
}

function ManagedEndpointList(props: {
  busyKey: string | null;
  endpointHealth: Record<string, EndpointHealthState>;
  endpoints: EndpointConfig[];
  healthStatsEnabled: boolean;
  localEndpoint?: LocalEndpointOffer;
  onDraftChange: (endpointId: string, nextValue: EndpointSessionDuration) => void;
  onEdit: (endpoint: EndpointConfig) => void;
  onReconnect: (endpoint: EndpointConfig) => void;
  onRemove: (endpoint: EndpointConfig) => void;
  onSignOut?: (endpoint: EndpointConfig) => void;
  onSetEndpointSessionDuration?: (
    endpointId: string,
    sessionDuration: EndpointSessionDuration
  ) => void;
  sessionDurationDrafts: Record<string, EndpointSessionDuration>;
}) {
  return (
    <Stack spacing={1.25}>
      {props.endpoints.map((endpoint) => {
        const durationDraft = endpointSessionDurationDraft(props.sessionDurationDrafts, endpoint);
        const durationValid = isValidEndpointSessionDuration(durationDraft);
        const saveDurationDisabled =
          props.busyKey !== null ||
          !props.onSetEndpointSessionDuration ||
          !durationValid ||
          !endpointDurationHasChanges(props.sessionDurationDrafts, endpoint);

        return (
          <Paper
            key={endpoint.id}
            variant="outlined"
            sx={{
              p: 2,
              borderColor: "divider",
              bgcolor: "background.paper"
            }}
          >
            <Stack spacing={1.5} divider={<Divider flexItem />}>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  justifyContent: "space-between",
                  alignItems: "flex-start"
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: "center"
                    }}
                  >
                    <Typography variant="subtitle1" noWrap>
                      {endpoint.label}
                    </Typography>
                    <EndpointStatusPill status={endpoint.status} />
                  </Stack>
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{
                      color: "text.secondary",
                      fontFamily: endpoint.kind === "local" ? undefined : MONO_FONT_FAMILY,
                      display: "block",
                      mt: 0.25
                    }}
                  >
                    {endpoint.kind === "local"
                      ? `Runs labs as ${endpoint.username}, without signing in`
                      : endpoint.url}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      display: "block"
                    }}
                  >
                    {endpoint.kind === "local"
                      ? localStatusHint(endpoint.status, props.localEndpoint)
                      : endpointStatusHint(endpoint.status)}
                  </Typography>
                  {endpoint.kind === "local" &&
                  endpoint.status !== "connected" &&
                  props.localEndpoint &&
                  props.localEndpoint.problems.length > 0 ? (
                    <LocalProblems problems={props.localEndpoint.problems} setupUrl={props.localEndpoint.setupUrl} />
                  ) : null}
                </Box>
                <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0, mt: -0.5, mr: -0.75 }}>
                  {endpoint.kind === "local" ? null : (
                    <IconButton
                      size="small"
                      onClick={() => props.onEdit(endpoint)}
                      aria-label={`Edit ${endpoint.label}`}
                      title="Edit"
                      disabled={props.busyKey !== null}
                    >
                      <EditOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  )}
                  <IconButton
                    size="small"
                    onClick={() => props.onReconnect(endpoint)}
                    aria-label={endpoint.kind === "local" ? `Check ${endpoint.label} again` : `Sign in to ${endpoint.label} again`}
                    title={endpoint.kind === "local" ? "Check again" : "Sign in again"}
                    disabled={props.busyKey !== null}
                  >
                    <RefreshIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  {props.onSignOut && endpoint.kind !== "local" && endpoint.status === "connected" ? (
                    <IconButton
                      size="small"
                      onClick={() => props.onSignOut?.(endpoint)}
                      aria-label={`Sign out of ${endpoint.label}`}
                      title="Sign out"
                      disabled={props.busyKey !== null}
                    >
                      <LogoutOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  ) : null}
                  <IconButton
                    size="small"
                    onClick={() => props.onRemove(endpoint)}
                    aria-label={`Remove ${endpoint.label}`}
                    title="Remove"
                    disabled={props.busyKey !== null}
                    sx={{ "&:hover": { color: "error.main" } }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Stack>
              </Stack>
              {props.healthStatsEnabled ? (
                <EndpointHealthStats
                  endpoint={endpoint}
                  state={props.endpointHealth[endpoint.id]}
                />
              ) : null}
              {endpoint.kind === "local" ? null : (
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{
                    alignItems: { xs: "stretch", sm: "flex-start" }
                  }}
                >
                  <TextField
                    label="Stay signed in for"
                    size="small"
                    value={durationDraft}
                    onChange={(event) => props.onDraftChange(endpoint.id, event.target.value)}
                    error={Boolean(durationDraft.trim()) && !durationValid}
                    helperText={
                      durationValid
                        ? "Examples: 24h, 36h, 7d, 1h30m"
                        : "Use values like 24h, 36h, 7d, or 1h30m"
                    }
                    placeholder="24h"
                    disabled={props.busyKey !== null}
                    sx={{ flex: 1, mt: 0.5 }}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <Button
                    variant="outlined"
                    disabled={saveDurationDisabled}
                    onClick={() =>
                      props.onSetEndpointSessionDuration?.(endpoint.id, durationDraft.trim())
                    }
                    sx={{
                      mt: { sm: 0.5 },
                      alignSelf: { xs: "stretch", sm: "flex-start" }
                    }}
                  >
                    Save
                  </Button>
                </Stack>
              )}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}

function localStatusHint(status: EndpointConfig["status"], offer: LocalEndpointOffer | undefined): string {
  if (status === "connected") {
    const version = offer?.containerlabVersion ?? "";
    return version === "" ? "containerlab is ready." : `containerlab ${version} is ready.`;
  }
  return "containerlab does not answer right now.";
}

function LocalProblems(props: { problems: string[]; setupUrl?: string }) {
  return (
    <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
      <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
        {props.problems.map((problem) => {
          const { before, command, after } = splitSetupCommand(problem);
          return (
            <li key={problem}>
              {before}
              {command !== undefined ? (
                <Box component="code" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12, overflowWrap: "anywhere" }}>
                  {command}
                </Box>
              ) : null}
              {after}
            </li>
          );
        })}
      </Stack>
      <Link href={props.setupUrl ?? `${APP_DOCS_URL}install/desktop/#run-labs-on-this-computer`} target="_blank" rel="noreferrer" sx={{ display: "inline-block", mt: 1 }}>
        Setup guide
      </Link>
    </Alert>
  );
}

/** Runs labs with containerlab on this machine instead of a clab-api-server. */
function LocalEndpointCard(props: {
  busy: boolean;
  offer: LocalEndpointOffer;
  onAdd: () => void;
  onCheckAgain: () => void;
  variant: "initial" | "manage";
}) {
  const { offer } = props;
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, borderColor: "divider", bgcolor: "background.paper" }}
      data-testid="standalone-local-endpoint"
    >
      <Stack spacing={1.25}>
        <Box>
          <Typography variant="subtitle1">{offer.label ?? "This computer"}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
            {offer.available
              ? "Run labs with containerlab on the machine this app runs on, next to your lab hosts. No sign-in needed."
              : "Containerlab cannot run labs on the machine this app runs on yet."}
          </Typography>
        </Box>
        {offer.available ? null : <LocalProblems problems={offer.problems} setupUrl={offer.setupUrl} />}
        <Stack direction="row" spacing={1}>
          {offer.available ? (
            <Button
              variant={props.variant === "initial" ? "contained" : "outlined"}
              onClick={props.onAdd}
              disabled={props.busy}
              sx={{ alignSelf: props.variant === "initial" ? "stretch" : "flex-start" }}
              data-testid="standalone-local-endpoint-add"
            >
              {offer.addLabel ?? "Use this computer"}
            </Button>
          ) : null}
          {!offer.available && offer.onCheckAgain ? (
            <Button
              variant="outlined"
              onClick={props.onCheckAgain}
              disabled={props.busy}
              startIcon={<RefreshIcon />}
              data-testid="standalone-local-endpoint-check"
            >
              Check again
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </Paper>
  );
}

function useEndpointSessionDurationDrafts(sortedEndpoints: EndpointConfig[]) {
  const [drafts, setDrafts] = useState<Record<string, EndpointSessionDuration>>({});

  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, EndpointSessionDuration> = {};
      for (const endpoint of sortedEndpoints) {
        next[endpoint.id] = current[endpoint.id] ?? endpoint.sessionDuration;
      }
      return next;
    });
  }, [sortedEndpoints]);

  const handleDraftChange = useCallback(
    (endpointId: string, nextValue: EndpointSessionDuration) => {
      setDrafts((current) => ({
        ...current,
        [endpointId]: nextValue
      }));
    },
    []
  );

  return { drafts, handleDraftChange };
}

type HealthMetricsFetcher = (endpointId: string, signal?: AbortSignal) => Promise<EndpointHealthMetrics>;

function useEndpointHealthState(
  connectedEndpointIds: string[],
  connectedEndpointKey: string,
  healthStatsEnabled: boolean,
  fetchHealthMetrics: HealthMetricsFetcher | undefined
): Record<string, EndpointHealthState> {
  const host = useOptionalWorkspaceHost();
  const fetchEndpointHealthMetrics = fetchHealthMetrics ?? host?.api.fetchEndpointHealthMetrics;
  const [endpointHealth, setEndpointHealth] = useState<Record<string, EndpointHealthState>>({});

  useEffect(() => {
    if (!healthStatsEnabled || connectedEndpointIds.length === 0 || !fetchEndpointHealthMetrics) {
      return;
    }

    const controller = new AbortController();
    setEndpointHealth((current) => {
      const next = { ...current };
      for (const endpointId of connectedEndpointIds) {
        next[endpointId] = { status: "loading" };
      }
      return next;
    });

    for (const endpointId of connectedEndpointIds) {
      void fetchEndpointHealthMetrics(endpointId, controller.signal)
        .then((metrics) => {
          setEndpointHealth((current) => ({
            ...current,
            [endpointId]: { status: "ready", metrics }
          }));
        })
        .catch((loadError) => {
          if (controller.signal.aborted) {
            return;
          }
          setEndpointHealth((current) => ({
            ...current,
            [endpointId]: {
              status: "error",
              message:
                loadError instanceof Error
                  ? loadError.message
                  : "Failed to load health stats"
            }
          }));
        });
    }

    return () => controller.abort();
  }, [connectedEndpointIds, connectedEndpointKey, healthStatsEnabled, fetchEndpointHealthMetrics]);

  return endpointHealth;
}

function useRequestedEndpointActionDialog(input: {
  /** Checks a local endpoint again; it has no credentials to ask for. */
  onReconnectLocal: (endpoint: EndpointConfig) => void;
  onRequestedActionHandled?: () => void;
  requestedAction?: EndpointUiAction | null;
  setError: (message: string | null) => void;
  setReconnectEndpointId: (endpointId: string | null) => void;
  setReconnectPassword: (password: string) => void;
  setReconnectUsername: (username: string) => void;
  setRemoveEndpointId: (endpointId: string | null) => void;
  sortedEndpoints: EndpointConfig[];
}): void {
  useEffect(() => {
    const {
      onReconnectLocal,
      onRequestedActionHandled,
      requestedAction,
      setError,
      setReconnectEndpointId,
      setReconnectPassword,
      setReconnectUsername,
      setRemoveEndpointId,
      sortedEndpoints
    } = input;
    if (!requestedAction || requestedAction.action === "add") {
      return;
    }

    const endpoint =
      sortedEndpoints.find((entry) => entry.id === requestedAction.endpointId) ?? null;
    if (!endpoint) {
      onRequestedActionHandled?.();
      return;
    }

    setError(null);
    if (requestedAction.action === "reconnect" && endpoint.kind === "local") {
      onReconnectLocal(endpoint);
    } else if (requestedAction.action === "reconnect") {
      setReconnectEndpointId(endpoint.id);
      setReconnectUsername(endpoint.username);
      setReconnectPassword("");
    } else {
      setRemoveEndpointId(endpoint.id);
    }
    onRequestedActionHandled?.();
  }, [
    input.onReconnectLocal,
    input.onRequestedActionHandled,
    input.requestedAction,
    input.setError,
    input.setReconnectEndpointId,
    input.setReconnectPassword,
    input.setReconnectUsername,
    input.setRemoveEndpointId,
    input.sortedEndpoints
  ]);
}

function useAddEndpointForm(
  defaultApiUrl: string,
  busyKey: string | null,
  onAddEndpoint: EndpointManagerProps["onAddEndpoint"],
  setBusyKey: (busyKey: string | null) => void,
  setError: (message: string | null) => void
) {
  const [url, setUrl] = useState(defaultApiUrl);
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sessionDuration, setSessionDuration] = useState<EndpointSessionDuration>(
    DEFAULT_ENDPOINT_SESSION_DURATION
  );

  useEffect(() => {
    if (!url.trim() && defaultApiUrl.trim()) {
      setUrl(defaultApiUrl);
    }
  }, [defaultApiUrl, url]);

  const sessionDurationValid = isValidEndpointSessionDuration(sessionDuration);
  const submitDisabled =
    busyKey !== null ||
    !url.trim() ||
    !username.trim() ||
    !password.trim() ||
    !sessionDurationValid;

  const submit = useCallback(async () => {
    if (submitDisabled) {
      return;
    }

    setBusyKey("add");
    setError(null);
    try {
      await onAddEndpoint({
        url: url.trim(),
        label: label.trim() || undefined,
        username: username.trim(),
        password,
        sessionDuration
      });
      setLabel("");
      setPassword("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
    } finally {
      setBusyKey(null);
    }
  }, [
    label,
    onAddEndpoint,
    password,
    sessionDuration,
    setBusyKey,
    setError,
    submitDisabled,
    url,
    username
  ]);

  return {
    label,
    password,
    sessionDuration,
    sessionDurationValid,
    setLabel,
    setPassword,
    setSessionDuration,
    setUrl,
    setUsername,
    submit,
    submitDisabled,
    url,
    username
  };
}

function useReconnectEndpointDialog(
  busyKey: string | null,
  onReconnectEndpoint: EndpointManagerProps["onReconnectEndpoint"],
  setBusyKey: (busyKey: string | null) => void,
  setError: (message: string | null) => void,
  sortedEndpoints: EndpointConfig[]
) {
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const endpoint = useMemo(
    () => sortedEndpoints.find((entry) => entry.id === endpointId) ?? null,
    [endpointId, sortedEndpoints]
  );
  const submitDisabled = busyKey !== null || !username.trim() || !password.trim();

  const open = useCallback(
    (nextEndpoint: EndpointConfig) => {
      setEndpointId(nextEndpoint.id);
      setUsername(nextEndpoint.username);
      setPassword("");
      setError(null);
    },
    [setError]
  );

  const submit = useCallback(async () => {
    if (!endpoint || submitDisabled) {
      return;
    }

    setBusyKey(`reconnect:${endpoint.id}`);
    setError(null);
    try {
      await onReconnectEndpoint({
        endpointId: endpoint.id,
        username: username.trim(),
        password
      });
      setEndpointId(null);
      setPassword("");
    } catch (reconnectError) {
      setError(reconnectError instanceof Error ? reconnectError.message : String(reconnectError));
    } finally {
      setBusyKey(null);
    }
  }, [endpoint, onReconnectEndpoint, password, setBusyKey, setError, submitDisabled, username]);

  return {
    endpoint,
    open,
    password,
    setEndpointId,
    setPassword,
    setUsername,
    submit,
    submitDisabled,
    username
  };
}

function useRemoveEndpointDialog(
  busyKey: string | null,
  onRemoveEndpoint: EndpointManagerProps["onRemoveEndpoint"],
  setBusyKey: (busyKey: string | null) => void,
  setError: (message: string | null) => void,
  sortedEndpoints: EndpointConfig[]
) {
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const endpoint = useMemo(
    () => sortedEndpoints.find((entry) => entry.id === endpointId) ?? null,
    [endpointId, sortedEndpoints]
  );

  const open = useCallback(
    (nextEndpoint: EndpointConfig) => {
      setEndpointId(nextEndpoint.id);
      setError(null);
    },
    [setError]
  );

  const submit = useCallback(async () => {
    if (!endpoint) {
      return;
    }

    setBusyKey(`remove:${endpoint.id}`);
    setError(null);
    try {
      await onRemoveEndpoint(endpoint.id);
      setEndpointId(null);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setBusyKey(null);
    }
  }, [endpoint, onRemoveEndpoint, setBusyKey, setError]);

  return {
    endpoint,
    open,
    setEndpointId,
    submitDisabled: busyKey !== null,
    submit
  };
}

function useEditEndpointDialog(
  busyKey: string | null,
  onUpdateEndpoint: EndpointManagerProps["onUpdateEndpoint"],
  setBusyKey: (busyKey: string | null) => void,
  setError: (message: string | null) => void,
  sortedEndpoints: EndpointConfig[]
) {
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [sessionDuration, setSessionDuration] = useState<EndpointSessionDuration>(
    DEFAULT_ENDPOINT_SESSION_DURATION
  );
  const endpoint = useMemo(
    () => sortedEndpoints.find((entry) => entry.id === endpointId) ?? null,
    [endpointId, sortedEndpoints]
  );
  const sessionDurationValid = isValidEndpointSessionDuration(sessionDuration);
  const hasChanges = endpoint
    ? url.trim() !== endpoint.url ||
      label.trim() !== endpoint.label ||
      username.trim() !== endpoint.username ||
      sessionDuration.trim() !== endpoint.sessionDuration
    : false;
  const submitDisabled =
    busyKey !== null ||
    !url.trim() ||
    !label.trim() ||
    !username.trim() ||
    !sessionDurationValid ||
    !hasChanges;

  const open = useCallback(
    (nextEndpoint: EndpointConfig) => {
      setEndpointId(nextEndpoint.id);
      setUrl(nextEndpoint.url);
      setLabel(nextEndpoint.label);
      setUsername(nextEndpoint.username);
      setSessionDuration(nextEndpoint.sessionDuration);
      setError(null);
    },
    [setError]
  );

  const submit = useCallback(async () => {
    if (!endpoint || submitDisabled) {
      return;
    }

    setBusyKey(`edit:${endpoint.id}`);
    setError(null);
    try {
      await onUpdateEndpoint({
        endpointId: endpoint.id,
        label: label.trim(),
        sessionDuration: sessionDuration.trim(),
        url: url.trim(),
        username: username.trim()
      });
      setEndpointId(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setBusyKey(null);
    }
  }, [
    endpoint,
    label,
    onUpdateEndpoint,
    sessionDuration,
    setBusyKey,
    setError,
    submitDisabled,
    url,
    username
  ]);

  return {
    endpoint,
    label,
    open,
    sessionDuration,
    sessionDurationValid,
    setEndpointId,
    setLabel,
    setSessionDuration,
    setUrl,
    setUsername,
    submit,
    submitDisabled,
    url,
    username
  };
}

export function EndpointManager({
  defaultApiUrl,
  endpoints,
  externalError,
  healthStatsEnabled = false,
  mode = "manage",
  onAddEndpoint,
  onExportEndpoints,
  onImportEndpoints,
  onReconnectEndpoint,
  onRemoveEndpoint,
  onUpdateEndpoint,
  onRequestedActionHandled,
  requestedAction,
  onSetEndpointSessionDuration,
  localEndpoint,
  fetchHealthMetrics,
  onSignOutEndpoint
}: EndpointManagerProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The app's own machine first, then the lab hosts by name.
  const sortedEndpoints = useMemo(
    () =>
      [...endpoints].sort(
        (left, right) =>
          Number(right.kind === "local") - Number(left.kind === "local") ||
          left.label.localeCompare(right.label)
      ),
    [endpoints]
  );
  const connectedEndpointIds = useMemo(
    () =>
      sortedEndpoints
        .filter((endpoint) => endpoint.status === "connected")
        .map((endpoint) => endpoint.id),
    [sortedEndpoints]
  );
  const connectedEndpointKey = connectedEndpointIds.join("|");
  const endpointHealth = useEndpointHealthState(
    connectedEndpointIds,
    connectedEndpointKey,
    healthStatsEnabled,
    fetchHealthMetrics
  );
  const {
    drafts: endpointSessionDurationDrafts,
    handleDraftChange: handleEndpointDurationDraftChange
  } = useEndpointSessionDurationDrafts(sortedEndpoints);
  const visibleError = error ?? externalError ?? null;
  const addForm = useAddEndpointForm(defaultApiUrl, busyKey, onAddEndpoint, setBusyKey, setError);
  const reconnectDialog = useReconnectEndpointDialog(
    busyKey,
    onReconnectEndpoint,
    setBusyKey,
    setError,
    sortedEndpoints
  );
  const removeDialog = useRemoveEndpointDialog(
    busyKey,
    onRemoveEndpoint,
    setBusyKey,
    setError,
    sortedEndpoints
  );
  const editDialog = useEditEndpointDialog(
    busyKey,
    onUpdateEndpoint,
    setBusyKey,
    setError,
    sortedEndpoints
  );

  const reconnectLocal = useCallback(
    (endpoint: EndpointConfig) => {
      if (busyKey !== null) return;
      setBusyKey(`reconnect:${endpoint.id}`);
      setError(null);
      onReconnectEndpoint({ endpointId: endpoint.id, username: endpoint.username, password: "" })
        .catch((reconnectError: unknown) => {
          setError(reconnectError instanceof Error ? reconnectError.message : String(reconnectError));
        })
        .finally(() => setBusyKey(null));
    },
    [busyKey, onReconnectEndpoint]
  );
  const runAction = useCallback(
    (key: string, action: (() => Promise<void>) | undefined) => {
      if (!action || busyKey !== null) return;
      setBusyKey(key);
      setError(null);
      action()
        .catch((actionError: unknown) => {
          setError(actionError instanceof Error ? actionError.message : String(actionError));
        })
        .finally(() => setBusyKey(null));
    },
    [busyKey]
  );
  const offerLocalEndpoint =
    localEndpoint !== undefined && !sortedEndpoints.some((endpoint) => endpoint.kind === "local");

  useRequestedEndpointActionDialog({
    onReconnectLocal: reconnectLocal,
    onRequestedActionHandled,
    requestedAction,
    setError,
    setReconnectEndpointId: reconnectDialog.setEndpointId,
    setReconnectPassword: reconnectDialog.setPassword,
    setReconnectUsername: reconnectDialog.setUsername,
    setRemoveEndpointId: removeDialog.setEndpointId,
    sortedEndpoints
  });

  const handleExportEndpoints = useCallback(() => {
    if (!onExportEndpoints) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      downloadJsonFile(ENDPOINT_EXPORT_FILENAME, onExportEndpoints());
      setNotice(
        `Exported ${sortedEndpoints.length} lab host ${sortedEndpoints.length === 1 ? "profile" : "profiles"}.`
      );
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  }, [onExportEndpoints, sortedEndpoints.length]);

  const handleImportEndpoints = useCallback(async () => {
    if (!onImportEndpoints || busyKey !== null) {
      return;
    }

    setBusyKey("import");
    setError(null);
    setNotice(null);
    try {
      const file = await pickJsonFile();
      if (!file) {
        return;
      }
      const result = await onImportEndpoints(await file.text());
      setNotice(formatEndpointImportResult(result));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, onImportEndpoints]);

  const transferActions = onImportEndpoints || onExportEndpoints ? (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        justifyContent: "flex-end",
        flexWrap: "wrap"
      }}
    >
      {onImportEndpoints ? (
        <Button
          variant={mode === "initial" ? "text" : "outlined"}
          size="small"
          startIcon={<FileUploadOutlinedIcon />}
          onClick={() => {
            void handleImportEndpoints();
          }}
          disabled={busyKey !== null}
          data-testid="standalone-endpoints-import"
        >
          {busyKey === "import" ? "Importing..." : "Import"}
        </Button>
      ) : null}
      {onExportEndpoints ? (
        <Button
          variant={mode === "initial" ? "text" : "outlined"}
          size="small"
          startIcon={<FileDownloadOutlinedIcon />}
          onClick={handleExportEndpoints}
          disabled={busyKey !== null || sortedEndpoints.length === 0}
          data-testid="standalone-endpoints-export"
        >
          Export
        </Button>
      ) : null}
    </Stack>
  ) : null;

  return (
    <Stack spacing={2.5}>
      {mode === "manage" ? transferActions : null}

      {showManagedEndpoints(mode, sortedEndpoints.length) ? (
        <ManagedEndpointList
          busyKey={busyKey}
          endpointHealth={endpointHealth}
          endpoints={sortedEndpoints}
          healthStatsEnabled={healthStatsEnabled}
          localEndpoint={localEndpoint}
          onDraftChange={handleEndpointDurationDraftChange}
          onEdit={editDialog.open}
          onReconnect={(endpoint) =>
            endpoint.kind === "local" ? reconnectLocal(endpoint) : reconnectDialog.open(endpoint)
          }
          onRemove={removeDialog.open}
          onSignOut={
            onSignOutEndpoint
              ? (endpoint) => runAction(`signout:${endpoint.id}`, () => onSignOutEndpoint(endpoint.id))
              : undefined
          }
          onSetEndpointSessionDuration={onSetEndpointSessionDuration}
          sessionDurationDrafts={endpointSessionDurationDrafts}
        />
      ) : null}

      {offerLocalEndpoint ? (
        <LocalEndpointCard
          busy={busyKey !== null}
          offer={localEndpoint}
          onAdd={() => runAction("add-local", localEndpoint.onAdd)}
          onCheckAgain={() => runAction("check-local", localEndpoint.onCheckAgain)}
          variant={mode}
        />
      ) : null}

      {/* On the login card the form is the card's content; in settings it is one card among the endpoints. */}
      <Paper
        variant="outlined"
        sx={mode === "initial" ? {
          p: 0,
          border: 0,
          bgcolor: "transparent"
        } : {
          p: 2,
          borderColor: "divider",
          bgcolor: "background.paper"
        }}
      >
        <Stack spacing={2.5}>
          <Box sx={mode === "initial" ? { textAlign: "center" } : undefined}>
            <Typography
              variant="subtitle1"
              sx={mode === "initial" ? { fontSize: 18, letterSpacing: "-0.01em" } : undefined}
            >
              {mode === "initial" ? "Sign in to a lab host" : "Add a lab host"}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mt: mode === "initial" ? 0.75 : 0.25
              }}
            >
              {endpointAddDescription(mode)}
            </Typography>
          </Box>

          {visibleError ? (
            <Alert severity="error" variant="outlined">
              {visibleError}
            </Alert>
          ) : null}
          {notice ? (
            <Alert severity="success" variant="outlined">
              {notice}
            </Alert>
          ) : null}

          <Stack spacing={2}>
            <TextField
              label="Lab host URL"
              value={addForm.url}
              onChange={(event) => addForm.setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              fullWidth
              placeholder="https://localhost:8090"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Name"
              value={addForm.label}
              onChange={(event) => addForm.setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              fullWidth
              placeholder="Optional, defaults to the host name"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Username"
              value={addForm.username}
              onChange={(event) => addForm.setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Password"
              type="password"
              value={addForm.password}
              onChange={(event) => addForm.setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Stay signed in for"
              value={addForm.sessionDuration}
              onChange={(event) => addForm.setSessionDuration(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addForm.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void addForm.submit();
              }}
              fullWidth
              placeholder="24h"
              error={Boolean(addForm.sessionDuration.trim()) && !addForm.sessionDurationValid}
              helperText={
                addForm.sessionDurationValid
                  ? "Examples: 24h, 36h, 7d, 1h30m"
                  : "Use values like 24h, 36h, 7d, or 1h30m"
              }
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Stack>

          <Button
            variant="contained"
            onClick={() => {
              void addForm.submit();
            }}
            disabled={addForm.submitDisabled}
            sx={{ alignSelf: mode === "initial" ? "stretch" : "flex-start" }}
          >
            {addEndpointButtonLabel(busyKey, mode)}
          </Button>
        </Stack>
      </Paper>

      {mode === "initial" && transferActions ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", pt: 1.5, borderTop: 1, borderColor: "divider" }}
        >
          <Typography variant="body2" sx={{ flex: 1, color: "text.secondary" }}>
            Lab host profiles
          </Typography>
          {transferActions}
        </Stack>
      ) : null}

      <Dialog
        open={Boolean(editDialog.endpoint)}
        onClose={() => editDialog.setEndpointId(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit Lab Host</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              label="Name"
              value={editDialog.label}
              onChange={(event) => editDialog.setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || editDialog.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void editDialog.submit();
              }}
              fullWidth
            />
            <TextField
              label="Lab host URL"
              value={editDialog.url}
              onChange={(event) => editDialog.setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || editDialog.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void editDialog.submit();
              }}
              fullWidth
            />
            <TextField
              label="Username"
              value={editDialog.username}
              onChange={(event) => editDialog.setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || editDialog.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void editDialog.submit();
              }}
              fullWidth
            />
            <TextField
              label="Stay signed in for"
              value={editDialog.sessionDuration}
              onChange={(event) => editDialog.setSessionDuration(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || editDialog.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void editDialog.submit();
              }}
              fullWidth
              placeholder="24h"
              error={Boolean(editDialog.sessionDuration.trim()) && !editDialog.sessionDurationValid}
              helperText={
                editDialog.sessionDurationValid
                  ? "Examples: 24h, 36h, 7d, 1h30m"
                  : "Use values like 24h, 36h, 7d, or 1h30m"
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => editDialog.setEndpointId(null)}>Cancel</Button>
          <Button
            onClick={() => {
              void editDialog.submit();
            }}
            variant="contained"
            disabled={editDialog.submitDisabled}
          >
            {endpointActionButtonLabel(editDialog.endpoint, busyKey, "edit")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(reconnectDialog.endpoint)}
        onClose={() => reconnectDialog.setEndpointId(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{reconnectDialog.endpoint ? `Sign in to ${reconnectDialog.endpoint.label}` : "Sign In"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {reconnectDialog.endpoint ? (
              <>
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary"
                  }}
                >
                  {`Sign in to clab-api-server at ${reconnectDialog.endpoint.url} with your Linux account on that host.`}
                </Typography>
                {reconnectDialog.endpoint.status === "session_expired" ||
                reconnectDialog.endpoint.status === "offline" ? (
                  <Alert
                    severity={endpointStatusSeverity(reconnectDialog.endpoint.status)}
                    variant="outlined"
                  >
                    {endpointStatusHint(reconnectDialog.endpoint.status)}
                  </Alert>
                ) : null}
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary"
                  }}
                >
                  Stay signed in for:{" "}
                  {endpointSessionDurationLabel(reconnectDialog.endpoint.sessionDuration)}
                </Typography>
              </>
            ) : null}
            <TextField
              label="Username"
              value={reconnectDialog.username}
              onChange={(event) => reconnectDialog.setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || reconnectDialog.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void reconnectDialog.submit();
              }}
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={reconnectDialog.password}
              onChange={(event) => reconnectDialog.setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || reconnectDialog.submitDisabled) {
                  return;
                }
                event.preventDefault();
                void reconnectDialog.submit();
              }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => reconnectDialog.setEndpointId(null)}>Cancel</Button>
          <Button
            onClick={() => {
              void reconnectDialog.submit();
            }}
            variant="contained"
            disabled={reconnectDialog.submitDisabled}
          >
            {endpointActionButtonLabel(reconnectDialog.endpoint, busyKey, "reconnect")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(removeDialog.endpoint)}
        onClose={() => removeDialog.setEndpointId(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {removeDialog.endpoint?.kind === "local" ? `Hide ${removeDialog.endpoint.label}` : "Remove Lab Host"}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2">
              {removeDialog.endpoint?.kind === "local"
                ? "Stop showing labs on this computer?"
                : `Remove "${removeDialog.endpoint?.label ?? "lab host"}"?`}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {removeDialog.endpoint?.kind === "local"
                ? `Running labs keep running. ${localEndpoint?.addLabel ?? "Use this computer"} brings them back.`
                : "Its labs keep running on the host. Open topologies and terminals from it close."}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => removeDialog.setEndpointId(null)}>Cancel</Button>
          <Button
            onClick={() => {
              void removeDialog.submit();
            }}
            color="error"
            variant="contained"
            disabled={removeDialog.submitDisabled}
          >
            {endpointActionButtonLabel(removeDialog.endpoint, busyKey, "remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
