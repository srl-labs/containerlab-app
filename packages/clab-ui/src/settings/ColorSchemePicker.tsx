import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

import { DARK_VARS, LIGHT_VARS, type VarMap } from "../theme/devTheme";
import { controlRadius, floatingRadius } from "../theme/surfaces";

const SELECTED_RING =
  "0 0 0 1px var(--clab-ui-button-background, var(--vscode-button-background))";

/** Light and Dark preview their own palettes; Follow VS Code previews the host theme. */
function schemeColors(vars?: VarMap) {
  const color = (token: string) =>
    vars ? vars[`--vscode-${token}`] : `var(--vscode-${token})`;
  return {
    background: color("editor-background"),
    sidebar: color("sideBar-background"),
    border: color("panel-border"),
    line: color("descriptionForeground"),
    accent: color("button-background"),
  };
}

const SCHEMES = [
  { key: "vscode", label: "Follow VS Code", colors: schemeColors() },
  { key: "light", label: "Light", colors: schemeColors(LIGHT_VARS) },
  { key: "dark", label: "Dark", colors: schemeColors(DARK_VARS) },
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
              p: 0.5,
              display: "block",
              color: "text.primary",
              borderColor: value === scheme.key ? "primary.main" : "divider",
              boxShadow: value === scheme.key ? SELECTED_RING : "none",
              borderRadius: floatingRadius,
              "&:hover": {
                borderColor:
                  value === scheme.key ? "primary.main" : "text.secondary",
              },
            }}
          >
            <Box
              style={{
                background: scheme.colors.background,
                borderColor: scheme.colors.border,
              }}
              sx={{
                height: 44,
                borderRadius: controlRadius,
                border: "1px solid",
                display: "flex",
                overflow: "hidden",
                mb: 0.75,
              }}
            >
              <Box
                style={{
                  background: scheme.colors.sidebar,
                  borderColor: scheme.colors.border,
                }}
                sx={{ width: "28%", borderRight: "1px solid" }}
              />
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.5,
                  p: 0.75,
                }}
              >
                {[70, 90, 50].map((width) => (
                  <Box
                    key={width}
                    style={{ background: scheme.colors.line }}
                    sx={{
                      width: `${width}%`,
                      height: 3,
                      borderRadius: 1,
                      opacity: 0.6,
                    }}
                  />
                ))}
                <Box
                  style={{ background: scheme.colors.accent }}
                  sx={{
                    mt: "auto",
                    alignSelf: "flex-end",
                    width: 18,
                    height: 6,
                    borderRadius: "2px",
                  }}
                />
              </Box>
            </Box>
            <Typography
              variant="body2"
              sx={{ fontWeight: 500, pb: 0.25, textAlign: "center" }}
            >
              {scheme.label}
            </Typography>
          </Button>
        ),
      )}
    </Box>
  );
}
