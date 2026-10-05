import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/** Width every inline field shares, so selects and text fields line up down the page. */
const CONTROL_WIDTH = 240;

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
  const inline = !wide;
  const fixedWidth = inline && !compactControl;
  return (
    <Box
      component="section"
      data-settings-row=""
      data-setting-key={settingKey}
      aria-label={title}
      sx={{
        display: "grid",
        gridTemplateColumns: inline ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)",
        columnGap: 4,
        rowGap: inline ? 0 : 1.5,
        alignItems: "center",
        minWidth: 0,
        "@container settings-content (max-width: 560px)": {
          gridTemplateColumns: "minmax(0, 1fr)",
          rowGap: 1.25,
        },
      }}
    >
      <Box
        sx={{
          position: "relative",
          minWidth: 0,
          // Unsaved drafts get a bar in the gutter, like modified settings in VS Code.
          "&::before": dirty
            ? {
                content: '""',
                position: "absolute",
                left: -12,
                top: 2,
                bottom: 2,
                width: 2,
                borderRadius: 1,
                bgcolor: "primary.main",
              }
            : undefined,
        }}
      >
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
            variant="body1"
            title={settingKey}
            sx={{ fontWeight: 500 }}
          >
            {title}
          </Typography>
          {metadata}
        </Box>
        <Typography
          variant="body2"
          sx={{
            mt: 0.25,
            color: "text.secondary",
            whiteSpace: "pre-line",
            overflowWrap: "anywhere",
            maxWidth: 680,
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
          alignItems: inline ? "flex-end" : "stretch",
          // Stacked fields need room for the next field's notched label.
          gap: inline ? 0.75 : 1.5,
          ...(fixedWidth
            ? {
                width: CONTROL_WIDTH,
                "& > .MuiFormControl-root": { width: "100%" },
              }
            : {}),
          "@container settings-content (max-width: 560px)": {
            width: "100%",
            alignItems: fixedWidth ? "stretch" : "flex-start",
          },
        }}
      >
        {children}
        {actions}
      </Box>
      {feedback ? <Box sx={{ gridColumn: "1 / -1", mt: 1 }}>{feedback}</Box> : null}
    </Box>
  );
}
