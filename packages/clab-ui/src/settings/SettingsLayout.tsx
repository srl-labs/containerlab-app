import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TuneIcon from "@mui/icons-material/Tune";
import {
  SettingsNavigation,
  type SettingsNavigationItem,
} from "./SettingsNavigation";

/** The same settings frame is used inside the app dialog and the VS Code editor. */
export function SettingsLayout({
  items,
  active,
  onSelect,
  navigationTestIdPrefix,
  headerActions,
  toolbar,
  title = "Settings",
  titleId = "containerlab-settings-title",
  sectionTitle,
  sectionDescription,
  sectionActions,
  navigationFooter,
  footer,
  children,
}: {
  items: SettingsNavigationItem[];
  active: string;
  onSelect: (key: string) => void;
  navigationTestIdPrefix?: string;
  headerActions?: React.ReactNode;
  toolbar?: React.ReactNode;
  title?: string;
  titleId?: string;
  sectionTitle: string;
  sectionDescription?: string;
  sectionActions?: React.ReactNode;
  navigationFooter?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box
      data-testid="settings-layout"
      sx={{
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        bgcolor: "transparent",
        color: "text.primary",
        containerType: "inline-size",
        containerName: "settings-layout",
        // Inputs keep a fixed size in the theme; settings follow the host font size.
        "--settings-font-scale": (theme) => theme.typography.fontSize / 13,
        "& .MuiInputBase-root": {
          fontSize: "calc(0.8125rem * var(--settings-font-scale, 1))",
        },
      }}
    >
      <Box
        component="header"
        sx={{
          pl: 2.5,
          pr: 1.5,
          minHeight: 48,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <TuneIcon
          sx={{ fontSize: 18, color: "var(--vscode-icon-foreground)" }}
        />
        <Typography id={titleId} component="h1" variant="h6">
          {title}
        </Typography>
        <Box
          sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5 }}
        >
          {headerActions}
        </Box>
      </Box>
      <Box
        sx={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          flexDirection: "column",
          "@container settings-layout (min-width: 720px)": {
            flexDirection: "row",
          },
        }}
      >
        <Box
          component="aside"
          sx={{
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            minHeight: 0,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "transparent",
            "@container settings-layout (min-width: 720px)": {
              width: 208,
              borderBottom: 0,
              borderRight: 1,
              borderColor: "divider",
            },
          }}
        >
          <SettingsNavigation
            items={items}
            active={active}
            onSelect={onSelect}
            testIdPrefix={navigationTestIdPrefix}
          />
          {navigationFooter && (
            <Box
              sx={{
                mt: "auto",
                px: 2,
                py: 1.5,
                display: "none",
                "@container settings-layout (min-width: 720px)": {
                  display: "block",
                },
              }}
            >
              {navigationFooter}
            </Box>
          )}
        </Box>
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {toolbar && (
            <Box
              data-testid="settings-toolbar"
              sx={{
                px: { xs: 2, sm: 3 },
                py: 1.5,
                borderBottom: 1,
                borderColor: "divider",
                flexShrink: 0,
              }}
            >
              {toolbar}
            </Box>
          )}
          <Box
            component="main"
            sx={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              overflow: "auto",
              px: { xs: 2, sm: 3 },
              pt: 2.5,
              pb: 3,
              display: "grid",
              alignContent: "start",
              rowGap: 2,
              containerType: "inline-size",
              containerName: "settings-content",
              // Consecutive setting rows read as one list, split by hairlines.
              "& [data-settings-row] + [data-settings-row]": {
                pt: 2,
                borderTop: 1,
                borderColor: "divider",
              },
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                mb: 0.5,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography component="h2" variant="h5">
                  {sectionTitle}
                </Typography>
                {sectionDescription && (
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.5, color: "text.secondary" }}
                  >
                    {sectionDescription}
                  </Typography>
                )}
              </Box>
              {sectionActions}
            </Box>
            {children}
          </Box>
        </Box>
      </Box>
      {footer && (
        <Box
          component="footer"
          sx={{
            px: 2.5,
            py: 1.25,
            borderTop: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            flexShrink: 0,
          }}
        >
          {footer}
        </Box>
      )}
    </Box>
  );
}
