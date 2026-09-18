import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { useEndpointStore } from "../stores/endpointStore";
import { isFileLabTab, useLabTabsStore } from "../stores/labTabsStore";
import { LabTabsBar } from "./LabTabsBar";

const FileEditor = lazy(async () => ({
  default: (await import("./FileEditorTabPanel")).FileEditorTabPanel
}));
const EmptyState = lazy(async () => ({
  default: (await import("./AttractorEmptyState")).AttractorEmptyState
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
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (hasTabs) {
      setReady(false);
      return;
    }
    const timer = window.setTimeout(() => setReady(true), 750);
    return () => window.clearTimeout(timer);
  }, [hasTabs]);
  if (hasTabs || !ready) return null;
  return (
    <Suspense fallback={null}>
      <EmptyState onCreateLab={() => { void onCreateLab(); }} />
    </Suspense>
  );
}
