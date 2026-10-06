import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

import type { VarMap } from "../theme/devTheme";
import { DARK_MODERN_VARS, LIGHT_MODERN_VARS } from "../theme/modernThemes";
import { controlRadius, floatingRadius } from "../theme/surfaces";

const SELECTED_RING =
  "0 0 0 1px var(--clab-ui-button-background, var(--vscode-button-background))";

const PREVIEW_TOKENS = {
  background: "editor-background",
  sidebar: "sideBar-background",
  border: "panel-border",
  line: "descriptionForeground",
  accent: "button-background",
} as const;
type SchemeColors = Record<keyof typeof PREVIEW_TOKENS, string>;

function previewColors(read: (token: string) => string): SchemeColors {
  const colors = {} as SchemeColors;
  let key: keyof typeof PREVIEW_TOKENS;
  for (key in PREVIEW_TOKENS) colors[key] = read(`--vscode-${PREVIEW_TOKENS[key]}`);
  return colors;
}

/**
 * The host theme's own colors. Hosts set theme tokens inline on <html>, which the color scheme
 * override never touches, so Follow VS Code keeps previewing VS Code while Light or Dark is active.
 */
function hostColors(): SchemeColors {
  const style = document.documentElement.style;
  return previewColors((token) => style.getPropertyValue(token).trim() || `var(${token})`);
}

function useHostColors(): SchemeColors {
  const [colors, setColors] = useState(hostColors);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(hostColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);
  return colors;
}

/** Light and Dark preview the Modern palettes they apply; Follow VS Code previews the host theme. */
const SCHEMES = [
  { key: "vscode", label: "Follow VS Code", palette: undefined },
  { key: "light", label: "Light", palette: LIGHT_MODERN_VARS },
  { key: "dark", label: "Dark", palette: DARK_MODERN_VARS },
] as const satisfies ReadonlyArray<{ key: string; label: string; palette: VarMap | undefined }>;
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
  const host = useHostColors();
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
        (scheme) => {
          const colors = scheme.palette ? previewColors((token) => scheme.palette[token]) : host;
          return (
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
                background: colors.background,
                borderColor: colors.border,
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
                  background: colors.sidebar,
                  borderColor: colors.border,
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
                    style={{ background: colors.line }}
                    sx={{
                      width: `${width}%`,
                      height: 3,
                      borderRadius: 1,
                      opacity: 0.6,
                    }}
                  />
                ))}
                <Box
                  style={{ background: colors.accent }}
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
          );
        },
      )}
    </Box>
  );
}
