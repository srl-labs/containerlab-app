import React from "react";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { floatingRadius } from "../theme/surfaces";

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
        },
      }}
    >
      {items.map((item) => (
        <Tooltip
          key={item.key}
          title={item.description}
          placement="right"
          enterDelay={600}
        >
          <ListItemButton
            selected={item.key === active}
            onClick={() => onSelect(item.key)}
            aria-label={item.label}
            data-testid={
              testIdPrefix ? `${testIdPrefix}${item.key}` : undefined
            }
            aria-current={item.key === active ? "page" : undefined}
            sx={{
              borderRadius: floatingRadius,
              px: 1.25,
              py: 0.9,
              gap: 1,
              flex: "0 0 auto",
              minWidth: "max-content",
              color: "text.secondary",
              "@container settings-layout (min-width: 720px)": { minWidth: 0 },
              "&.Mui-selected": {
                bgcolor: "action.selected",
                color: "text.primary",
              },
              "&.Mui-selected:hover": { bgcolor: "action.hover" },
            }}
          >
            <Box
              sx={{
                display: "flex",
                "& svg": { fontSize: 17 },
                opacity: item.key === active ? 1 : 0.8,
              }}
            >
              {item.icon}
            </Box>
            <Typography
              noWrap
              sx={{
                fontSize: "calc(0.79rem * var(--settings-font-scale, 1))",
                fontWeight: item.key === active ? 600 : 450,
                flex: 1,
              }}
            >
              {item.label}
            </Typography>
            {item.count !== undefined && (
              <Typography
                component="span"
                sx={{
                  color: "text.secondary",
                  fontSize: "calc(0.67rem * var(--settings-font-scale, 1))",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {item.count}
              </Typography>
            )}
          </ListItemButton>
        </Tooltip>
      ))}
    </List>
  );
}
