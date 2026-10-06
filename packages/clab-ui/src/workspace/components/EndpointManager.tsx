import { useWorkspaceHost } from "../WorkspaceHost";
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
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import SpeedOutlinedIcon from "@mui/icons-material/SpeedOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";

import { ENDPOINT_EXPORT_FILENAME,
  DEFAULT_ENDPOINT_SESSION_DURATION,
  endpointSessionDurationLabel,
  isValidEndpointSessionDuration,
  type EndpointConfig,
  type EndpointImportResult,
  type EndpointSessionDuration } from "../endpoints";
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
}

type EndpointHealthState =
  | { status: "loading" }
  | { status: "ready"; metrics: EndpointHealthMetrics }
  | { status: "error"; message: string };

function formatEndpointImportResult(result: EndpointImportResult): string {
  if (result.total === 0) {
    return "No endpoint profiles were found in the import file.";
  }

  const parts = [
    result.added ? `${result.added} added` : null,
    result.updated ? `${result.updated} updated` : null,
    result.unchanged ? `${result.unchanged} unchanged` : null,
    result.duplicates
      ? `${result.duplicates} duplicate ${result.duplicates === 1 ? "entry" : "entries"} merged`
      : null
  ].filter((value): value is string => value !== null);

  return `Imported ${result.total} endpoint ${result.total === 1 ? "profile" : "profiles"}${
    parts.length > 0 ? `: ${parts.join(", ")}` : ""
  }.`;
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
        Reconnect to view health stats.
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
                      fontFamily: MONO_FONT_FAMILY,
                      display: "block",
                      mt: 0.25
                    }}
                  >
                    {endpoint.url}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      display: "block"
                    }}
                  >
                    {endpointStatusHint(endpoint.status)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0, mt: -0.5, mr: -0.75 }}>
                  <IconButton
                    size="small"
                    onClick={() => props.onEdit(endpoint)}
                    aria-label={`Edit ${endpoint.label}`}
                    disabled={props.busyKey !== null}
                  >
                    <EditOutlinedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => props.onReconnect(endpoint)}
                    aria-label={`Reconnect ${endpoint.label}`}
                    disabled={props.busyKey !== null}
                  >
                    <RefreshIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => props.onRemove(endpoint)}
                    aria-label={`Remove ${endpoint.label}`}
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
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{
                  alignItems: { xs: "stretch", sm: "flex-start" }
                }}
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

function useEndpointHealthState(
  connectedEndpointIds: string[],
  connectedEndpointKey: string,
  healthStatsEnabled: boolean
): Record<string, EndpointHealthState> {
  const { fetchEndpointHealthMetrics } = useWorkspaceHost().api;
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
              message:
                loadError instanceof Error
                  ? loadError.message
                  : "Failed to load endpoint health stats"
            }
          }));
        });
    }

    return () => controller.abort();
  }, [connectedEndpointIds, connectedEndpointKey, healthStatsEnabled, fetchEndpointHealthMetrics]);

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
  onSetEndpointSessionDuration
}: EndpointManagerProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sortedEndpoints = useMemo(
    () => [...endpoints].sort((left, right) => left.label.localeCompare(right.label)),
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

  const handleExportEndpoints = useCallback(() => {
    if (!onExportEndpoints) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      downloadJsonFile(ENDPOINT_EXPORT_FILENAME, onExportEndpoints());
      setNotice(
        `Exported ${sortedEndpoints.length} endpoint ${sortedEndpoints.length === 1 ? "profile" : "profiles"}.`
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
          onDraftChange={handleEndpointDurationDraftChange}
          onEdit={editDialog.open}
          onReconnect={reconnectDialog.open}
          onRemove={removeDialog.open}
          onSetEndpointSessionDuration={onSetEndpointSessionDuration}
          sessionDurationDrafts={endpointSessionDurationDrafts}
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
              Add Endpoint
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
              placeholder="https://localhost:8090"
              slotProps={{ inputLabel: { shrink: true } }}
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
            Endpoint profiles
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
        <DialogTitle>Reconnect Endpoint</DialogTitle>
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
                  {`Reconnect "${reconnectDialog.endpoint.label}" to restore access for this endpoint.`}
                </Typography>
                <Alert
                  severity={endpointStatusSeverity(reconnectDialog.endpoint.status)}
                  variant="outlined"
                >
                  {endpointStatusHint(reconnectDialog.endpoint.status)}
                </Alert>
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary"
                  }}
                >
                  Keep signed in:{" "}
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
        <DialogTitle>Remove Endpoint</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2">
              {`Remove "${removeDialog.endpoint?.label ?? "endpoint"}" from this standalone session?`}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Labs, topology sessions, and event streams for this endpoint will be closed.
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
