import type {
  CustomNodesResponse,
  IconListResponse,
  IconUploadRequest,
  IconUploadResponse
} from "@srl-labs/containerlab-lab-backend";
import type { ApiLabBackend } from "@srl-labs/containerlab-lab-backend/api";

/**
 * Custom node templates and icons of one user. They belong to the host, not to
 * the lab backend: clab-api-server keeps them per user, a local endpoint keeps
 * them in the desktop app's data folder.
 */
export interface EndpointUiStore {
  getCustomNodes(): Promise<CustomNodesResponse>;
  saveCustomNode(customNode: Record<string, unknown>): Promise<CustomNodesResponse>;
  replaceCustomNodes(customNodes: Record<string, unknown>[]): Promise<CustomNodesResponse>;
  deleteCustomNode(name: string): Promise<CustomNodesResponse>;
  setDefaultCustomNode(name: string): Promise<CustomNodesResponse>;
  /** Global icons plus the icons stored with the lab. */
  listLabIcons(labName: string): Promise<IconListResponse>;
  uploadGlobalIcon(request: IconUploadRequest): Promise<IconUploadResponse>;
  deleteGlobalIcon(iconName: string): Promise<void>;
  /** Keeps the lab's copies of exactly the icons its topology uses. */
  reconcileLabIcons(labName: string, usedIcons: string[]): Promise<void>;
}

/** The UI store a clab-api-server keeps for the signed-in user. */
export function apiUiStore(backend: ApiLabBackend): EndpointUiStore {
  const { client, token } = backend;
  return {
    getCustomNodes: () => client.getCustomNodes(token),
    saveCustomNode: (customNode) => client.saveCustomNode(token, customNode),
    replaceCustomNodes: (customNodes) => client.replaceCustomNodes(token, customNodes),
    deleteCustomNode: (name) => client.deleteCustomNode(token, name),
    setDefaultCustomNode: (name) => client.setDefaultCustomNode(token, name),
    listLabIcons: (labName) => client.listLabIcons(token, labName),
    uploadGlobalIcon: (request) => client.uploadGlobalIcon(token, request),
    deleteGlobalIcon: (iconName) => client.deleteGlobalIcon(token, iconName),
    reconcileLabIcons: (labName, usedIcons) => client.reconcileLabIcons(token, labName, usedIcons)
  };
}
