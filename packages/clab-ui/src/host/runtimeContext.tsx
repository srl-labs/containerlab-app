import React from "react";

import type { TopologySessionClient } from "../session/client";
import type { ClabUiHost, CustomPaletteTab } from "./contracts";
import type { TabConfig } from "../components/ui/editor/EditorPanel";
import type { TabProps as NodeEditorTabProps } from "../components/panels/node-editor/types";

/**
 * Optional UI customizations a host app injects into clab-ui's chrome (navbar,
 * palette, node editor). clab-ui's own components read these from the runtime
 * context. Defined once and shared by {@link ClabUiRuntime} and the runtime
 * factory's options so the extension surface never drifts across the two.
 */
export interface ClabUiExtensions {
  nodeEditorTabs?: Array<TabConfig<NodeEditorTabProps>>;
  customPaletteTabs?: CustomPaletteTab[];
  yamlSchema?: object;
  /** Extra items injected into the navbar deploy/destroy split-button menu. */
  renderDeployMenuItems?: (context: {
    isViewerMode: boolean;
    closeMenu: () => void;
  }) => React.ReactNode;
  /** Replace the built-in About dialog (navbar info button) with a custom one. */
  renderAboutModal?: (context: { isOpen: boolean; onClose: () => void }) => React.ReactNode;
  /** Palette tab ids to hide (e.g. "json"). */
  disabledTabIds?: string[];
  /** Override built-in palette tab labels by id (e.g. { nodes: "Templates" }). */
  paletteTabLabels?: Record<string, string>;
}

export interface ClabUiRuntime extends ClabUiExtensions {
  host: ClabUiHost;
  session: TopologySessionClient;
}

const ClabUiRuntimeContext = React.createContext<ClabUiRuntime | null>(null);

interface ClabUiRuntimeProviderProps {
  children: React.ReactNode;
  runtime: ClabUiRuntime;
}

export function ClabUiRuntimeProvider({
  children,
  runtime
}: ClabUiRuntimeProviderProps): React.JSX.Element {
  return <ClabUiRuntimeContext.Provider value={runtime}>{children}</ClabUiRuntimeContext.Provider>;
}

export function useClabUiRuntime(): ClabUiRuntime {
  const runtime = React.useContext(ClabUiRuntimeContext);
  if (!runtime) {
    throw new Error("clab-ui runtime is not configured. Wrap the tree in ClabUiRuntimeProvider.");
  }
  return runtime;
}

export function useClabUiHost(): ClabUiHost {
  return useClabUiRuntime().host;
}

export function useTopologySessionClient(): TopologySessionClient {
  return useClabUiRuntime().session;
}
