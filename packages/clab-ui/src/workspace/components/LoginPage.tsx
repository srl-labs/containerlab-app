import React, { useCallback, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernetOutlined";
import {
  endpointStatusHint,
  endpointStatusLabel,
  endpointStatusSeverity,
  endpointNeedsReconnect
} from "../state/endpointStatus";
import { useWorkspaceHost } from "../WorkspaceHost";
import { dialogRadius, overlayShadow } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";

import {
  endpointSessionDurationLabel,
  type EndpointConfig,
  type EndpointImportResult,
  type EndpointSessionDuration
} from "../endpoints";
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
        borderColor: "divider",
        bgcolor: "transparent"
      }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center"
          }}
        >
          <SettingsEthernetIcon sx={{ fontSize: 18, color: "text.secondary" }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {endpoint.label}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                fontFamily: MONO_FONT_FAMILY
              }}
              noWrap
            >
              {endpointUrl} &middot; {endpoint.username}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              Keep signed in: {endpointSessionDurationLabel(endpoint.sessionDuration)}
            </Typography>
          </Box>
        </Stack>

        {error && (
          <Alert severity="error" variant="outlined" sx={{ py: 0.25 }}>
            {error}
          </Alert>
        )}

        <Alert
          severity={endpointStatusSeverity(endpoint.status)}
          variant="outlined"
          sx={{ py: 0.25 }}
        >
          {endpointStatusLabel(endpoint.status)}. {endpointStatusHint(endpoint.status)}
        </Alert>

        <Stack spacing={1} sx={{ pt: 0.5 }}>
          <TextField
            size="small"
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
          />
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "flex-start"
          }}
        >
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
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Button
            variant="contained"
            onClick={() => {
              void handleReconnect();
            }}
            disabled={
              busy ||
              !username.trim() ||
              !password.trim() ||
              !endpointNeedsReconnect(endpoint.status)
            }
            sx={{ flexShrink: 0 }}
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
  const { assetUrl: publicAssetUrl } = useWorkspaceHost();
  const disconnectedEndpoints = endpoints.filter((ep) => ep.status !== "connected");
  const hasPersistedEndpoints = disconnectedEndpoints.length > 0;
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100%",
        px: 2,
        py: 3,
        boxSizing: "border-box",
        color: "text.primary",
        background:
          "radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--clab-ui-focus-border, var(--vscode-focusBorder)) 10%, transparent), transparent 60%), var(--clab-ui-editor-background, var(--vscode-editor-background))"
      }}
    >
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, sm: 4 },
          width: "min(440px, 100%)",
          bgcolor: "background.paper",
          backgroundImage: "none",
          color: "text.primary",
          border: 1,
          borderColor: "divider",
          borderRadius: dialogRadius,
          boxShadow: overlayShadow
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            mb: 2
          }}
        >
          <Box
            component="img"
            src={publicAssetUrl("containerlab.svg")}
            alt=""
            aria-hidden="true"
            sx={{ display: "block", width: 40, height: 40 }}
          />
          {hasPersistedEndpoints ? (
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 2, textAlign: "center" }}>
              Enter your password to reconnect to your endpoints.
            </Typography>
          ) : null}
        </Box>

        {hasPersistedEndpoints && !showAddForm ? (
          <Stack spacing={2}>
            {error ? (
              <Alert severity="error" variant="outlined">
                {error}
              </Alert>
            ) : null}
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
              sx={{
                alignSelf: "center",
                color: "text.secondary"
              }}
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
                sx={{
                  alignSelf: "center",
                  color: "text.secondary"
                }}
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
