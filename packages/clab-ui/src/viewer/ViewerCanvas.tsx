import React, { lazy, Suspense, useEffect, useRef } from "react";
import {
  Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider,
  useNodesInitialized, useReactFlow
} from "@xyflow/react";

import { TopologyNode } from "../components/canvas/nodes/TopologyNode";
import { NetworkNode } from "../components/canvas/nodes/NetworkNode";
import { TopologyEdge } from "../components/canvas/edges/TopologyEdge";
import { useGraphStore } from "../stores/graphStore";
import { useTopoViewerStore } from "../stores/topoViewerStore";
import type { resolveViewerOptions } from "./options";

const edgeTypes = { "topology-edge": TopologyEdge };
// Most documentation only needs devices and links. Load richer annotations when present.
const nodeTypes = {
  "topology-node": TopologyNode,
  "network-node": NetworkNode,
  "group-node": lazy(() => import("../components/canvas/nodes/GroupNode").then(m => ({ default: m.GroupNode }))),
  "free-shape-node": lazy(() => import("../components/canvas/nodes/FreeShapeNode").then(m => ({ default: m.FreeShapeNode }))),
  "free-text-node": lazy(() => import("../components/canvas/nodes/FreeTextNode").then(m => ({ default: m.FreeTextNode }))),
  "traffic-rate-node": lazy(() => import("../components/canvas/nodes/TrafficRateNode").then(m => ({ default: m.TrafficRateNode })))
};
type Options = ReturnType<typeof resolveViewerOptions>;

function ViewportReady({ options, onReady }: { options: Options; onReady: () => void }) {
  const initialized = useNodesInitialized();
  const flow = useReactFlow();
  const ready = useRef(false);
  useEffect(() => {
    if (!initialized || ready.current) return;
    let cancelled = false;
    let frame = 0;
    void flow.fitView({ padding: options.fitPadding, duration: 0 }).then(() => {
      if (cancelled) return;
      // A second animation frame means the fitted graph has actually had a paint opportunity.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (cancelled) return;
          ready.current = true;
          options.onInit?.(flow);
          onReady();
        });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [initialized, flow, options, onReady]);
  return null;
}

function Canvas({ options, onReady }: { options: Options; onReady: () => void }) {
  const nodes = useGraphStore(state => state.nodes);
  const edges = useGraphStore(state => state.edges);
  const onNodesChange = useGraphStore(state => state.onNodesChange);
  const onEdgesChange = useGraphStore(state => state.onEdgesChange);
  const appearance = options.appearance;
  const style: React.CSSProperties & Record<`--viewer-${string}`, string | undefined> = {
    "--viewer-background": options.transparent ? "transparent" : appearance?.background,
    "--viewer-foreground": appearance?.foreground,
    "--viewer-surface": appearance?.surface,
    "--viewer-border": appearance?.border,
    "--viewer-accent": appearance?.accent,
    "--viewer-edge": appearance?.edge,
    "--viewer-font": appearance?.font
  };
  return (
    <div className="clab-viewer-canvas" style={style}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false}
        deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
        zoomOnScroll={options.zoomOnScroll} zoomOnPinch={options.zoomOnScroll}
        zoomActivationKeyCode={null} panOnDrag={options.panOnDrag}
        minZoom={0.05} maxZoom={4}
        onNodeClick={(_, node) => options.onNodeSelect?.(node.id)}
        onPaneClick={() => options.onNodeSelect?.(null)}
        onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => {
          useTopoViewerStore.setState({ selectedNode: selectedNodes[0]?.id ?? null, selectedEdge: selectedEdges[0]?.id ?? null });
        }}
        proOptions={{ hideAttribution: true }}
      >
        {options.background !== "none" && <Background variant={options.background === "lines" ? BackgroundVariant.Lines : BackgroundVariant.Dots} gap={20} color="var(--viewer-border, var(--vscode-panel-border))" />}
        {options.controls && <Controls showInteractive={false} fitViewOptions={{ padding: options.fitPadding }} />}
        <ViewportReady options={options} onReady={onReady} />
      </ReactFlow>
    </div>
  );
}

export function ViewerCanvas(props: { options: Options; onReady: () => void }) {
  return <Suspense fallback={null}><ReactFlowProvider><Canvas {...props} /></ReactFlowProvider></Suspense>;
}
