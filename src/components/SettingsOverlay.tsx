import React, { useState, useCallback, useEffect } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import {
  Settings as SettingsIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  Logout as LogoutIcon,
  Close as CloseIcon
} from "@mui/icons-material";

import type { TerminalPreferences } from "../runtimeTerminalSettings";

interface SettingsOverlayProps {
  currentTheme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
  onShowInspectAll: () => void;
  onShowVersion: () => void;
  onSaveTerminalPreferences: (next: TerminalPreferences) => void;
  apiUrl: string;
  connected: boolean;
  terminalPreferences: TerminalPreferences;
}

export function SettingsOverlay({
  currentTheme,
  onToggleTheme,
  onLogout,
  onShowInspectAll,
  onShowVersion,
  onSaveTerminalPreferences,
  apiUrl,
  connected,
  terminalPreferences
}: SettingsOverlayProps) {
  const [open, setOpen] = useState(false);
  const [sshUserMappingText, setSshUserMappingText] = useState("");
  const [telnetPortText, setTelnetPortText] = useState("");
  const [terminalError, setTerminalError] = useState<string | null>(null);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  useEffect(() => {
    setSshUserMappingText(JSON.stringify(terminalPreferences.sshUserMapping, null, 2));
    setTelnetPortText(String(terminalPreferences.telnetPort));
  }, [terminalPreferences]);

  const saveTerminalSettings = useCallback(() => {
    try {
      const parsed = JSON.parse(sshUserMappingText) as Record<string, string>;
      const telnetPort = Number.parseInt(telnetPortText, 10);
      if (!Number.isInteger(telnetPort) || telnetPort <= 0 || telnetPort > 65535) {
        throw new Error("Telnet port must be an integer between 1 and 65535.");
      }
      onSaveTerminalPreferences({
        sshUserMapping: parsed,
        telnetPort
      });
      setTerminalError(null);
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error));
    }
  }, [onSaveTerminalPreferences, sshUserMappingText, telnetPortText]);

  return (
    <>
      <Tooltip title="Settings" placement="left">
        <IconButton
          onClick={toggle}
          size="small"
          sx={{
            position: "fixed",
            top: 8,
            right: 8,
            zIndex: 9999,
            bgcolor: "background.paper",
            color: "action.active",
            border: 1,
            borderColor: "divider",
            boxShadow: 2,
            "&:hover": {
              bgcolor: "action.hover"
            }
          }}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {open && (
        <Paper
          elevation={8}
          sx={{
            position: "fixed",
            top: 8,
            right: 48,
            zIndex: 9999,
            p: 2,
            width: 280,
            bgcolor: "background.paper",
            color: "text.primary",
            border: 1,
            borderColor: "divider"
          }}
        >
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
            <Typography variant="subtitle2">Settings</Typography>
            <IconButton size="small" onClick={toggle} sx={{ color: "action.active" }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          <Divider sx={{ mb: 1.5 }} />

          <Box sx={{ mb: 1.5 }}>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              API Server
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
              {apiUrl}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: connected ? "success.main" : "error.main" }}
            >
              {connected ? "Connected" : "Disconnected"}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={currentTheme === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
              onClick={onToggleTheme}
              fullWidth
            >
              {currentTheme === "dark" ? "Light" : "Dark"} Mode
            </Button>
          </Box>

          <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
            <Button size="small" variant="outlined" fullWidth onClick={onShowInspectAll}>
              Inspect Labs
            </Button>
            <Button size="small" variant="outlined" fullWidth onClick={onShowVersion}>
              About
            </Button>
          </Box>

          <Divider sx={{ mb: 1.5 }} />

          <Box sx={{ mb: 1.5 }}>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              Terminal
            </Typography>
            <TextField
              label="SSH User Mapping JSON"
              value={sshUserMappingText}
              onChange={(event) => setSshUserMappingText(event.target.value)}
              fullWidth
              multiline
              minRows={4}
              size="small"
              sx={{ mt: 1 }}
            />
            <TextField
              label="Telnet Port"
              value={telnetPortText}
              onChange={(event) => setTelnetPortText(event.target.value)}
              fullWidth
              size="small"
              sx={{ mt: 1 }}
            />
            {terminalError ? (
              <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
                {terminalError}
              </Typography>
            ) : null}
            <Button size="small" variant="outlined" fullWidth sx={{ mt: 1 }} onClick={saveTerminalSettings}>
              Save Terminal Settings
            </Button>
          </Box>

          <Divider sx={{ mb: 1.5 }} />

          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<LogoutIcon />}
            onClick={onLogout}
            fullWidth
          >
            Logout
          </Button>
        </Paper>
      )}
    </>
  );
}
