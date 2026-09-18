import React, { createContext, useContext, useSyncExternalStore } from "react";
import type { TopologyRef } from "../session";
import type {
  EdgeSharkStatusResponse, EndpointHealthMetrics, FileExplorerEntry, InspectAllLabsResponse, InspectLabResponse,
  InterfaceNetemPatch, LabState, LogsResponse, RuntimeTargetRequest, TerminalProtocol,
  TerminalSessionInfo, VersionCheckResponse, VersionResponse
} from "./types";
import type { TopologyFileEntry } from "./state/documentUtils";
import type { RuntimeTerminalPane } from "./state/runtimeUiStore";

type NodeTarget = RuntimeTargetRequest & { nodeName: string };
type InterfaceTarget = NodeTarget & { interfaceName: string };

/** Operations and live data supplied by the embedding host, never imported from an app. */
export interface WorkspaceHost {
  capabilities: { lifecycle: boolean; endpoints: boolean };
  assetUrl: (path: string) => string;
  openTerminalWindow: (pane: RuntimeTerminalPane) => void;
  labs: {
    getSnapshot: () => Map<string, LabState>;
    subscribe: (listener: () => void) => () => void;
    updateInterfaceNetemState: (update: { endpointId?: string; topologyPath?: string; labName?: string; nodeName: string; interfaceName: string; netem: InterfaceNetemPatch }) => void;
  };
  explorer: {
    listTopologies: () => Promise<TopologyFileEntry[]>;
    listDirectory: (parentPath: string) => Promise<FileExplorerEntry[]>;
    subscribe: (listener: () => void) => () => void;
    createTopology: () => void;
    openTopology: (topologyRef: TopologyRef) => void | Promise<void>;
    openFile: (entry: FileExplorerEntry) => void | Promise<void>;
  };
  api: {
    fetchEndpointHealthMetrics: (endpointId: string, signal?: AbortSignal) => Promise<EndpointHealthMetrics>;
    writeFileExplorerFile: (document: { endpointId: string; path: string; content: string }) => Promise<void>;
    fetchVersionInfo: (endpointId?: string) => Promise<VersionResponse>;
    fetchVersionCheck: (endpointId?: string) => Promise<VersionCheckResponse>;
    fetchEdgeSharkStatus: (endpointId?: string) => Promise<EdgeSharkStatusResponse>;
    installEdgeShark: (endpointId?: string) => Promise<void>;
    uninstallEdgeShark: (endpointId?: string) => Promise<void>;
    fetchNodeLogs: (target: NodeTarget & { tail?: string }) => Promise<LogsResponse>;
    inspectAllLabs: (endpointId?: string) => Promise<InspectAllLabsResponse>;
    inspectLab: (target: RuntimeTargetRequest) => Promise<InspectLabResponse>;
    setNetem: (target: InterfaceTarget & { delay?: string; jitter?: string; loss?: number; rate?: number; corruption?: number }) => Promise<void>;
    resetNetem: (target: InterfaceTarget) => Promise<void>;
    openTerminalSession: (target: NodeTarget & { protocol: TerminalProtocol; cols: number; rows: number; sshUsername?: string; telnetPort?: number }) => Promise<TerminalSessionInfo>;
    closeTerminalSession: (sessionId: string, endpointId?: string) => Promise<void>;
    connectTerminalSessionWebSocket: (sessionId: string, endpointId?: string) => WebSocket;
  };
}

const Context = createContext<WorkspaceHost | null>(null);

export function WorkspaceHostProvider({ host, children }: { host: WorkspaceHost; children: React.ReactNode }) {
  return <Context.Provider value={host}>{children}</Context.Provider>;
}

export function useWorkspaceHost(): WorkspaceHost {
  const host = useContext(Context);
  if (!host) throw new Error("WorkspaceHostProvider is required for standalone workspace views.");
  return host;
}

export function useWorkspaceLabs(): Map<string, LabState> {
  const { labs } = useWorkspaceHost();
  return useSyncExternalStore(labs.subscribe, labs.getSnapshot, labs.getSnapshot);
}
