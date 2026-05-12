import React, { useCallback, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import InputAdornment from "@mui/material/InputAdornment";
import {
  endpointStatusHint,
  endpointStatusLabel,
  endpointStatusSeverity,
  endpointNeedsReconnect
} from "../endpointStatus";

import {
  endpointSessionDurationLabel,
  type EndpointConfig,
  type EndpointImportResult,
  type EndpointSessionDuration
} from "../stores/endpointStore";
import { EndpointManager } from "./EndpointManager";

interface LoginPageProps {
  defaultApiUrl: string;
  endpoints: EndpointConfig[];
  error: string | null;
  onAddEndpoint: (input: {
    label?: string;
    password: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onExportEndpoints: () => string;
  onImportEndpoints: (content: string) => EndpointImportResult | Promise<EndpointImportResult>;
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
}

function ReconnectCard({
  endpoint,
  onReconnect
}: {
  endpoint: EndpointConfig;
  onReconnect: (input: { endpointId: string; password: string; username: string }) => Promise<void>;
}) {
  const [username, setUsername] = useState(endpoint.username);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReconnect = useCallback(async () => {
    if (!password.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onReconnect({
        endpointId: endpoint.id,
        password,
        username: username.trim()
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [endpoint.id, onReconnect, password, username]);

  const endpointUrl = endpoint.url.replace(/^https?:\/\//i, "");

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderColor: "#3c3c3c",
        bgcolor: "rgba(255,255,255,0.02)"
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <SettingsEthernetIcon fontSize="small" sx={{ color: "#858585" }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={600} noWrap>
              {endpoint.label}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "#858585", fontFamily: "monospace", fontSize: "0.75rem" }}
              noWrap
            >
              {endpointUrl} &middot; {endpoint.username}
            </Typography>
            <Typography variant="caption" sx={{ color: "#858585", display: "block" }}>
              Keep signed in: {endpointSessionDurationLabel(endpoint.sessionDuration)}
            </Typography>
          </Box>
        </Stack>

        {error && (
          <Alert severity="error" variant="outlined" sx={{ py: 0.25 }}>
            {error}
          </Alert>
        )}

        <Alert severity={endpointStatusSeverity(endpoint.status)} variant="outlined" sx={{ py: 0.25 }}>
          {endpointStatusLabel(endpoint.status)}. {endpointStatusHint(endpoint.status)}
        </Alert>

        <Stack spacing={1}>
          <TextField
            size="small"
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
          />
        </Stack>

        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            size="small"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleReconnect();
              }
            }}
            fullWidth
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <LockOutlinedIcon sx={{ fontSize: 16 }} />
                  </InputAdornment>
                )
              }
            }}
          />
          <Button
            variant="contained"
            onClick={handleReconnect}
            disabled={busy || !username.trim() || !password.trim() || !endpointNeedsReconnect(endpoint.status)}
            sx={{ textTransform: "none", flexShrink: 0 }}
          >
            {busy ? "Connecting..." : "Connect"}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

export function LoginPage({
  defaultApiUrl,
  endpoints,
  error,
  onAddEndpoint,
  onExportEndpoints,
  onImportEndpoints,
  onReconnectEndpoint,
  onRemoveEndpoint,
  onUpdateEndpoint
}: LoginPageProps) {
  const disconnectedEndpoints = endpoints.filter((ep) => ep.status !== "connected");
  const hasPersistedEndpoints = disconnectedEndpoints.length > 0;
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        px: 2,
        color: "#cccccc",
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(60, 190, 239, 0.08) 0%, transparent 60%), #1e1e1e"
      }}
    >
      <Paper
        elevation={8}
        sx={{
          p: { xs: 3, md: 4 },
          width: "min(520px, 100%)",
          bgcolor: "#252526",
          color: "#cccccc",
          border: 1,
          borderColor: "#3c3c3c",
          borderRadius: 3
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            mb: 3
          }}
        >
          <Box
            component="object"
            type="image/svg+xml"
            data="/containerlab-animated.svg"
            aria-label="Containerlab Logo"
            sx={{
              width: 200,
              height: 154,
              pointerEvents: "none"
            }}
          />
          <Typography variant="body2" sx={{ color: "#9d9d9d", mt: 1, textAlign: "center" }}>
            {hasPersistedEndpoints
              ? "Enter your password to reconnect to your endpoints."
              : "Connect one or more `clab-api-server` endpoints to manage labs in the browser."}
          </Typography>
        </Box>

        {hasPersistedEndpoints && !showAddForm ? (
          <Stack spacing={2}>
            {error ? <Alert severity="error" variant="outlined">{error}</Alert> : null}
            {disconnectedEndpoints.map((endpoint) => (
              <ReconnectCard
                key={endpoint.id}
                endpoint={endpoint}
                onReconnect={onReconnectEndpoint}
              />
            ))}
            <Button
              variant="text"
              size="small"
              onClick={() => setShowAddForm(true)}
              sx={{ alignSelf: "center", textTransform: "none", color: "#858585" }}
            >
              Manage saved endpoints
            </Button>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <EndpointManager
              defaultApiUrl={defaultApiUrl}
              endpoints={endpoints}
              externalError={error}
              mode={hasPersistedEndpoints ? "manage" : "initial"}
              onAddEndpoint={onAddEndpoint}
              onExportEndpoints={onExportEndpoints}
              onImportEndpoints={onImportEndpoints}
              onReconnectEndpoint={onReconnectEndpoint}
              onRemoveEndpoint={onRemoveEndpoint}
              onUpdateEndpoint={onUpdateEndpoint}
            />
            {hasPersistedEndpoints && (
              <Button
                variant="text"
                size="small"
                onClick={() => setShowAddForm(false)}
                sx={{ alignSelf: "center", textTransform: "none", color: "#858585" }}
              >
                Back to reconnect
              </Button>
            )}
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
