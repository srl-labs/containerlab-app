import React, { useState, useCallback, type FormEvent } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import InputAdornment from "@mui/material/InputAdornment";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";

interface LoginPageProps {
  error: string | null;
  apiUrl: string;
  onApiUrlChange: (apiUrl: string) => void;
  onLogin: (username: string, password: string, apiUrl: string) => Promise<void>;
}

export function LoginPage({ error, apiUrl, onApiUrlChange, onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!username.trim() || !password.trim() || !apiUrl.trim()) return;
      setSubmitting(true);
      try {
        await onLogin(username.trim(), password, apiUrl.trim());
      } catch {
        // Error is handled by the auth store
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, apiUrl, onLogin]
  );

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        bgcolor: "background.default",
        color: "text.primary"
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 4,
          width: 360,
          bgcolor: "background.paper",
          color: "text.primary",
          border: 1,
          borderColor: "divider"
        }}
      >
        <Typography variant="h5" sx={{ mb: 3, textAlign: "center" }}>
          Containerlab GUI
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            label="API Endpoint"
            value={apiUrl}
            onChange={(e) => onApiUrlChange(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SettingsEthernetIcon fontSize="small" sx={{ color: "action.active" }} />
                  </InputAdornment>
                )
              }
            }}
            helperText="Base URL of clab-api-server (e.g. http://localhost:8080)"
          />
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
            autoFocus
            sx={{ mb: 2 }}
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <PersonOutlineIcon fontSize="small" sx={{ color: "action.active" }} />
                  </InputAdornment>
                )
              }
            }}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            sx={{ mb: 3 }}
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <LockOutlinedIcon fontSize="small" sx={{ color: "action.active" }} />
                  </InputAdornment>
                )
              }
            }}
          />
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={submitting || !username.trim() || !password.trim() || !apiUrl.trim()}
          >
            {submitting ? "Logging in..." : "Login"}
          </Button>
        </form>
      </Paper>
    </Box>
  );
}
