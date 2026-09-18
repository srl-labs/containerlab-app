import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/** Shared field geometry and surfaces; each host supplies its own controls. */
export function SettingsField({
  title,
  description,
  metadata,
  children,
  actions,
  feedback,
  wide = false,
  compactControl = false,
  dirty = false,
  settingKey,
}: {
  title: string;
  description: string;
  metadata?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  feedback?: React.ReactNode;
  wide?: boolean;
  compactControl?: boolean;
  dirty?: boolean;
  settingKey?: string;
}) {
  return (
    <Box
      component="section"
      data-setting-key={settingKey}
      aria-label={title}
      sx={{
        px: 1.75,
        py: 1.5,
        minWidth: 0,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: dirty ? "action.hover" : "transparent",
        boxShadow: dirty
          ? "inset 2px 0 var(--clab-ui-focus-border, var(--vscode-focusBorder))"
          : "none",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 1.25,
          alignItems: "center",
          "@container settings-content (min-width: 580px)": {
            gridTemplateColumns: wide
              ? "minmax(0, 1fr)"
              : "minmax(0, 1fr) minmax(220px, 0.85fr)",
            gap: 2.5,
          },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              flexWrap: "wrap",
            }}
          >
            <Typography
              component="h3"
              title={settingKey}
              sx={{
                fontWeight: 600,
                fontSize: "calc(0.825rem * var(--settings-font-scale, 1))",
                lineHeight: 1.5,
              }}
            >
              {title}
            </Typography>
            {metadata}
          </Box>
          <Typography
            variant="body2"
            sx={{
              mt: 0.375,
              fontSize: "calc(0.75rem * var(--settings-font-scale, 1))",
              lineHeight: 1.5,
              color: "text.secondary",
              whiteSpace: "pre-line",
              overflowWrap: "anywhere",
              maxWidth: 740,
            }}
          >
            {description}
          </Typography>
        </Box>
        <Box
          sx={{
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: compactControl ? "flex-end" : "stretch",
            gap: 0.75,
          }}
        >
          {children}
          {actions}
        </Box>
      </Box>
      {feedback && <Box sx={{ mt: 1 }}>{feedback}</Box>}
    </Box>
  );
}
