import { lazy, Suspense, useMemo } from "react";

import { useEndpointStore } from "../stores/endpointStore";
import { isFileLabTab, useLabTabsStore } from "../stores/labTabsStore";
import { LabTabsBar } from "./LabTabsBar";
import { AttractorEmptyState } from "./AttractorEmptyState";

const FileEditor = lazy(async () => ({
  default: (await import("./FileEditorTabPanel")).FileEditorTabPanel
}));

interface TabActions {
  onActivate: (tabId: string) => Promise<void>;
  onClose: (tabId: string) => Promise<void>;
}

export function StandaloneLabTabs({ onActivate, onClose }: TabActions) {
  const tabs = useLabTabsStore((state) => state.tabs);
  const activeTabId = useLabTabsStore((state) => state.activeTabId);
  const endpoints = useEndpointStore((state) => state.endpoints);
  const endpointLabels = useMemo(
    () => new Map(Array.from(endpoints.values(), (endpoint) => [endpoint.id, endpoint.label])),
    [endpoints]
  );
  return (
    <LabTabsBar
      tabs={tabs}
      activeTabId={activeTabId}
      endpointLabels={endpointLabels}
      onActivate={(id) => {
        void onActivate(id);
      }}
      onClose={(id) => {
        void onClose(id);
      }}
    />
  );
}

export function StandaloneFileEditor({ onClose }: Pick<TabActions, "onClose">) {
  const tab = useLabTabsStore((state) =>
    state.tabs.find((entry) => entry.id === state.activeTabId)
  );
  if (!isFileLabTab(tab)) return null;
  return (
    <Suspense fallback={null}>
      <FileEditor
        tab={tab}
        onClose={(id) => {
          void onClose(id);
        }}
      />
    </Suspense>
  );
}

export function StandaloneLabEmptyState({ onCreateLab }: { onCreateLab: () => Promise<void> }) {
  const hasTabs = useLabTabsStore((state) => state.tabs.length > 0);
  if (hasTabs) return null;
  return <AttractorEmptyState onCreateLab={() => { void onCreateLab(); }} />;
}
