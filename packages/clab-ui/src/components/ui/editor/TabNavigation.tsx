// Tab strip: underlined primary tabs, or compact pill tabs for a nested level.
import React from "react";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import type { SxProps, Theme } from "@mui/material/styles";

import { controlRadius } from "../../../theme/surfaces";

export interface TabDefinition {
  id: string;
  label: string;
  hidden?: boolean;
}

interface TabNavigationProps {
  tabs: TabDefinition[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  /** "secondary" renders quiet pills for a tab level nested under another tab strip. */
  variant?: "primary" | "secondary";
}

const HIDDEN_SCROLL_BUTTON_SX = {
  "& .MuiTabs-scrollButtons.Mui-disabled": {
    width: 0,
    minWidth: 0,
    opacity: 0,
    overflow: "hidden"
  }
} as const;

// Labels sit on the panel gutter and the indicator spans the label only.
const PRIMARY_TABS_SX: SxProps<Theme> = {
  ...HIDDEN_SCROLL_BUTTON_SX,
  minHeight: 36,
  px: 2,
  borderBottom: 1,
  borderColor: "divider",
  "& .MuiTabs-list": { gap: 2.5 },
  "& .MuiTab-root": { px: 0, minHeight: 36 }
};

const SECONDARY_TABS_SX: SxProps<Theme> = {
  ...HIDDEN_SCROLL_BUTTON_SX,
  minHeight: 0,
  px: 1,
  pt: 1.5,
  "& .MuiTabs-indicator": { display: "none" },
  "& .MuiTabs-list": { gap: 0.5 },
  "& .MuiTab-root": {
    minHeight: 26,
    py: 0.5,
    px: 1,
    fontSize: (theme) => theme.typography.body2.fontSize,
    borderRadius: controlRadius,
    transition: "color 120ms ease, background-color 120ms ease",
    "&:hover": { bgcolor: "action.hover" },
    "&.Mui-selected": { bgcolor: "action.selected" }
  }
};

export const TabNavigation: React.FC<TabNavigationProps> = ({
  tabs,
  activeTab,
  onTabChange,
  variant = "primary"
}) => {
  const visibleTabs = tabs.filter((t) => t.hidden !== true);
  const renderedTab = visibleTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : (visibleTabs[0]?.id ?? false);

  const handleChange = (_event: React.SyntheticEvent, newValue: string) => {
    onTabChange(newValue);
  };

  return (
    <Tabs
      value={renderedTab}
      onChange={handleChange}
      variant="scrollable"
      scrollButtons="auto"
      sx={variant === "secondary" ? SECONDARY_TABS_SX : PRIMARY_TABS_SX}
    >
      {visibleTabs.map((tab) => (
        <Tab
          key={tab.id}
          value={tab.id}
          label={tab.label}
          data-tab={tab.id}
          data-testid={`panel-tab-${tab.id}`}
        />
      ))}
    </Tabs>
  );
};
