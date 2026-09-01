/**
 * React TopoViewer Main Application Component
 *
 * Uses Zustand stores for state management.
 * Graph state is managed by graphStore (React Flow is source of truth).
 */
import React from "react";
import type { ReactFlowInstance } from "@xyflow/react";

import type { CanvasRef } from "./hooks/ui";
import type { ReactFlowCanvasRef } from "./components/canvas";
import type { ClabUiRuntime } from "./host";
import { ClabUiRuntimeProvider } from "./host";
import { defaultSchemaData } from "./core/schema";
import { useLayoutControls } from "./hooks/ui";
import {
  type InitialGraphData,
  useStoreInitialization,
  useGraphMessageSubscription,
  useTopoViewerMessageSubscription,
  useTopologyHostInitialization
} from "./hooks/app";
import { AppContent } from "./AppContent";

/** Chrome level: "full" shows the editor navbar + side panel; "viewer" renders the canvas only. */
export type AppChrome = "full" | "viewer";

interface AppRootProps {
  initialData?: InitialGraphData;
  chrome?: AppChrome;
}

function AppRoot({ initialData, chrome }: AppRootProps): React.JSX.Element {
  const reactFlowRef = React.useRef<ReactFlowCanvasRef>(null);
  const [rfInstance, setRfInstance] = React.useState<ReactFlowInstance | null>(null);
  const layoutCanvasRef: React.RefObject<CanvasRef | null> = reactFlowRef;
  const layoutControls = useLayoutControls(layoutCanvasRef);

  // Expose the bundled containerlab schema globally when a host hasn't injected
  // its own, so host-provided UI (e.g. settings sections) can read the kinds.
  React.useEffect(() => {
    const win = window as unknown as { __SCHEMA_DATA__?: unknown };
    if (!win.__SCHEMA_DATA__) {
      win.__SCHEMA_DATA__ = defaultSchemaData;
    }
  }, []);

  // Initialize stores with initial data
  useStoreInitialization({ initialData });

  // Set up message subscriptions (side effects)
  useGraphMessageSubscription();
  useTopoViewerMessageSubscription();
  useTopologyHostInitialization();

  return (
    <AppContent
      reactFlowRef={reactFlowRef}
      rfInstance={rfInstance}
      layoutControls={layoutControls}
      onInit={setRfInstance}
      chrome={chrome}
    />
  );
}

/** Main App component - initializes stores and subscriptions */
export const App: React.FC<{
  initialData?: InitialGraphData;
  runtime: ClabUiRuntime;
  chrome?: AppChrome;
}> = ({ initialData, runtime, chrome }) => {
  return (
    <ClabUiRuntimeProvider runtime={runtime}>
      <AppRoot initialData={initialData} chrome={chrome} />
    </ClabUiRuntimeProvider>
  );
};
