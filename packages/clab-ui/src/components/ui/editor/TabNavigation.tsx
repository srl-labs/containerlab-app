// Tab strip with divider.
import React from "react";
import { Divider, Tabs } from "@mantine/core";

export interface TabDefinition {
  id: string;
  label: string;
  hidden?: boolean;
}

interface TabNavigationProps {
  tabs: TabDefinition[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export const TabNavigation: React.FC<TabNavigationProps> = ({ tabs, activeTab, onTabChange }) => {
  const visibleTabs = tabs.filter((t) => t.hidden !== true);
  const renderedTab = visibleTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : (visibleTabs[0]?.id ?? null);

  const handleChange = (newValue: string | null) => {
    if (newValue !== null) {
      onTabChange(newValue);
    }
  };

  return (
    <>
      <Tabs value={renderedTab} onChange={handleChange} style={{ minHeight: 36 }}>
        <Tabs.List style={{ flexWrap: "nowrap", overflowX: "auto" }}>
          {visibleTabs.map((tab) => (
            <Tabs.Tab
              key={tab.id}
              value={tab.id}
              data-tab={tab.id}
              data-testid={`panel-tab-${tab.id}`}
            >
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <Divider />
    </>
  );
};
