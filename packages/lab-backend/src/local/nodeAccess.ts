import type { InspectAllLabsResponse, InspectContainerInfo, LabStatsSample, LogsResponse, NodeBrowserPort, NodeLogLine } from "../contract/dto.ts";
import type { TerminalAccess } from "./terminals.ts";

/**
 * How LocalLabBackend reaches a lab's nodes beyond the containerlab CLI:
 * listing them, terminals, logs, browser ports and stats. Docker and
 * Podman go through the Docker Engine API (`DockerNodeAccess`); a c9s
 * host through `containerlab inspect` and Kubernetes (`KubeNodeAccess`).
 */
export interface NodeAccess extends TerminalAccess {
  /** The labs and their nodes, as `containerlab inspect` reports them, by lab name. */
  inspectLabs(labName?: string): Promise<InspectAllLabsResponse>;
  /** The topology node `containerlab start|stop|restart -n` takes for a node. */
  topologyNodeName(container: InspectContainerInfo): Promise<string>;
  nodeLogs(container: InspectContainerInfo, tail: string): Promise<LogsResponse>;
  /** Follows a node's log until `signal` aborts. */
  streamNodeLogs(
    container: InspectContainerInfo,
    options: { tail: string; signal: AbortSignal }
  ): Promise<AsyncIterable<NodeLogLine>>;
  /** Ports of a node a browser on this machine can open. */
  browserPorts(container: InspectContainerInfo): Promise<NodeBrowserPort[]>;
  /** Whether `labStats` can sample nodes on this host. */
  statsAvailable(): Promise<boolean>;
  labStats(labName: string, intervalSeconds: number, signal: AbortSignal): AsyncIterable<LabStatsSample>;
  /** Closes what the access holds open: port-forwards and streams. */
  dispose(): Promise<void>;
}
