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
  /** The heading the item sits under, e.g. "App" or "Lab hosts"; shown where the menu is a column. */
  group?: string;
  /** A lab host's status, as a dot in place of the icon. */
  status?: "connected" | "saved" | "session_expired" | "offline";
  /** A quiet tag after the label, e.g. a lab host's kind. */
  tag?: string;
  /** An action rather than a page, e.g. "Add lab host". */
  accent?: boolean;
}

const STATUS_COLORS: Record<NonNullable<SettingsNavigationItem["status"]>, string> = {
  connected: "success.main",
  saved: "text.disabled",
  session_expired: "warning.main",
  offline: "error.main"
};

function GroupHeading(props: { label: string }) {
  return (
    <Typography
      component="div"
      role="presentation"
      variant="overline"
      sx={{
        display: "none",
        color: "text.secondary",
        px: 1.25,
        pt: 1.25,
        pb: 0.25,
        lineHeight: 1.6,
        fontSize: 10.5,
        letterSpacing: "0.06em",
        "&:first-of-type": { pt: 0 },
        "@container settings-layout (min-width: 720px)": { display: "block" }
      }}
    >
      {props.label}
    </Typography>
  );
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
      {items.map((item, index) => {
        const selected = item.key === active;
        const heading =
          item.group !== undefined && item.group !== items[index - 1]?.group ? (
            <GroupHeading key={`group:${item.group}`} label={item.group} />
          ) : null;
        return [
          heading,
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
              {item.status ? (
                <Box
                  aria-hidden="true"
                  data-status={item.status}
                  sx={{ width: 8, height: 8, mx: "4px", borderRadius: "50%", bgcolor: STATUS_COLORS[item.status] }}
                />
              ) : (
                item.icon
              )}
            </Box>
            <Typography
              noWrap
              variant="body1"
              sx={{
                flex: 1,
                fontWeight: selected ? 500 : 400,
                ...(item.accent ? { color: "primary.main" } : {})
              }}
            >
              {item.label}
            </Typography>
            {item.tag !== undefined && (
              <Typography
                component="span"
                variant="caption"
                noWrap
                sx={{
                  flexShrink: 0,
                  maxWidth: 96,
                  fontSize: 10,
                  lineHeight: "16px",
                  px: 0.625,
                  borderRadius: 0.5,
                  border: 1,
                  borderColor: "divider",
                  color: "text.secondary"
                }}
              >
                {item.tag}
              </Typography>
            )}
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
        ];
      })}
    </List>
  );
}
