import React, { useState, useCallback } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import {
  Settings as SettingsIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  Logout as LogoutIcon,
  Close as CloseIcon
} from "@mui/icons-material";

interface SettingsOverlayProps {
  currentTheme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
  apiUrl: string;
  connected: boolean;
}

export function SettingsOverlay({
  currentTheme,
  onToggleTheme,
  onLogout,
  apiUrl,
  connected
}: SettingsOverlayProps) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

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
