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
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MemoryIcon from "@mui/icons-material/Memory";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import SpeedIcon from "@mui/icons-material/Speed";
import StorageIcon from "@mui/icons-material/Storage";

import {
  formatEndpointHealthPercent,
  formatEndpointHealthUsedTotal,
  type EndpointHealthMetrics
} from "../endpointHealth";
import type { EndpointUiAction } from "../endpointActions";
import {
  endpointStatusHint,
  endpointStatusLabel,
  endpointStatusSeverity
} from "../endpointStatus";
import {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  endpointSessionDurationLabel,
  isValidEndpointSessionDuration,
  type EndpointConfig,
  type EndpointSessionDuration
} from "../stores/endpointStore";

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
}

type EndpointHealthState =
  | { status: "loading" }
  | { status: "ready"; metrics: EndpointHealthMetrics }
  | { status: "error"; message: string };

async function readEndpointHealthError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown; message?: unknown };
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return payload.error;
  }
  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }
  return `Health stats request failed (${response.status})`;
}

async function fetchEndpointHealthMetrics(
  endpointId: string,
  signal: AbortSignal
): Promise<EndpointHealthMetrics> {
  const response = await fetch(`/auth/endpoints/${encodeURIComponent(endpointId)}/metrics`, {
    credentials: "include",
    signal
  });
  if (!response.ok) {
    throw new Error(await readEndpointHealthError(response));
  }
  return (await response.json()) as EndpointHealthMetrics;
}

function endpointStatusColor(status: EndpointConfig["status"]): string {
  const severity = endpointStatusSeverity(status);
  if (severity === "success") {
    return "success.main";
  }
  if (severity === "warning") {
    return "warning.main";
  }
  if (severity === "error") {
    return "error.main";
  }
  return "info.main";
}

function addEndpointButtonLabel(busyKey: string | null, mode: "initial" | "manage"): string {
  if (busyKey === "add") {
    return "Adding...";
  }
  return mode === "initial" ? "Add Endpoint" : "Add";
}

function endpointActionButtonLabel(
  endpoint: EndpointConfig | null | undefined,
  busyKey: string | null,
  action: "edit" | "reconnect" | "remove"
): string {
  const defaultLabels = {
    edit: "Save",
    reconnect: "Reconnect",
    remove: "Remove"
  };
  if (!endpoint) {
    return defaultLabels[action];
  }

  const busyLabels = {
    edit: "Saving...",
    reconnect: "Reconnecting...",
    remove: "Removing..."
  };
  return busyKey === `${action}:${endpoint.id}` ? busyLabels[action] : defaultLabels[action];
}

function endpointAddDescription(mode: "initial" | "manage"): string {
  if (mode === "initial") {
    return "Authenticate against a clab-api-server to start or restore the standalone session.";
  }
  return "Add another clab-api-server and it will appear as its own explorer root.";
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
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
      <Box sx={{ color: "text.secondary", display: "inline-flex", flexShrink: 0 }}>
        {props.icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {props.label}
        </Typography>
        <Typography variant="body2" fontWeight={600} noWrap>
          {props.value}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
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
        icon={<SpeedIcon fontSize="small" />}
        label="CPU"
        value={formatEndpointHealthPercent(cpu?.usagePercent)}
        detail={cpu?.numCPU ? `${cpu.numCPU} cores` : "cores n/a"}
      />
      <EndpointHealthMetric
        icon={<MemoryIcon fontSize="small" />}
        label="Memory"
        value={formatEndpointHealthPercent(mem?.usagePercent)}
        detail={formatEndpointHealthUsedTotal(mem?.usedMem, mem?.totalMem)}
      />
      <EndpointHealthMetric
        icon={<StorageIcon fontSize="small" />}
        label="Disk"
        value={formatEndpointHealthPercent(disk?.usagePercent)}
        detail={diskDetail}
      />
    </Stack>
  );
}

function EndpointHealthStats(props: {
  endpoint: EndpointConfig;
  state?: EndpointHealthState;
}) {
  const { endpoint, state } = props;

  if (endpoint.status !== "connected") {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        Reconnect to view health stats.
      </Typography>
    );
  }

  if (!state || state.status === "loading") {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <CircularProgress size={14} />
        <Typography variant="caption" color="text.secondary">
          Loading health stats...
        </Typography>
      </Stack>
    );
  }

  if (state.status === "error") {
    return (
      <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
        Health stats unavailable.
      </Typography>
    );
  }

  return <EndpointHealthReady metrics={state.metrics} />;
}

function EndpointStatusPill(props: { status: EndpointConfig["status"] }) {
  const { status } = props;
  const color = endpointStatusColor(status);

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        px: 1.1,
        py: 0.45,
        borderRadius: 999,
        border: 1,
        borderColor: color,
        bgcolor: "background.paper",
        color
      }}
    >
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          bgcolor: color,
          flexShrink: 0
        }}
      />
      <Typography variant="caption" fontWeight={700} sx={{ color: "inherit" }}>
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
  onDraftChange: (endpointId: string, nextValue: EndpointSessionDuration) => void;
  onEdit: (endpoint: EndpointConfig) => void;
  onReconnect: (endpoint: EndpointConfig) => void;
  onRemove: (endpoint: EndpointConfig) => void;
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
              p: 1.75,
              borderColor: "divider",
              bgcolor: "background.paper"
            }}
          >
            <Stack spacing={1.25} divider={<Divider flexItem />}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
                spacing={1}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle2" fontWeight={600} noWrap>
                      {endpoint.label}
                    </Typography>
                    <EndpointStatusPill status={endpoint.status} />
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      display: "block"
                    }}
                    noWrap
                  >
                    {endpoint.url}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {endpointStatusHint(endpoint.status)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => props.onEdit(endpoint)}
                    disabled={props.busyKey !== null}
                    sx={{ minWidth: 0, px: 1 }}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => props.onReconnect(endpoint)}
                    disabled={props.busyKey !== null}
                    sx={{ minWidth: 0, px: 1 }}
                  >
                    <RefreshIcon fontSize="small" />
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={() => props.onRemove(endpoint)}
                    disabled={props.busyKey !== null}
                    sx={{ minWidth: 0, px: 1 }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </Button>
                </Stack>
              </Stack>
              {props.healthStatsEnabled ? (
                <EndpointHealthStats endpoint={endpoint} state={props.endpointHealth[endpoint.id]} />
              ) : null}
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ xs: "stretch", sm: "flex-start" }}
              >
                <TextField
                  label="Keep signed in"
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
                  sx={{ flex: 1 }}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <Button
                  variant="outlined"
                  disabled={saveDurationDisabled}
                  onClick={() =>
                    props.onSetEndpointSessionDuration?.(endpoint.id, durationDraft.trim())
                  }
                  sx={{
                    textTransform: "none",
                    height: 40,
                    px: 2.5,
                    alignSelf: { xs: "stretch", sm: "flex-start" }
                  }}
                >
                  Save
                </Button>
              </Stack>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
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

  const handleDraftChange = useCallback((endpointId: string, nextValue: EndpointSessionDuration) => {
    setDrafts((current) => ({
      ...current,
      [endpointId]: nextValue
    }));
  }, []);

  return { drafts, handleDraftChange };
}

function useEndpointHealthState(
  connectedEndpointIds: string[],
  connectedEndpointKey: string,
  healthStatsEnabled: boolean
): Record<string, EndpointHealthState> {
  const [endpointHealth, setEndpointHealth] = useState<Record<string, EndpointHealthState>>({});

  useEffect(() => {
    if (!healthStatsEnabled || connectedEndpointIds.length === 0) {
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
              message: loadError instanceof Error ? loadError.message : "Failed to load endpoint health stats"
            }
          }));
        });
    }

    return () => controller.abort();
  }, [connectedEndpointIds, connectedEndpointKey, healthStatsEnabled]);

  return endpointHealth;
}

function useRequestedEndpointActionDialog(input: {
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
      onRequestedActionHandled,
      requestedAction,
      setError,
      setReconnectEndpointId,
      setReconnectPassword,
      setReconnectUsername,
      setRemoveEndpointId,
      sortedEndpoints
    } = input;
    if (!requestedAction) {
      return;
    }

    const endpoint = sortedEndpoints.find((entry) => entry.id === requestedAction.endpointId) ?? null;
    if (!endpoint) {
      onRequestedActionHandled?.();
      return;
    }

    setError(null);
    if (requestedAction.action === "reconnect") {
      setReconnectEndpointId(endpoint.id);
      setReconnectUsername(endpoint.username);
      setReconnectPassword("");
    } else {
      setRemoveEndpointId(endpoint.id);
    }
    onRequestedActionHandled?.();
  }, [
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
    busyKey !== null || !url.trim() || !username.trim() || !password.trim() || !sessionDurationValid;

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
  }, [label, onAddEndpoint, password, sessionDuration, setBusyKey, setError, submitDisabled, url, username]);

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

  const open = useCallback((nextEndpoint: EndpointConfig) => {
    setEndpointId(nextEndpoint.id);
    setUsername(nextEndpoint.username);
    setPassword("");
    setError(null);
  }, [setError]);

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

  return { endpoint, open, password, setEndpointId, setPassword, setUsername, submit, submitDisabled, username };
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

  const open = useCallback((nextEndpoint: EndpointConfig) => {
    setEndpointId(nextEndpoint.id);
    setError(null);
  }, [setError]);

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

  return { endpoint, open, setEndpointId, submitDisabled: busyKey !== null, submit };
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

  const open = useCallback((nextEndpoint: EndpointConfig) => {
    setEndpointId(nextEndpoint.id);
    setUrl(nextEndpoint.url);
    setLabel(nextEndpoint.label);
    setUsername(nextEndpoint.username);
    setSessionDuration(nextEndpoint.sessionDuration);
    setError(null);
  }, [setError]);

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
  }, [endpoint, label, onUpdateEndpoint, sessionDuration, setBusyKey, setError, submitDisabled, url, username]);

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
  onReconnectEndpoint,
  onRemoveEndpoint,
  onUpdateEndpoint,
  onRequestedActionHandled,
  requestedAction,
  onSetEndpointSessionDuration
}: EndpointManagerProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedEndpoints = useMemo(
    () => [...endpoints].sort((left, right) => left.label.localeCompare(right.label)),
    [endpoints]
  );
  const connectedEndpointIds = useMemo(
    () => sortedEndpoints.filter((endpoint) => endpoint.status === "connected").map((endpoint) => endpoint.id),
    [sortedEndpoints]
  );
  const connectedEndpointKey = connectedEndpointIds.join("|");
  const endpointHealth = useEndpointHealthState(
    connectedEndpointIds,
    connectedEndpointKey,
    healthStatsEnabled
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

  useRequestedEndpointActionDialog({
    onRequestedActionHandled,
    requestedAction,
    setError,
    setReconnectEndpointId: reconnectDialog.setEndpointId,
    setReconnectPassword: reconnectDialog.setPassword,
    setReconnectUsername: reconnectDialog.setUsername,
    setRemoveEndpointId: removeDialog.setEndpointId,
    sortedEndpoints
  });

  return (
    <Stack spacing={2.5}>
      {showManagedEndpoints(mode, sortedEndpoints.length) ? (
        <ManagedEndpointList
          busyKey={busyKey}
          endpointHealth={endpointHealth}
          endpoints={sortedEndpoints}
          healthStatsEnabled={healthStatsEnabled}
          onDraftChange={handleEndpointDurationDraftChange}
          onEdit={editDialog.open}
          onReconnect={reconnectDialog.open}
          onRemove={removeDialog.open}
          onSetEndpointSessionDuration={onSetEndpointSessionDuration}
          sessionDurationDrafts={endpointSessionDurationDrafts}
        />
      ) : null}

      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.5, md: 3 },
          borderColor: "divider",
          bgcolor: "background.paper"
        }}
      >
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              Add Endpoint
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {endpointAddDescription(mode)}
            </Typography>
          </Box>

          {visibleError ? (
            <Alert severity="error" variant="outlined">
              {visibleError}
            </Alert>
          ) : null}

          <Stack spacing={1.5}>
            <TextField
              label="API Endpoint"
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
              placeholder="http://localhost:8080"
              slotProps={{
                inputLabel: { shrink: true },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SettingsEthernetIcon fontSize="small" />
                    </InputAdornment>
                  )
                }
              }}
            />
            <TextField
              label="Label"
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
              placeholder="Optional friendly name"
              slotProps={{
                inputLabel: { shrink: true },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LabelOutlinedIcon fontSize="small" />
                    </InputAdornment>
                  )
                }
              }}
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
              slotProps={{
                inputLabel: { shrink: true },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonOutlineIcon fontSize="small" />
                    </InputAdornment>
                  )
                }
              }}
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
              slotProps={{
                inputLabel: { shrink: true },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlinedIcon fontSize="small" />
                    </InputAdornment>
                  )
                }
              }}
            />
            <TextField
              label="Keep me signed in"
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
            onClick={addForm.submit}
            disabled={addForm.submitDisabled}
            sx={{
              alignSelf: "flex-start",
              textTransform: "none"
            }}
          >
            {addEndpointButtonLabel(busyKey, mode)}
          </Button>
        </Stack>
      </Paper>

      <Dialog
        open={Boolean(editDialog.endpoint)}
        onClose={() => editDialog.setEndpointId(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit Endpoint</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              label="Label"
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
              label="API Endpoint"
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
              label="Keep signed in"
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
          <Button onClick={() => editDialog.setEndpointId(null)}>Cancel</Button>
          <Button
            onClick={editDialog.submit}
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
        <DialogTitle>Reconnect Endpoint</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {reconnectDialog.endpoint ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  {`Reconnect "${reconnectDialog.endpoint.label}" to restore access for this endpoint.`}
                </Typography>
                <Alert severity={endpointStatusSeverity(reconnectDialog.endpoint.status)} variant="outlined">
                  {endpointStatusHint(reconnectDialog.endpoint.status)}
                </Alert>
                <Typography variant="body2" color="text.secondary">
                  Keep signed in: {endpointSessionDurationLabel(reconnectDialog.endpoint.sessionDuration)}
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
          <Button onClick={() => reconnectDialog.setEndpointId(null)}>Cancel</Button>
          <Button
            onClick={reconnectDialog.submit}
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
        <DialogTitle>Remove Endpoint</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {`Remove "${removeDialog.endpoint?.label ?? "endpoint"}" from this standalone session?`}
            </Typography>
            <Divider />
            <Typography variant="body2">
              Labs, topology sessions, and event streams for this endpoint will be closed.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => removeDialog.setEndpointId(null)}>Cancel</Button>
          <Button
            onClick={removeDialog.submit}
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
