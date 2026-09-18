import "../types/assets";
import React from "react";
import { createRoot, type Root } from "react-dom/client";

import { applySnapshotToStores } from "../services/topologyHostSync";
import { useTopoViewerStore } from "../stores/topoViewerStore";
import { useGraphStore } from "../stores/graphStore";
import { useCanvasStore } from "../stores/canvasStore";
import { applyThemeVars } from "../theme/devTheme";

import type { MountViewerOptions as PublicMountViewerOptions } from "./publicTypes";
import { prepareViewer } from "./prepareViewer";
import { ViewerCanvas } from "./ViewerCanvas";
import { resolveViewerOptions, type ViewerOptions } from "./options";
import "./viewer.css";

export interface MountViewerOptions extends PublicMountViewerOptions {
  viewerOptions?: ViewerOptions;
}

// Reuse the editor's parser, saved-layout normalization, and renderers without starting the
// editor, its host session, schema, commands, panels, or subscriptions.
export function mountViewer(container: Element, options: MountViewerOptions): Root {
  const { snapshot, description } = prepareViewer(options.yaml, options.annotations);
  useTopoViewerStore.setState(useTopoViewerStore.getInitialState());
  applySnapshotToStores(snapshot);
  // Per-node annotation flags otherwise override React Flow's read-only canvas props.
  useGraphStore.getState().setNodes(nodes => nodes.map(node => ({ ...node, draggable: false, connectable: false, deletable: false })));
  const resolved = resolveViewerOptions(options.viewerOptions, options.borderless);
  useTopoViewerStore.setState({ isLocked: true, selectedNode: null, selectedEdge: null });
  useCanvasStore.setState({
    linkSourceNode: null,
    annotationHandlers: null,
    easterEggGlow: null,
    nodeRenderConfig: { suppressLabels: !resolved.nodeLabels, suppressRuntimeBadges: true },
    edgeRenderConfig: {
      labelMode: resolved.linkLabels ?? useTopoViewerStore.getState().linkLabelMode,
      suppressLabels: false,
      suppressHitArea: false
    }
  });
  applyThemeVars(options.theme ?? "dark");
  const root = createRoot(container, { onUncaughtError: options.onError });
  root.render(<ViewerCanvas options={resolved} onReady={() => options.onReady?.(description)} />);
  return root;
}
