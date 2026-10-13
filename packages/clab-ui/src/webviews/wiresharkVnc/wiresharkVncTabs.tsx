// Several Wireshark capture sessions in one window: one tab per session, or all side by side.
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import React from "react";
import { createRoot } from "react-dom/client";

import { WiresharkIcon } from "../../components/context-menu/WiresharkIcon";
import { MuiThemeProvider } from "../../theme/index";
import { MONO_FONT_FAMILY } from "../../theme/typography";

import type { WiresharkVncLayout, WiresharkVncTab } from "./types";
import { readWiresharkVncLayout, sideBySideGrid, writeWiresharkVncLayout } from "./wiresharkVncLayout";
import { WiresharkVncSessionStrip, panelId, tabId } from "./wiresharkVncSessionStrip";

const CAPTION_HEIGHT = 26;

const PanelCaption: React.FC<{
  label: string;
  hidden: boolean;
  onShowAsTab: () => void;
}> = ({ label, hidden, onShowAsTab }) => (
  <Box
    sx={{
      display: hidden ? "none" : "flex",
      alignItems: "center",
      gap: 0.75,
      flexShrink: 0,
      height: CAPTION_HEIGHT,
      pl: 1.25,
      pr: 0.5,
      color: "text.secondary",
      bgcolor: "background.default",
      borderBottom: 1,
      borderColor: "divider"
    }}
  >
    <WiresharkIcon sx={{ fontSize: 13, flexShrink: 0 }} />
    <Box
      component="span"
      title={label}
      sx={{
        flexGrow: 1,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: MONO_FONT_FAMILY,
        fontSize: 12,
        color: "text.primary"
      }}
    >
      {label}
    </Box>
    <Tooltip title="Show as tab">
      <IconButton
        size="small"
        aria-label={`Show ${label} as tab`}
        onClick={onShowAsTab}
        sx={{ width: 20, height: 20, p: 0, borderRadius: 1, color: "inherit" }}
      >
        <OpenInFullIcon sx={{ fontSize: 12 }} />
      </IconButton>
    </Tooltip>
  </Box>
);

export interface WiresharkVncTabsAppProps {
  tabs: readonly WiresharkVncTab[];
}

/**
 * Each session keeps its own frame for the life of the page: frames are never
 * moved or remounted, since reloading one would close its capture session.
 * Hidden tabs stay laid out at full size so the VNC viewer keeps its viewport.
 */
export function WiresharkVncTabsApp({ tabs }: WiresharkVncTabsAppProps): React.JSX.Element {
  const [layout, setLayout] = React.useState<WiresharkVncLayout>(readWiresharkVncLayout);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const grid = sideBySideGrid(tabs.length);
  const tabbed = layout === "tabs";

  const changeLayout = React.useCallback((next: WiresharkVncLayout) => {
    setLayout(next);
    writeWiresharkVncLayout(next);
  }, []);

  return (
    <MuiThemeProvider>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          bgcolor: "background.default"
        }}
      >
        <WiresharkVncSessionStrip
          tabs={tabs}
          layout={layout}
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
          onLayoutChange={changeLayout}
        />

        <Box
          data-testid="wireshark-session-panels"
          data-layout={layout}
          sx={{
            position: "relative",
            flex: "1 1 auto",
            minHeight: 0,
            ...(tabbed
              ? {}
              : {
                  display: "grid",
                  gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
                  gap: "1px",
                  bgcolor: "divider"
                })
          }}
        >
          {tabs.map((tab, index) => {
            const visible = !tabbed || index === activeIndex;
            const last = index === tabs.length - 1;
            return (
              <Box
                key={tab.id}
                id={panelId(index)}
                role={tabbed ? "tabpanel" : "group"}
                aria-labelledby={tabbed ? tabId(index) : undefined}
                aria-label={tabbed ? undefined : tab.label}
                data-testid="wireshark-session-panel"
                data-active={visible}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  minHeight: 0,
                  bgcolor: "background.default",
                  ...(tabbed
                    ? {
                        position: "absolute",
                        inset: 0,
                        zIndex: visible ? 1 : 0,
                        visibility: visible ? "visible" : "hidden",
                        pointerEvents: visible ? "auto" : "none"
                      }
                    : {
                        position: "relative",
                        gridColumn: last ? `span ${grid.lastSpan}` : undefined
                      })
                }}
              >
                <PanelCaption
                  label={tab.label}
                  hidden={tabbed}
                  onShowAsTab={() => {
                    setActiveIndex(index);
                    changeLayout("tabs");
                  }}
                />
                <Box
                  component="iframe"
                  title={`Wireshark ${tab.label}`}
                  src={tab.src}
                  sx={{
                    display: "block",
                    flex: "1 1 auto",
                    width: "100%",
                    minHeight: 0,
                    border: 0
                  }}
                />
              </Box>
            );
          })}
        </Box>
      </Box>
    </MuiThemeProvider>
  );
}

export function bootstrapWiresharkVncTabs(tabs: readonly WiresharkVncTab[]): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Wireshark VNC root element not found");
  }

  createRoot(container).render(
    <React.StrictMode>
      <WiresharkVncTabsApp tabs={tabs} />
    </React.StrictMode>
  );
}
