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
        bgcolor: "background.default",
        color: "text.primary",
        containerType: "inline-size",
        containerName: "settings-layout",
        "--settings-font-scale": (theme) => theme.typography.fontSize / 13,
        "& .MuiButton-root": { textTransform: "none" },
        "& .MuiInputBase-root": {
          fontSize: "calc(0.8125rem * var(--settings-font-scale, 1))",
        },
      }}
    >
      <Box
        component="header"
        sx={{
          px: 2,
          minHeight: 50,
          display: "flex",
          alignItems: "center",
          gap: 1,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <TuneIcon sx={{ fontSize: 20, color: "text.secondary" }} />
        <Typography
          id="containerlab-settings-title"
          component="h1"
          sx={{
            fontSize: "calc(1rem * var(--settings-font-scale, 1))",
            fontWeight: 650,
            letterSpacing: "-0.02em",
          }}
        >
          Settings
        </Typography>
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>
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
            bgcolor: "background.paper",
            "@container settings-layout (min-width: 720px)": {
              width: 196,
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
                p: 1.5,
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
                px: 2,
                py: 1.25,
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
              px: { xs: 1.5, sm: 2.5 },
              py: 2,
              containerType: "inline-size",
              containerName: "settings-content",
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                mb: 1.5,
              }}
            >
              <Box>
                <Typography
                  component="h2"
                  sx={{
                    fontSize: "calc(1.125rem * var(--settings-font-scale, 1))",
                    fontWeight: 650,
                    letterSpacing: "-0.025em",
                  }}
                >
                  {sectionTitle}
                </Typography>
                {sectionDescription && (
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 0.25,
                      fontSize: "calc(0.75rem * var(--settings-font-scale, 1))",
                      color: "text.secondary",
                    }}
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
            px: 2,
            py: 0.75,
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
