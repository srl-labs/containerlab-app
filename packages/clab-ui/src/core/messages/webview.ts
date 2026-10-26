/**
 * Types of postMessage commands that target webview.
 */

/** Message type for topology data updates sent to webview */
export const MSG_TOPOLOGY_DATA = "topology-data";

/** Message type for incremental edge stats updates */
export const MSG_EDGE_STATS_UPDATE = "edge-stats-update";

/** Message type for external file change */
export const MSG_EXTERNAL_FILE_CHANGE = "external-file-change";

/** Message type for view/edit mode change */
export const MSG_TOPO_MODE_CHANGE = "topo-mode-changed";

/** Message type to update node name in place after change */
export const MSG_NODE_RENAMED = "node-renamed";

/** Message type for updating node data */
export const MSG_NODE_DATA_UPDATED = "node-data-updated";

/**
 * CPU and memory usage of the open lab's nodes: `{ sample }` with a
 * `HostNodeStatsSample`, `{ unavailable }` with the reason when the lab host
 * cannot report it, or `{ clear: true }` when the lab stopped.
 */
export const MSG_NODE_STATS_UPDATE = "node-stats-update";

/** Message type to request fit-to-viewport in webview */
export const MSG_FIT_VIEWPORT = "fit-viewport";

/** Selects a node (`{ nodeId }`) and centers the canvas on it once the node is drawn. */
export const MSG_FOCUS_NODE = "focus-node";

export const MSG_PANEL_ACTION = "panel-action";

export const MSG_CUSTOM_NODE_UPDATED = "custom-nodes-updated";

export const MSG_CUSTOM_NODE_ERROR = "custom-node-error";

export const MSG_ICON_LIST_RESPONSE = "icon-list-response";

export const MSG_LAB_LIFECYCLE_STATUS = "lab-lifecycle-status";
export const MSG_LAB_LIFECYCLE_LOG = "lab-lifecycle-log";

export const MSG_SVG_EXPORT_RESULT = "svg-export-result";

/** Answer to `MSG_PLAN_APPLY_LAB`: `{ requestId, success, plan?, error? }`. */
export const MSG_APPLY_PLAN_RESULT = "apply-plan-result";

/**
 * Answer to `MSG_TAILSCALE_STATUS`: `{ requestId, success, status?, error? }`.
 * A success without `status` means the lab host cannot report it.
 */
export const MSG_TAILSCALE_STATUS_RESULT = "tailscale-status-result";

/** Answer to `MSG_LAB_OPERATION`: `{ requestId, success, result?, error? }`. */
export const MSG_LAB_OPERATION_RESULT = "lab-operation-result";

export type WebviewMessageType =
  | typeof MSG_TOPOLOGY_DATA
  | typeof MSG_EDGE_STATS_UPDATE
  | typeof MSG_EXTERNAL_FILE_CHANGE
  | typeof MSG_TOPO_MODE_CHANGE
  | typeof MSG_NODE_RENAMED
  | typeof MSG_NODE_DATA_UPDATED
  | typeof MSG_NODE_STATS_UPDATE
  | typeof MSG_FIT_VIEWPORT
  | typeof MSG_FOCUS_NODE
  | typeof MSG_PANEL_ACTION
  | typeof MSG_CUSTOM_NODE_UPDATED
  | typeof MSG_CUSTOM_NODE_ERROR
  | typeof MSG_ICON_LIST_RESPONSE
  | typeof MSG_LAB_LIFECYCLE_STATUS
  | typeof MSG_LAB_LIFECYCLE_LOG
  | typeof MSG_SVG_EXPORT_RESULT
  | typeof MSG_APPLY_PLAN_RESULT
  | typeof MSG_TAILSCALE_STATUS_RESULT
  | typeof MSG_LAB_OPERATION_RESULT;
