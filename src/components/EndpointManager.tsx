import React, { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  DeleteOutline as DeleteOutlineIcon,
  EditOutlined as EditOutlinedIcon,
  LockOutlined as LockOutlinedIcon,
  Memory as MemoryIcon,
  PersonOutline as PersonOutlineIcon,
  Refresh as RefreshIcon,
  SettingsEthernet as SettingsEthernetIcon,
  LabelOutlined as LabelOutlinedIcon,
  Speed as SpeedIcon,
  Storage as StorageIcon
} from "@mui/icons-material";

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

function EndpointHealthStats(props: {
  endpoint: EndpointConfig;
  state?: EndpointHealthState;
}) {
  const { endpoint, state } = props;

  if (endpoint.status !== "connected") {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", pt: 0.5 }}>
        Reconnect to view health stats.
      </Typography>
    );
  }

  if (!state || state.status === "loading") {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ pt: 0.5 }}>
        <CircularProgress size={14} />
        <Typography variant="caption" color="text.secondary">
          Loading health stats...
        </Typography>
      </Stack>
    );
  }

  if (state.status === "error") {
    return (
      <Typography variant="caption" color="warning.main" sx={{ display: "block", pt: 0.5 }}>
        Health stats unavailable.
      </Typography>
    );
  }

  const { cpu, mem, disk } = state.metrics.metrics;
  return (
    <Box sx={{ pt: 1, mt: 0.5, borderTop: 1, borderColor: "divider" }}>
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
          detail={`${formatEndpointHealthUsedTotal(disk?.usedDisk, disk?.totalDisk)}${
            disk?.path ? ` on ${disk.path}` : ""
          }`}
        />
      </Stack>
    </Box>
  );
}

function EndpointStatusPill(props: { status: EndpointConfig["status"] }) {
  const { status } = props;
  const severity = endpointStatusSeverity(status);
  const color =
    severity === "success"
      ? "success.main"
      : severity === "warning"
        ? "warning.main"
        : severity === "error"
          ? "error.main"
          : "info.main";

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
  const [url, setUrl] = useState(defaultApiUrl);
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sessionDuration, setSessionDuration] = useState<EndpointSessionDuration>(
    DEFAULT_ENDPOINT_SESSION_DURATION
  );
  const [endpointSessionDurationDrafts, setEndpointSessionDurationDrafts] = useState<
    Record<string, EndpointSessionDuration>
  >({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnectEndpointId, setReconnectEndpointId] = useState<string | null>(null);
  const [removeEndpointId, setRemoveEndpointId] = useState<string | null>(null);
  const [editEndpointId, setEditEndpointId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editSessionDuration, setEditSessionDuration] = useState<EndpointSessionDuration>(
    DEFAULT_ENDPOINT_SESSION_DURATION
  );
  const [reconnectUsername, setReconnectUsername] = useState("");
  const [reconnectPassword, setReconnectPassword] = useState("");

  useEffect(() => {
    if (!url.trim() && defaultApiUrl.trim()) {
      setUrl(defaultApiUrl);
    }
  }, [defaultApiUrl, url]);

  const sortedEndpoints = useMemo(
    () => [...endpoints].sort((left, right) => left.label.localeCompare(right.label)),
    [endpoints]
  );
  const connectedEndpointIds = useMemo(
    () => sortedEndpoints.filter((endpoint) => endpoint.status === "connected").map((endpoint) => endpoint.id),
    [sortedEndpoints]
  );
  const connectedEndpointKey = connectedEndpointIds.join("|");
  const [endpointHealth, setEndpointHealth] = useState<Record<string, EndpointHealthState>>({});
  const visibleError = error ?? externalError ?? null;
  const addSessionDurationValid = isValidEndpointSessionDuration(sessionDuration);

  const reconnectEndpoint = useMemo(
    () => sortedEndpoints.find((endpoint) => endpoint.id === reconnectEndpointId) ?? null,
    [reconnectEndpointId, sortedEndpoints]
  );

  const removeEndpoint = useMemo(
    () => sortedEndpoints.find((endpoint) => endpoint.id === removeEndpointId) ?? null,
    [removeEndpointId, sortedEndpoints]
  );
  const editEndpoint = useMemo(
    () => sortedEndpoints.find((endpoint) => endpoint.id === editEndpointId) ?? null,
    [editEndpointId, sortedEndpoints]
  );

  useEffect(() => {
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
  }, [onRequestedActionHandled, requestedAction, sortedEndpoints]);

  useEffect(() => {
    setEndpointSessionDurationDrafts((current) => {
      const next: Record<string, EndpointSessionDuration> = {};
      for (const endpoint of sortedEndpoints) {
        next[endpoint.id] = current[endpoint.id] ?? endpoint.sessionDuration;
      }
      return next;
    });
  }, [sortedEndpoints]);

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

  const handleAddEndpoint = useCallback(async () => {
    if (
      !url.trim() ||
      !username.trim() ||
      !password.trim() ||
      !isValidEndpointSessionDuration(sessionDuration)
    ) {
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
  }, [label, onAddEndpoint, password, sessionDuration, url, username]);

  const handleReconnect = useCallback(async () => {
    if (!reconnectEndpoint || !reconnectUsername.trim() || !reconnectPassword.trim()) {
      return;
    }

    setBusyKey(`reconnect:${reconnectEndpoint.id}`);
    setError(null);
    try {
      await onReconnectEndpoint({
        endpointId: reconnectEndpoint.id,
        username: reconnectUsername.trim(),
        password: reconnectPassword
      });
      setReconnectEndpointId(null);
      setReconnectPassword("");
    } catch (reconnectError) {
      setError(reconnectError instanceof Error ? reconnectError.message : String(reconnectError));
    } finally {
      setBusyKey(null);
    }
  }, [onReconnectEndpoint, reconnectEndpoint, reconnectPassword, reconnectUsername]);

  const addSubmitDisabled =
    busyKey !== null || !url.trim() || !username.trim() || !password.trim() || !addSessionDurationValid;

  const reconnectSubmitDisabled =
    busyKey !== null || !reconnectUsername.trim() || !reconnectPassword.trim();

  const handleRemove = useCallback(async () => {
    if (!removeEndpoint) {
      return;
    }

    setBusyKey(`remove:${removeEndpoint.id}`);
    setError(null);
    try {
      await onRemoveEndpoint(removeEndpoint.id);
      setRemoveEndpointId(null);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setBusyKey(null);
    }
  }, [onRemoveEndpoint, removeEndpoint]);

  const openEditEndpoint = useCallback((endpoint: EndpointConfig) => {
    setEditEndpointId(endpoint.id);
    setEditUrl(endpoint.url);
    setEditLabel(endpoint.label);
    setEditUsername(endpoint.username);
    setEditSessionDuration(endpoint.sessionDuration);
    setError(null);
  }, []);

  const editSessionDurationValid = isValidEndpointSessionDuration(editSessionDuration);
  const editHasChanges = editEndpoint
    ? editUrl.trim() !== editEndpoint.url ||
      editLabel.trim() !== editEndpoint.label ||
      editUsername.trim() !== editEndpoint.username ||
      editSessionDuration.trim() !== editEndpoint.sessionDuration
    : false;

  const editSubmitDisabled =
    busyKey !== null ||
    !editUrl.trim() ||
    !editLabel.trim() ||
    !editUsername.trim() ||
    !editSessionDurationValid ||
    !editHasChanges;

  const handleUpdateEndpoint = useCallback(async () => {
    if (
      !editEndpoint ||
      !editUrl.trim() ||
      !editLabel.trim() ||
      !editUsername.trim() ||
      !isValidEndpointSessionDuration(editSessionDuration)
    ) {
      return;
    }

    setBusyKey(`edit:${editEndpoint.id}`);
    setError(null);
    try {
      await onUpdateEndpoint({
        endpointId: editEndpoint.id,
        label: editLabel.trim(),
        sessionDuration: editSessionDuration.trim(),
        url: editUrl.trim(),
        username: editUsername.trim()
      });
      setEditEndpointId(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setBusyKey(null);
    }
  }, [
    editEndpoint,
    editLabel,
    editSessionDuration,
    editUrl,
    editUsername,
    onUpdateEndpoint
  ]);

  return (
    <Stack spacing={2.5}>
      {mode === "manage" && sortedEndpoints.length > 0 ? (
        <Stack spacing={1.25}>
          {sortedEndpoints.map((endpoint) => (
            <Paper
              key={endpoint.id}
              variant="outlined"
              sx={{
                p: 1.5,
                borderColor: "divider",
                bgcolor: "background.paper"
              }}
            >
              <Stack spacing={0.75}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
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
                    {healthStatsEnabled ? (
                      <EndpointHealthStats endpoint={endpoint} state={endpointHealth[endpoint.id]} />
                    ) : null}
                    <TextField
                      label="Keep signed in"
                      size="small"
                      value={
                        endpointSessionDurationDrafts[endpoint.id] ?? endpoint.sessionDuration
                      }
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setEndpointSessionDurationDrafts((current) => ({
                          ...current,
                          [endpoint.id]: nextValue
                        }));
                      }}
                      error={Boolean(
                        (endpointSessionDurationDrafts[endpoint.id] ?? endpoint.sessionDuration)
                          .trim() &&
                          !isValidEndpointSessionDuration(
                            endpointSessionDurationDrafts[endpoint.id] ?? endpoint.sessionDuration
                          )
                      )}
                      helperText={
                        isValidEndpointSessionDuration(
                          endpointSessionDurationDrafts[endpoint.id] ?? endpoint.sessionDuration
                        )
                          ? "Examples: 24h, 36h, 7d, 1h30m"
                          : "Use values like 24h, 36h, 7d, or 1h30m"
                      }
                      placeholder="24h"
                      disabled={busyKey !== null}
                      sx={{ mt: 0.75 }}
                      slotProps={{
                        inputLabel: { shrink: true },
                        input: {
                          endAdornment: (
                            <InputAdornment position="end">
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={
                                  busyKey !== null ||
                                  !onSetEndpointSessionDuration ||
                                  !isValidEndpointSessionDuration(
                                    endpointSessionDurationDrafts[endpoint.id] ?? endpoint.sessionDuration
                                  ) ||
                                  (endpointSessionDurationDrafts[endpoint.id] ?? endpoint.sessionDuration)
                                    .trim() === endpoint.sessionDuration
                                }
                                onClick={() =>
                                  onSetEndpointSessionDuration?.(
                                    endpoint.id,
                                    (endpointSessionDurationDrafts[endpoint.id] ?? endpoint.sessionDuration).trim()
                                  )
                                }
                                sx={{ minWidth: 0, textTransform: "none" }}
                              >
                                Save
                              </Button>
                            </InputAdornment>
                          )
                        }
                      }}
                    />
                  </Box>
                  <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => openEditEndpoint(endpoint)}
                      disabled={busyKey !== null}
                      sx={{ minWidth: 0, px: 1 }}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        setReconnectEndpointId(endpoint.id);
                        setReconnectUsername(endpoint.username);
                        setReconnectPassword("");
                        setError(null);
                      }}
                      disabled={busyKey !== null}
                      sx={{ minWidth: 0, px: 1 }}
                    >
                      <RefreshIcon fontSize="small" />
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => {
                        setRemoveEndpointId(endpoint.id);
                        setError(null);
                      }}
                      disabled={busyKey !== null}
                      sx={{ minWidth: 0, px: 1 }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </Button>
                  </Stack>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
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
              {mode === "initial" ? "Add Endpoint" : "Add Endpoint"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {mode === "initial"
                ? "Authenticate against a clab-api-server to start or restore the standalone session."
                : "Add another clab-api-server and it will appear as its own explorer root."}
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
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleAddEndpoint();
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
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleAddEndpoint();
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
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleAddEndpoint();
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
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleAddEndpoint();
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
              value={sessionDuration}
              onChange={(event) => setSessionDuration(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || addSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleAddEndpoint();
              }}
              fullWidth
              placeholder="24h"
              error={Boolean(sessionDuration.trim()) && !addSessionDurationValid}
              helperText={
                addSessionDurationValid
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
            onClick={handleAddEndpoint}
            disabled={addSubmitDisabled}
            sx={{
              alignSelf: "flex-start",
              textTransform: "none"
            }}
          >
            {busyKey === "add" ? "Adding..." : mode === "initial" ? "Add Endpoint" : "Add"}
          </Button>
        </Stack>
      </Paper>

      <Dialog
        open={Boolean(editEndpoint)}
        onClose={() => setEditEndpointId(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit Endpoint</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              label="Label"
              value={editLabel}
              onChange={(event) => setEditLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || editSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleUpdateEndpoint();
              }}
              fullWidth
            />
            <TextField
              label="API Endpoint"
              value={editUrl}
              onChange={(event) => setEditUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || editSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleUpdateEndpoint();
              }}
              fullWidth
            />
            <TextField
              label="Username"
              value={editUsername}
              onChange={(event) => setEditUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || editSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleUpdateEndpoint();
              }}
              fullWidth
            />
            <TextField
              label="Keep signed in"
              value={editSessionDuration}
              onChange={(event) => setEditSessionDuration(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || editSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleUpdateEndpoint();
              }}
              fullWidth
              placeholder="24h"
              error={Boolean(editSessionDuration.trim()) && !editSessionDurationValid}
              helperText={
                editSessionDurationValid
                  ? "Examples: 24h, 36h, 7d, 1h30m"
                  : "Use values like 24h, 36h, 7d, or 1h30m"
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditEndpointId(null)}>Cancel</Button>
          <Button
            onClick={handleUpdateEndpoint}
            variant="contained"
            disabled={editSubmitDisabled}
          >
            {editEndpoint ? (busyKey === `edit:${editEndpoint.id}` ? "Saving..." : "Save") : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(reconnectEndpoint)}
        onClose={() => setReconnectEndpointId(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Reconnect Endpoint</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {reconnectEndpoint ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  {`Reconnect "${reconnectEndpoint.label}" to restore access for this endpoint.`}
                </Typography>
                <Alert severity={endpointStatusSeverity(reconnectEndpoint.status)} variant="outlined">
                  {endpointStatusHint(reconnectEndpoint.status)}
                </Alert>
                <Typography variant="body2" color="text.secondary">
                  Keep signed in: {endpointSessionDurationLabel(reconnectEndpoint.sessionDuration)}
                </Typography>
              </>
            ) : null}
            <TextField
              label="Username"
              value={reconnectUsername}
              onChange={(event) => setReconnectUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || reconnectSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleReconnect();
              }}
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={reconnectPassword}
              onChange={(event) => setReconnectPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || reconnectSubmitDisabled) {
                  return;
                }
                event.preventDefault();
                void handleReconnect();
              }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReconnectEndpointId(null)}>Cancel</Button>
          <Button
            onClick={handleReconnect}
            variant="contained"
            disabled={reconnectSubmitDisabled}
          >
            {reconnectEndpoint ? (busyKey === `reconnect:${reconnectEndpoint.id}` ? "Reconnecting..." : "Reconnect") : "Reconnect"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(removeEndpoint)}
        onClose={() => setRemoveEndpointId(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Remove Endpoint</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {`Remove "${removeEndpoint?.label ?? "endpoint"}" from this standalone session?`}
            </Typography>
            <Divider />
            <Typography variant="body2">
              Labs, topology sessions, and event streams for this endpoint will be closed.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveEndpointId(null)}>Cancel</Button>
          <Button
            onClick={handleRemove}
            color="error"
            variant="contained"
            disabled={busyKey !== null}
          >
            {removeEndpoint ? (busyKey === `remove:${removeEndpoint.id}` ? "Removing..." : "Remove") : "Remove"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
