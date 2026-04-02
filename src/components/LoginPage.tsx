import React, { useState, useCallback, type FormEvent } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";

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
  const [showPassword, setShowPassword] = useState(false);

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
        color: "#cccccc",
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(60, 190, 239, 0.08) 0%, transparent 60%), #1e1e1e"
      }}
    >
      <Paper
        elevation={8}
        sx={{
          p: 4,
          width: 400,
          bgcolor: "#252526",
          color: "#cccccc",
          border: 1,
          borderColor: "#3c3c3c",
          borderRadius: 3
        }}
      >
        {/* Animated logo from containerlab.dev */}
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
          <Typography
            variant="body2"
            sx={{ color: "#9d9d9d", mt: 1 }}
          >
            Sign in to manage your network labs
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
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
                    <PersonOutlineIcon fontSize="small" sx={{ color: "#c5c5c5" }} />
                  </InputAdornment>
                )
              }
            }}
          />
          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <LockOutlinedIcon fontSize="small" sx={{ color: "#c5c5c5" }} />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword((v) => !v)}
                      edge="end"
                      size="small"
                      tabIndex={-1}
                      sx={{
                        color: "#6a6a6a",
                        opacity: 0.6,
                        transition: "opacity 0.2s",
                        "&:hover": { opacity: 1, color: "#9d9d9d" }
                      }}
                    >
                      {showPassword ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </InputAdornment>
                )
              }
            }}
          />
          <TextField
            label="API Endpoint"
            value={apiUrl}
            onChange={(e) => onApiUrlChange(e.target.value)}
            fullWidth
            sx={{ mb: 3 }}
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SettingsEthernetIcon fontSize="small" sx={{ color: "#c5c5c5" }} />
                  </InputAdornment>
                )
              }
            }}
            placeholder="http://localhost:8080"
            helperText="Base URL of the clab-api-server"
          />

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={submitting || !username.trim() || !password.trim() || !apiUrl.trim()}
            sx={{
              py: 1.2,
              borderRadius: 2,
              textTransform: "none",
              fontSize: "1rem",
              fontWeight: 500
            }}
          >
            {submitting ? (
              <CircularProgress size={22} color="inherit" sx={{ mr: 1 }} />
            ) : null}
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </Paper>
    </Box>
  );
}
