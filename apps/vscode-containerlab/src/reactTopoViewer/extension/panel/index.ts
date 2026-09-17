/**
 * Panel module exports
 */

// Panel management
export { createPanel, generateWebviewHtml } from "./PanelManager";
export type { PanelConfig } from "./PanelManager";

// Message routing
export { MessageRouter } from "./MessageRouter";

// File watchers
export { WatcherManager } from "./Watchers";

// Bootstrap data
export { buildBootstrapData } from "./BootstrapDataBuilder";
