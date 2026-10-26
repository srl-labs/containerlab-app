import React, { createContext, useContext, useSyncExternalStore } from "react";
import type {
  EdgeSharkStatusResponse, EndpointHealthMetrics, FileExplorerEntry, InspectAllLabsResponse, InspectLabResponse,
  InterfaceNetemPatch, LabState, LogsResponse, NodeLogLine, RenderedTopologyPreview, RuntimeTargetRequest, TerminalProtocol,
  TerminalSessionInfo, VersionCheckResponse, VersionResponse, WorkspaceAsset
} from "./types";
import type { RuntimeTerminalPane } from "./state/runtimeUiStore";
import type { LabFileRequest } from "../host/labFiles";

type NodeTarget = RuntimeTargetRequest & { nodeName: string };
type InterfaceTarget = NodeTarget & { interfaceName: string };

/** Operations and live data supplied by the embedding host, never imported from an app. */
export interface WorkspaceHost {
  capabilities: { lifecycle: boolean; endpoints: boolean };
  assetUrl: (asset: WorkspaceAsset) => string;
  openTerminalWindow: (pane: RuntimeTerminalPane) => void;
  /**
   * Open a file a topology refers to in a file tab. Relative paths start at
   * the topology's workspace path; absolute ones need its absolute
   * `topologyDir`. Missing where the host cannot.
   */
  openLabFile?: (
    request: LabFileRequest & { endpointId: string; topologyPath: string; topologyDir?: string }
  ) => void;
  labs: {
    getSnapshot: () => Map<string, LabState>;
    subscribe: (listener: () => void) => () => void;
    updateInterfaceNetemState: (update: { endpointId?: string; topologyPath?: string; labName?: string; nodeName: string; interfaceName: string; netem: InterfaceNetemPatch }) => void;
  };
  api: {
    fetchEndpointHealthMetrics: (endpointId: string, signal?: AbortSignal) => Promise<EndpointHealthMetrics>;
    listFileExplorerDirectory: (endpointId: string, parentPath?: string) => Promise<FileExplorerEntry[]>;
    writeFileExplorerFile: (document: { endpointId: string; path: string; content: string; originalContent?: string }) => Promise<void>;
    /** Renders a topology template without deploying it; missing where the host cannot. */
    renderTopologyFile?: (request: { endpointId: string; path: string; varsFile?: string }) => Promise<RenderedTopologyPreview>;
    fetchVersionInfo: (endpointId?: string) => Promise<VersionResponse>;
    fetchVersionCheck: (endpointId?: string) => Promise<VersionCheckResponse>;
    fetchEdgeSharkStatus: (endpointId?: string) => Promise<EdgeSharkStatusResponse>;
    installEdgeShark: (endpointId?: string) => Promise<void>;
    uninstallEdgeShark: (endpointId?: string) => Promise<void>;
    fetchNodeLogs: (target: NodeTarget & { tail?: string }) => Promise<LogsResponse>;
    /**
     * Follows a node's log: the last `tail` lines, then new ones as they are
     * written, until `signal` aborts or the node stops. Missing where the host
     * cannot stream; the logs view polls `fetchNodeLogs` then.
     */
    streamNodeLogs?: (target: NodeTarget & { tail?: string; signal: AbortSignal }) => AsyncIterable<NodeLogLine>;
    inspectAllLabs: (endpointId?: string) => Promise<InspectAllLabsResponse>;
    inspectLab: (target: RuntimeTargetRequest) => Promise<InspectLabResponse>;
    setNetem: (target: InterfaceTarget & { delay?: string; jitter?: string; loss?: number; rate?: number; corruption?: number }) => Promise<void>;
    resetNetem: (target: InterfaceTarget) => Promise<void>;
    /** `resumable` keeps the session running when the stream drops, for attaching again. */
    openTerminalSession: (target: NodeTarget & { protocol: TerminalProtocol; cols: number; rows: number; sshUsername?: string; telnetPort?: number; resumable?: boolean }) => Promise<TerminalSessionInfo>;
    closeTerminalSession: (sessionId: string, endpointId?: string) => Promise<void>;
    /** Whether a session still runs, before attaching to it again; missing where the host cannot tell. */
    getTerminalSession?: (sessionId: string, endpointId?: string) => Promise<TerminalSessionInfo>;
    connectTerminalSessionWebSocket: (sessionId: string, endpointId?: string) => WebSocket;
  };
}

const Context = createContext<WorkspaceHost | null>(null);

export function WorkspaceHostProvider({ host, children }: { host: WorkspaceHost; children: React.ReactNode }) {
  return <Context.Provider value={host}>{children}</Context.Provider>;
}

/** The workspace host when there is one, e.g. a lab host manager outside the workspace. */
export function useOptionalWorkspaceHost(): WorkspaceHost | null {
  return useContext(Context);
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
