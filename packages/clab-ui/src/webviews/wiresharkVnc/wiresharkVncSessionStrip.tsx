// Tab strip of the multi-session Wireshark page: a tab per session and the layout toggle.
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import TabOutlinedIcon from "@mui/icons-material/TabOutlined";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import React from "react";

import { WiresharkIcon } from "../../components/context-menu/WiresharkIcon";
import { vscodePalette } from "../../theme/vscodePalette";
import { MONO_FONT_FAMILY } from "../../theme/typography";

import type { WiresharkVncLayout, WiresharkVncTab } from "./types";

const STRIP_HEIGHT = 34;
const FOCUS_RING = { outline: `1px solid ${vscodePalette.action.focus}`, outlineOffset: -1 } as const;

export const tabId = (index: number) => `wireshark-tab-${index}`;
export const panelId = (index: number) => `wireshark-panel-${index}`;

function nextTabIndex(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

const SessionTab: React.FC<{
  tab: WiresharkVncTab;
  index: number;
  active: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onSelect: (index: number) => void;
  onKeyDown: (event: React.KeyboardEvent, index: number) => void;
}> = ({ tab, index, active, buttonRef, onSelect, onKeyDown }) => (
  <ButtonBase
    ref={buttonRef}
    role="tab"
    id={tabId(index)}
    aria-selected={active}
    aria-controls={panelId(index)}
    tabIndex={active ? 0 : -1}
    title={tab.label}
    onClick={() => onSelect(index)}
    onKeyDown={(event) => onKeyDown(event, index)}
    data-testid="wireshark-session-tab"
    sx={{
      position: "relative",
      flex: "0 0 auto",
      maxWidth: 260,
      height: "100%",
      gap: 0.75,
      px: 1.5,
      justifyContent: "flex-start",
      color: active ? "text.primary" : "text.secondary",
      transition: "color 120ms ease, background-color 120ms ease",
      "&:hover": { bgcolor: "action.hover", color: "text.primary" },
      "&.Mui-focusVisible": FOCUS_RING,
      "&::after": {
        content: '""',
        position: "absolute",
        insetInline: 0,
        bottom: 0,
        height: 2,
        bgcolor: active ? "primary.main" : "transparent"
      }
    }}
  >
    <WiresharkIcon sx={{ fontSize: 14, flexShrink: 0 }} />
    <Box
      component="span"
      sx={{
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: MONO_FONT_FAMILY,
        fontSize: 12,
        lineHeight: 1
      }}
    >
      {tab.label}
    </Box>
  </ButtonBase>
);

const LayoutToggle: React.FC<{
  layout: WiresharkVncLayout;
  onChange: (layout: WiresharkVncLayout) => void;
}> = ({ layout, onChange }) => (
  <ToggleButtonGroup
    exclusive
    size="small"
    value={layout}
    onChange={(_event, value: unknown) => {
      if (value === "tabs" || value === "side-by-side") onChange(value);
    }}
    aria-label="Layout"
    data-testid="wireshark-layout"
    sx={{
      flexShrink: 0,
      mx: 1,
      "& .MuiToggleButton-root": {
        minHeight: 24,
        py: 0,
        px: 1,
        gap: 0.625,
        fontSize: 12,
        lineHeight: "22px"
      }
    }}
  >
    <ToggleButton value="tabs" aria-label="Tabs" data-testid="wireshark-layout-tabs">
      <TabOutlinedIcon sx={{ fontSize: 14 }} />
      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
        Tabs
      </Box>
    </ToggleButton>
    <ToggleButton
      value="side-by-side"
      aria-label="Side by side"
      data-testid="wireshark-layout-side-by-side"
    >
      <GridViewOutlinedIcon sx={{ fontSize: 14 }} />
      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
        Side by side
      </Box>
    </ToggleButton>
  </ToggleButtonGroup>
);

/** Shown in the strip instead of the tabs while every session is visible. */
const SessionCount: React.FC<{ count: number }> = ({ count }) => (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 0.75,
      px: 1.5,
      minWidth: 0,
      color: "text.secondary"
    }}
  >
    <WiresharkIcon sx={{ fontSize: 14, flexShrink: 0 }} />
    <Typography component="span" noWrap sx={{ fontSize: 12 }}>
      {count} captures
    </Typography>
  </Box>
);

export interface WiresharkVncSessionStripProps {
  tabs: readonly WiresharkVncTab[];
  layout: WiresharkVncLayout;
  activeIndex: number;
  onSelect: (index: number) => void;
  onLayoutChange: (layout: WiresharkVncLayout) => void;
}

export function WiresharkVncSessionStrip({
  tabs,
  layout,
  activeIndex,
  onSelect,
  onLayoutChange
}: WiresharkVncSessionStripProps): React.JSX.Element {
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // Tabs that do not fit scroll; keep the active one in view.
  React.useEffect(() => {
    tabRefs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex, layout]);

  const handleTabKeyDown = React.useCallback(
    (event: React.KeyboardEvent, index: number) => {
      const next = nextTabIndex(event.key, index, tabs.length);
      if (next === undefined) return;
      event.preventDefault();
      onSelect(next);
      tabRefs.current[next]?.focus();
    },
    [onSelect, tabs.length]
  );

  return (
    <Box
      data-testid="wireshark-session-strip"
      sx={{
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        height: STRIP_HEIGHT,
        bgcolor: "background.default",
        borderBottom: 1,
        borderColor: "divider"
      }}
    >
      {layout === "tabs" ? (
        <Box
          role="tablist"
          aria-label="Capture sessions"
          sx={{
            display: "flex",
            alignSelf: "stretch",
            flex: "1 1 auto",
            minWidth: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" }
          }}
        >
          {tabs.map((tab, index) => (
            <SessionTab
              key={tab.id}
              tab={tab}
              index={index}
              active={index === activeIndex}
              buttonRef={(element) => {
                tabRefs.current[index] = element;
              }}
              onSelect={onSelect}
              onKeyDown={handleTabKeyDown}
            />
          ))}
        </Box>
      ) : (
        <Box sx={{ display: "flex", flex: "1 1 auto", minWidth: 0 }}>
          <SessionCount count={tabs.length} />
        </Box>
      )}
      <LayoutToggle layout={layout} onChange={onLayoutChange} />
    </Box>
  );
}
