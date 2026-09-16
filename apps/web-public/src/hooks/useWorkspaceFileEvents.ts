import type { EndpointConfig } from "../stores/endpointStore";

export interface WorkspaceFileEvent {
  action?: string;
  kind?: string;
  parentPath?: string;
  path?: string;
  type?: string;
}

// The public sandbox mutates its workspace locally (no server push), so there
// is no file-event stream to subscribe to. No-op.
export function useWorkspaceFileEvents(
  _endpoints: EndpointConfig[],
  _onWorkspaceFileEvent: (endpointId: string, event: WorkspaceFileEvent) => void,
): void {}
