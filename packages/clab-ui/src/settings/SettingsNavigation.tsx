import React from "react";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Typography from "@mui/material/Typography";

export interface SettingsNavigationItem {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  count?: number;
}
export function SettingsNavigation({
  items,
  active,
  onSelect,
  testIdPrefix,
}: {
  items: SettingsNavigationItem[];
  active: string;
  onSelect: (key: string) => void;
  testIdPrefix?: string;
}) {
  return (
    <List
      component="nav"
      aria-label="Settings categories"
      sx={{
        p: 1,
        display: "flex",
        flexDirection: "row",
        gap: 0.25,
        minHeight: 0,
        overflow: "auto",
        "@container settings-layout (min-width: 720px)": {
          flexDirection: "column",
          pt: 1.5,
        },
      }}
    >
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <ListItemButton
            key={item.key}
            selected={selected}
            onClick={() => onSelect(item.key)}
            aria-label={item.label}
            data-testid={
              testIdPrefix ? `${testIdPrefix}${item.key}` : undefined
            }
            aria-current={selected ? "page" : undefined}
            sx={{
              minHeight: 32,
              px: 1.25,
              py: 0.5,
              gap: 1.25,
              flex: "0 0 auto",
              minWidth: "max-content",
              color: selected ? "text.primary" : "text.secondary",
              transition: "background-color 120ms ease, color 120ms ease",
              "&:hover": { color: "text.primary" },
              "@container settings-layout (min-width: 720px)": { minWidth: 0 },
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }}
          >
            <Box
              sx={{
                display: "flex",
                color: selected
                  ? "var(--vscode-icon-foreground)"
                  : "text.secondary",
                "& svg": { fontSize: 16 },
              }}
            >
              {item.icon}
            </Box>
            <Typography
              noWrap
              variant="body1"
              sx={{ flex: 1, fontWeight: selected ? 500 : 400 }}
            >
              {item.label}
            </Typography>
            {item.count !== undefined && (
              <Typography
                component="span"
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {item.count}
              </Typography>
            )}
          </ListItemButton>
        );
      })}
    </List>
  );
}
