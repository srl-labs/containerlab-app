import { useMemo } from "react";

import { ConnectionBanner, LabHostUnavailable } from "@containerlab/clab-ui/workspace";
import { dispatchEndpointUiAction, isFileLabTab, useLabTabsStore } from "@containerlab/clab-ui/workspace/state";
import { getStandaloneBackend } from "../backend";
import { collectConnectionIssues } from "../connectionIssues";
import { retryEndpointConnection } from "../hooks/useEventStream";
import { useEndpointStore } from "../stores/endpointStore";
import { useEventStreamStore } from "../stores/eventStreamStore";
import { useWorkspaceViewStore } from "../stores/workspaceViewStore";

function signIn(endpointId: string): void {
  dispatchEndpointUiAction({ action: "reconnect", endpointId });
}

/** API and live-events problems of each lab host, above the document; the workspace stays usable. */
export function StandaloneConnectionBanner() {
  const endpoints = useEndpointStore((state) => state.endpoints);
  const streams = useEventStreamStore((state) => state.streams);
  const issues = useMemo(
    () => collectConnectionIssues(endpoints.values(), streams, getStandaloneBackend().capabilities.events),
    [endpoints, streams]
  );
  return <ConnectionBanner issues={issues} onRetry={retryEndpointConnection} onSignIn={signIn} />;
}

/** Whether the active tab is a lab that could not load because its lab host does not answer. */
export function useActiveTabUnavailable(): boolean {
  const unavailableTabId = useWorkspaceViewStore((state) => state.unavailableTabId);
  const activeTabId = useLabTabsStore((state) => state.activeTabId);
  return unavailableTabId !== null && unavailableTabId === activeTabId;
}

export function StandaloneLabHostUnavailable() {
  const tab = useLabTabsStore((state) => state.tabs.find((entry) => entry.id === state.activeTabId));
  const endpoint = useEndpointStore((state) => (tab ? state.endpoints.get(tab.endpointId) : undefined));
  if (!tab || isFileLabTab(tab)) return null;
  const needsSignIn = endpoint?.status === "session_expired" || endpoint?.status === "saved";
  return (
    <LabHostUnavailable
      labTitle={tab.title}
      hostLabel={endpoint?.label ?? tab.endpointId}
      needsSignIn={needsSignIn}
      onRetry={() => retryEndpointConnection(tab.endpointId)}
      onSignIn={() => signIn(tab.endpointId)}
    />
  );
}
