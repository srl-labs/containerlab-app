import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

const SCHEMES = [
  {
    key: "vscode",
    label: "Follow VS Code",
    background: "background.default",
    sidebar: "action.selected",
    line: "text.secondary",
  },
  {
    key: "light",
    label: "Light",
    background: "#f4f5f7",
    sidebar: "#dce1e8",
    line: "#bac2ce",
  },
  {
    key: "dark",
    label: "Dark",
    background: "#141619",
    sidebar: "#343943",
    line: "#525967",
  },
] as const;
export type SettingsColorScheme = (typeof SCHEMES)[number]["key"];
export function ColorSchemePicker({
  value,
  onChange,
  followHost = false,
  disabled = false,
  testIdPrefix,
}: {
  value: string;
  onChange: (value: SettingsColorScheme) => void;
  followHost?: boolean;
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  return (
    <Box
      role="group"
      aria-label="Color scheme"
      sx={{
        display: "grid",
        gridTemplateColumns: followHost
          ? "repeat(3, minmax(0, 1fr))"
          : "repeat(2, minmax(0, 1fr))",
        gap: 1,
        maxWidth: 520,
      }}
    >
      {SCHEMES.filter((scheme) => followHost || scheme.key !== "vscode").map(
        (scheme) => (
          <Button
            key={scheme.key}
            variant="outlined"
            aria-pressed={value === scheme.key}
            disabled={disabled}
            onClick={() => onChange(scheme.key)}
            data-testid={
              testIdPrefix ? `${testIdPrefix}${scheme.key}` : undefined
            }
            sx={{
              p: 0.875,
              display: "block",
              textTransform: "none",
              color: "text.primary",
              border: "1px solid",
              borderColor: value === scheme.key ? "text.primary" : "divider",
              boxShadow:
                value === scheme.key ? "inset 0 0 0 1px currentColor" : "none",
              borderRadius: 1.5,
            }}
          >
            <Box
              sx={{
                height: 42,
                borderRadius: 0.75,
                bgcolor: scheme.background,
                border: 1,
                borderColor: "divider",
                display: "flex",
                p: 0.5,
                gap: 0.5,
                mb: 0.5,
              }}
            >
              <Box
                sx={{
                  width: "25%",
                  bgcolor: scheme.sidebar,
                  borderRadius: 0.5,
                }}
              />
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.5,
                  pt: 0.5,
                }}
              >
                {[75, 95, 55].map((width) => (
                  <Box
                    key={width}
                    sx={{
                      width: `${width}%`,
                      height: 3,
                      borderRadius: 1,
                      bgcolor: scheme.line,
                      opacity: 0.6,
                    }}
                  />
                ))}
              </Box>
            </Box>
            <Typography
              sx={{
                fontWeight: 550,
                fontSize: "calc(0.72rem * var(--settings-font-scale, 1))",
                lineHeight: 1.5,
              }}
            >
              {scheme.label}
            </Typography>
          </Button>
        ),
      )}
    </Box>
  );
}
