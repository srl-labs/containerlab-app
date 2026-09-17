export type { TopologyRef } from "../contract/topologyRef";

export {
  createTopologySessionClient,
  type CreateTopologySessionClientOptions,
  type TopologySessionClient,
  type TopologySessionContext
} from "./client";

export { TopologyHostCore as TopologySessionCore } from "../core/host/TopologyHostCore";

export * from "../core/messages/extension";
export * from "../core/messages/webview";
export * from "../core/schema";
export * from "../core/types";
export * from "../core/utilities/customNodeImportExport";
export {
  executeTopologyCommand,
  executeTopologyCommands,
  refreshTopologySnapshot
} from "../services/topologyHostCommands";
export {
  getHostContext,
  getHostRevision,
  setHostContext,
  setHostRevision
} from "../services/topologyHostClient";
export {
  applyRuntimeEdgeStatsToGraph,
  clearTopologyGraph,
  type ApplyRuntimeEdgeStatsOptions
} from "../services/runtimeGraphUpdates";
export * from "../topology/hostProtocol";
export * from "../topology/runtime";

export type { FileSystemAdapter, IOLogger, SaveResult } from "../core/io/types";
