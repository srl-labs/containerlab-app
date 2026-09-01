/**
 * App hooks barrel export
 *
 * All hooks extracted from App.tsx to reduce complexity.
 */

// Clipboard handlers
export { useClipboardHandlers } from "./useClipboardHandlers";

// Keyboard shortcuts
export { useAppKeyboardShortcuts } from "./useAppKeyboardShortcuts";

// Graph creation
export { useGraphCreation } from "./useGraphCreation";

// App helpers (original hooks)
export { useCustomNodeCommands } from "./useAppHelpers";

export { useAppEditorBindings } from "./useAppEditorBindings";
export { useAppE2EExposure } from "./useAppE2EExposure";
export { useAppGraphHandlers } from "./useAppGraphHandlers";
export { useAppToasts } from "./useAppToasts";
export { useDevMockTrafficStats } from "./useDevMockTrafficStats";
export { useIconReconciliation } from "./useIconReconciliation";
export { useUndoRedoControls } from "./useUndoRedoControls";
export type { InitialGraphData } from "./useInitialGraphData";

// App initialization & subscriptions
export {
  useStoreInitialization,
  useGraphMessageSubscription,
  useTopoViewerMessageSubscription,
  useTopologyHostInitialization
} from "./lifecycle";
