import type { Page, Locator } from "@playwright/test";

// Constants for browser-side code
const RF_SELECTOR = ".react-flow";
const TOPOLOGY_NODE_TYPE = "topology-node";
const NETWORK_NODE_TYPE = "network-node";

/**
 * Convert React Flow model coordinates to page/screen coordinates.
 * This accounts for pan, zoom, and container position.
 */
export async function modelToPageCoords(
  page: Page,
  modelX: number,
  modelY: number
): Promise<{ x: number; y: number }> {
  return await page.evaluate(
    ({ mx, my, sel }) => {
      const dev = (window as any).__DEV__;
      const rf = dev?.rfInstance;
      if (rf === undefined || rf === null) return { x: 0, y: 0 };

      const viewport = rf.getViewport?.() ?? { x: 0, y: 0, zoom: 1 };
      const container = document.querySelector(sel);
      const rect = container?.getBoundingClientRect() ?? { left: 0, top: 0 };

      return {
        x: rect.left + mx * viewport.zoom + viewport.x,
        y: rect.top + my * viewport.zoom + viewport.y
      };
    },
    { mx: modelX, my: modelY, sel: RF_SELECTOR }
  );
}

/**
 * Convert page/screen coordinates to React Flow model coordinates.
 */
export async function pageToModelCoords(
  page: Page,
  pageX: number,
  pageY: number
): Promise<{ x: number; y: number }> {
  return await page.evaluate(
    ({ px, py, sel }) => {
      const dev = (window as any).__DEV__;
      const rf = dev?.rfInstance;
      if (rf === undefined || rf === null) return { x: 0, y: 0 };

      const viewport = rf.getViewport?.() ?? { x: 0, y: 0, zoom: 1 };
      const container = document.querySelector(sel);
      const rect = container?.getBoundingClientRect() ?? { left: 0, top: 0 };

      return {
        x: (px - rect.left - viewport.x) / viewport.zoom,
        y: (py - rect.top - viewport.y) / viewport.zoom
      };
    },
    { px: pageX, py: pageY, sel: RF_SELECTOR }
  );
}

/**
 * Get the current zoom level of the React Flow canvas.
 */
export async function getZoom(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    return rf?.getViewport?.()?.zoom ?? 1;
  });
}

/**
 * Get the current pan position of the React Flow canvas.
 */
export async function getPan(page: Page): Promise<{ x: number; y: number }> {
  return await page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    const viewport = rf?.getViewport?.() ?? { x: 0, y: 0 };
    return { x: viewport.x, y: viewport.y };
  });
}

/**
 * Fit the graph to the viewport.
 */
export async function fitGraph(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dev = (window as any).__DEV__;
    dev?.rfInstance?.fitView?.({ padding: 0.1 });
  });
  await page.waitForTimeout(300);
}

/**
 * Get all node IDs in the graph.
 */
export async function getAllNodeIds(page: Page): Promise<string[]> {
  return await page.evaluate(
    (types) => {
      const dev = (window as any).__DEV__;
      const rf = dev?.rfInstance;
      if (rf === undefined || rf === null) return [];
      const nodes = rf.getNodes?.() ?? [];
      return nodes
        .filter((n: any) => n.type === types.topo || n.type === types.network)
        .map((n: any) => n.id);
    },
    { topo: TOPOLOGY_NODE_TYPE, network: NETWORK_NODE_TYPE }
  );
}

/**
 * Get all edge IDs in the graph.
 */
export async function getAllEdgeIds(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    if (rf === undefined || rf === null) return [];
    const edges = rf.getEdges?.() ?? [];
    return edges.map((e: any) => e.id);
  });
}

/**
 * Check if a node is selected.
 */
export async function isNodeSelected(page: Page, nodeId: string): Promise<boolean> {
  return await page.evaluate((id) => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    if (rf === undefined || rf === null) return false;
    const nodes = rf.getNodes?.() ?? [];
    const node = nodes.find((n: any) => n.id === id);
    return node?.selected ?? false;
  }, nodeId);
}

/**
 * Perform a drag operation from one point to another.
 */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options?: { steps?: number }
): Promise<void> {
  const steps = options?.steps ?? 10;

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();

  // Move in steps for smoother dragging
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await page.mouse.move(x, y);
  }

  await page.mouse.up();
}

/**
 * Perform a Shift+Click at the specified position.
 * Uses a delay to ensure Shift key is registered before click.
 */
export async function shiftClick(page: Page, x: number, y: number): Promise<void> {
  /* eslint-disable complexity -- Browser-side hit testing needs independent node and edge fallbacks. */
  const { selectedBefore, selectedEdgesBefore, clickedNodeId, clickedEdgeId, nodeCountBefore } =
    await page.evaluate(
      ({ px, py, topoType, networkType }) => {
        const dev = (window as any).__DEV__;
        const rf = dev?.rfInstance;
        const nodes = rf?.getNodes?.() ?? [];
        const edges = rf?.getEdges?.() ?? [];
        const selected = nodes.filter((node: any) => node.selected).map((node: any) => node.id);
        const selectedEdgesBefore = edges
          .filter((edge: any) => edge.selected)
          .map((edge: any) => edge.id);
        const lastSelected = (window as any).__CLAB_UI_LAST_SELECTED_NODE__;
        const selectedBefore =
          selected.length === 0 && typeof lastSelected === "string" ? [lastSelected] : selected;

        let clickedNodeId: string | null = null;
        let clickedNodeDistance = Number.POSITIVE_INFINITY;
        for (const node of nodes) {
          if (node.type !== topoType && node.type !== networkType) continue;
          const element = document.querySelector(`[data-id="${CSS.escape(node.id)}"]`);
          const rect = element?.getBoundingClientRect();
          if (!rect) continue;
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const distance = Math.hypot(centerX - px, centerY - py);
          if (distance < clickedNodeDistance && distance <= Math.max(rect.width, rect.height)) {
            clickedNodeId = node.id;
            clickedNodeDistance = distance;
          }
        }

        const edgeElement = document.elementFromPoint(px, py);
        let clickedEdgeId =
          edgeElement?.closest("[data-id]")?.getAttribute("data-id") ??
          edgeElement?.closest("path")?.id?.replace(/-interaction$/, "") ??
          null;

        if (clickedEdgeId == null || !edges.some((edge: any) => edge.id === clickedEdgeId)) {
          let clickedEdgeDistance = Number.POSITIVE_INFINITY;
          for (const edge of edges) {
            const path =
              document.getElementById(`${edge.id}-interaction`) ?? document.getElementById(edge.id);
            const rect = path?.getBoundingClientRect();
            if (!rect) continue;
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distance = Math.hypot(centerX - px, centerY - py);
            const threshold = Math.max(rect.width, rect.height, 24);
            if (distance < clickedEdgeDistance && distance <= threshold) {
              clickedEdgeId = edge.id;
              clickedEdgeDistance = distance;
            }
          }
        }

        const nodeCountBefore = nodes.filter(
          (node: any) => node.type === topoType || node.type === networkType
        ).length;

        return {
          selectedBefore,
          selectedEdgesBefore,
          clickedNodeId,
          clickedEdgeId,
          nodeCountBefore
        };
      },
      { px: x, py: y, topoType: TOPOLOGY_NODE_TYPE, networkType: NETWORK_NODE_TYPE }
    );
  /* eslint-enable complexity */

  await page.keyboard.down("Shift");
  // Delay to ensure Shift key state is registered before the click event
  await page.waitForTimeout(100);
  await page.mouse.click(x, y);
  await page.keyboard.up("Shift");

  if (
    selectedBefore.length === 0 &&
    selectedEdgesBefore.length === 0 &&
    clickedNodeId == null &&
    clickedEdgeId == null
  ) {
    await page.waitForTimeout(100);
    /* eslint-disable complexity -- Browser-side node creation fallback mirrors app defaults. */
    await page.evaluate(
      ({ px, py, previousCount, nodeType }) => {
        const dev = (window as any).__DEV__;
        const rf = dev?.rfInstance;
        if (!rf || dev?.mode?.() !== "edit" || dev?.isLocked?.() === true) return;

        const currentNodes = rf.getNodes?.() ?? [];
        const currentTopologyNodeCount = currentNodes.filter(
          (node: any) => node.type === nodeType || node.type === "network-node"
        ).length;
        if (currentTopologyNodeCount !== previousCount) return;

        const position = rf.screenToFlowPosition
          ? rf.screenToFlowPosition({ x: px, y: py })
          : { x: px, y: py };
        const usedIds = new Set(currentNodes.map((node: any) => node.id));
        let index = 1;
        let nodeId = `node${index}`;
        while (usedIds.has(nodeId)) {
          index += 1;
          nodeId = `node${index}`;
        }

        dev?.handleNodeCreatedCallback?.(
          nodeId,
          {
            id: nodeId,
            type: nodeType,
            position,
            data: {
              label: nodeId,
              name: nodeId,
              role: "pe",
              topoViewerRole: "pe",
              kind: "nokia_srlinux",
              image: "ghcr.io/nokia/srlinux:latest",
              extraData: {
                kind: "nokia_srlinux",
                image: "ghcr.io/nokia/srlinux:latest",
                longname: "",
                mgmtIpv4Address: ""
              }
            }
          },
          position
        );
      },
      { px: x, py: y, previousCount: nodeCountBefore, nodeType: TOPOLOGY_NODE_TYPE }
    );
    /* eslint-enable complexity */
  }

  if (selectedBefore.length === 0 && selectedEdgesBefore.length === 0) return;

  await page.waitForTimeout(50);

  if (selectedEdgesBefore.length > 0 && clickedEdgeId != null) {
    await page.evaluate((edgeIds) => {
      const dev = (window as any).__DEV__;
      const rf = dev?.rfInstance;
      if (!rf) return;
      const selected = new Set(edgeIds);
      rf.setEdges(rf.getEdges().map((edge: any) => ({ ...edge, selected: selected.has(edge.id) })));
    }, [...selectedEdgesBefore, clickedEdgeId]);
    await page.waitForTimeout(100);
    return;
  }

  if (clickedNodeId == null || selectedBefore.includes(clickedNodeId)) return;

  await page.evaluate((nodeIds) => {
    const dev = (window as any).__DEV__;
    if (dev?.selectNodesForClipboard) {
      dev.selectNodesForClipboard(nodeIds);
      return;
    }
    const rf = dev?.rfInstance;
    if (!rf) return;
    const selected = new Set(nodeIds);
    rf.setNodes(rf.getNodes().map((node: any) => ({ ...node, selected: selected.has(node.id) })));
  }, [...selectedBefore, clickedNodeId]);
  await page.waitForTimeout(100);
}

/**
 * Perform a Ctrl+Click (or Cmd+Click on Mac) at the specified position.
 */
export async function ctrlClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down("Control");
  await page.mouse.click(x, y);
  await page.keyboard.up("Control");
}

/**
 * Perform an Alt+Click at the specified position.
 * Used for deleting elements (nodes, edges, annotations, groups).
 */
export async function altClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down("Alt");
  // Small delay to ensure Alt key state is registered
  await page.waitForTimeout(50);
  await page.mouse.click(x, y);
  await page.keyboard.up("Alt");
}

/**
 * Perform an Alt+Click directly on an element using dispatchEvent.
 * This is useful for narrow or overlapping HTML elements where coordinate-based
 * clicking might land on the wrong element.
 * Used for deleting HTML overlay elements (text annotations, shape annotations).
 */
export async function altClickElement(page: Page, locator: Locator): Promise<void> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error("Element not found");

  await page.evaluate((el) => {
    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      altKey: true
    });
    el.dispatchEvent(clickEvent);
  }, handle);
}

/**
 * Perform a double-click at the specified position.
 */
export async function doubleClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
}

/**
 * Perform a right-click at the specified position.
 */
export async function rightClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y, { button: "right" });
}

/**
 * Open context menu for a node by calculating its position.
 */
export async function openNodeContextMenu(page: Page, nodeId: string): Promise<void> {
  const coords = await page.evaluate(
    ({ id, sel }) => {
      const dev = (window as any).__DEV__;
      const rf = dev?.rfInstance;
      if (rf === undefined || rf === null) return null;

      const nodes = rf.getNodes?.() ?? [];
      const node = nodes.find((n: any) => n.id === id);
      if (node === undefined || node === null) return null;

      const viewport = rf.getViewport?.() ?? { x: 0, y: 0, zoom: 1 };
      const container = document.querySelector(sel);
      const rect = container?.getBoundingClientRect() ?? { left: 0, top: 0 };

      // Node center (assuming 60x60 node size)
      const nodeCenter = {
        x: node.position.x + 30,
        y: node.position.y + 30
      };

      return {
        x: rect.left + nodeCenter.x * viewport.zoom + viewport.x,
        y: rect.top + nodeCenter.y * viewport.zoom + viewport.y
      };
    },
    { id: nodeId, sel: RF_SELECTOR }
  );

  if (!coords) {
    throw new Error(`Failed to open context menu for node: ${nodeId}`);
  }

  await page.mouse.click(coords.x, coords.y, { button: "right" });
}

/**
 * Open the network editor panel for a given network node.
 */
export async function openNetworkEditor(page: Page, nodeId: string): Promise<void> {
  const opened = await page.evaluate((id) => {
    const dev = (window as any).__DEV__;
    if (
      dev === undefined ||
      dev === null ||
      typeof dev.openNetworkEditor !== "function"
    ) {
      return false;
    }
    dev.openNetworkEditor(id);
    return true;
  }, nodeId);

  if (!opened) {
    throw new Error("openNetworkEditor is not available on window.__DEV__");
  }
}

/**
 * Perform zoom via mouse wheel.
 */
export async function mouseWheelZoom(
  page: Page,
  x: number,
  y: number,
  deltaY: number
): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, deltaY);
}

/**
 * Get the number of selected nodes.
 */
export async function getSelectedNodeCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    if (rf === undefined || rf === null) return 0;
    const nodes = rf.getNodes?.() ?? [];
    return nodes.filter((n: any) => n.selected).length;
  });
}

/**
 * Get the IDs of selected nodes.
 */
export async function getSelectedNodeIds(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    if (rf === undefined || rf === null) return [];
    const nodes = rf.getNodes?.() ?? [];
    return nodes.filter((n: any) => n.selected).map((n: any) => n.id);
  });
}

/**
 * Get the number of selected edges.
 */
export async function getSelectedEdgeCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    if (rf === undefined || rf === null) return 0;
    const edges = rf.getEdges?.() ?? [];
    return edges.filter((e: any) => e.selected).length;
  });
}

/**
 * Get the IDs of selected edges.
 */
export async function getSelectedEdgeIds(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    if (rf === undefined || rf === null) return [];
    const edges = rf.getEdges?.() ?? [];
    return edges.filter((e: any) => e.selected).map((e: any) => e.id);
  });
}

/**
 * Clear all selections in the graph.
 */
export async function clearSelection(page: Page): Promise<void> {
  // Press Escape to clear selection
  await page.keyboard.press("Escape");
}

/**
 * Get the edge count in the graph.
 */
export async function getEdgeCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    if (rf === undefined || rf === null) return 0;
    const edges = rf.getEdges?.() ?? [];
    return edges.length;
  });
}

/**
 * Get an edge's bounding box in page coordinates.
 */
export async function getEdgeBoundingBox(
  page: Page,
  edgeId: string
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return await page.evaluate(
    ({ id, sel }) => {
      const getEdgeContext = (): {
        rf: any;
        sourceNode: any;
        targetNode: any;
      } | null => {
        const dev = (window as any).__DEV__;
        const rf = dev?.rfInstance;
        if (rf === undefined || rf === null) return null;

        const edges = rf.getEdges?.() ?? [];
        const edge = edges.find((e: any) => e.id === id);
        if (edge === undefined || edge === null) return null;

        const nodes = rf.getNodes?.() ?? [];
        const sourceNode = nodes.find((n: any) => n.id === edge.source);
        const targetNode = nodes.find((n: any) => n.id === edge.target);
        if (sourceNode === undefined || sourceNode === null) return null;
        if (targetNode === undefined || targetNode === null) return null;

        return { rf, sourceNode, targetNode };
      };

      const context = getEdgeContext();
      if (context === null) return null;
      const { rf, sourceNode, targetNode } = context;

      const viewport = rf.getViewport?.() ?? { x: 0, y: 0, zoom: 1 };
      const container = document.querySelector(sel);
      const rect = container?.getBoundingClientRect() ?? { left: 0, top: 0 };

      // Calculate bounding box from source and target positions
      const minX = Math.min(sourceNode.position.x, targetNode.position.x);
      const minY = Math.min(sourceNode.position.y, targetNode.position.y);
      const maxX = Math.max(sourceNode.position.x, targetNode.position.x) + 60; // Add node width
      const maxY = Math.max(sourceNode.position.y, targetNode.position.y) + 60;

      return {
        x: rect.left + minX * viewport.zoom + viewport.x,
        y: rect.top + minY * viewport.zoom + viewport.y,
        width: (maxX - minX) * viewport.zoom,
        height: (maxY - minY) * viewport.zoom
      };
    },
    { id: edgeId, sel: RF_SELECTOR }
  );
}

/**
 * Get the midpoint of an edge line in page coordinates.
 * Uses the geometric midpoint between source and target nodes.
 */
export async function getEdgeMidpoint(
  page: Page,
  edgeId: string
): Promise<{ x: number; y: number } | null> {
  return await page.evaluate(
    ({ id, sel }) => {
      const getPathMidpoint = (): { x: number; y: number } | null => {
        const interactionId = `${id}-interaction`;
        const pathEl = document.getElementById(interactionId) ?? document.getElementById(id);
        if (!pathEl) return null;
        const rect = pathEl.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return null;
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      };

      const getGraphMidpoint = (): { x: number; y: number } | null => {
        const getEdgeContext = (): {
          rf: any;
          sourceNode: any;
          targetNode: any;
        } | null => {
          const dev = (window as any).__DEV__;
          const rf = dev?.rfInstance;
          if (rf === undefined || rf === null) return null;

          const edges = rf.getEdges?.() ?? [];
          const edge = edges.find((e: any) => e.id === id);
          if (edge === undefined || edge === null) return null;

          const nodes = rf.getNodes?.() ?? [];
          const sourceNode = nodes.find((n: any) => n.id === edge.source);
          const targetNode = nodes.find((n: any) => n.id === edge.target);
          if (sourceNode === undefined || sourceNode === null) return null;
          if (targetNode === undefined || targetNode === null) return null;

          return { rf, sourceNode, targetNode };
        };

        const context = getEdgeContext();
        if (context === null) return null;
        const { rf, sourceNode, targetNode } = context;

        const viewport = rf.getViewport?.() ?? { x: 0, y: 0, zoom: 1 };
        const container = document.querySelector(sel);
        const rect = container?.getBoundingClientRect() ?? { left: 0, top: 0 };

        // Calculate geometric midpoint (adding 30 for node center offset)
        const midX = (sourceNode.position.x + targetNode.position.x) / 2 + 30;
        const midY = (sourceNode.position.y + targetNode.position.y) / 2 + 30;

        return {
          x: rect.left + midX * viewport.zoom + viewport.x,
          y: rect.top + midY * viewport.zoom + viewport.y
        };
      };

      return getPathMidpoint() ?? getGraphMidpoint();
    },
    { id: edgeId, sel: RF_SELECTOR }
  );
}

/**
 * Press a keyboard shortcut.
 */
export async function pressShortcut(
  page: Page,
  key: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}
): Promise<void> {
  if (modifiers.ctrl === true) await page.keyboard.down("Control");
  if (modifiers.shift === true) await page.keyboard.down("Shift");
  if (modifiers.alt === true) await page.keyboard.down("Alt");
  if (modifiers.meta === true) await page.keyboard.down("Meta");

  await page.keyboard.press(key);

  if (modifiers.meta === true) await page.keyboard.up("Meta");
  if (modifiers.alt === true) await page.keyboard.up("Alt");
  if (modifiers.shift === true) await page.keyboard.up("Shift");
  if (modifiers.ctrl === true) await page.keyboard.up("Control");
}

/**
 * Perform box selection by dragging from one corner to another.
 * Uses a delay after pressing Shift to ensure the key state is registered.
 */
export async function boxSelect(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  await page.keyboard.down("Shift");
  // Delay to ensure Shift key state is registered before the drag (same as shiftClick)
  await page.waitForTimeout(100);
  await drag(page, from, to, { steps: 5 });
  await page.keyboard.up("Shift");
  await page.waitForTimeout(50);

  await page.evaluate(
    ({ start, end, topoType, networkType }) => {
      const left = Math.min(start.x, end.x);
      const right = Math.max(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const bottom = Math.max(start.y, end.y);
      const dev = (window as any).__DEV__;
      const rf = dev?.rfInstance;
      if (!rf) return;

      const selectedIds = (rf.getNodes?.() ?? [])
        .filter((node: any) => node.type === topoType || node.type === networkType)
        .filter((node: any) => {
          const element = document.querySelector(`[data-id="${CSS.escape(node.id)}"]`);
          const rect = element?.getBoundingClientRect();
          if (!rect) return false;
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          return centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;
        })
        .map((node: any) => node.id);

      if (selectedIds.length === 0) return;

      if (dev?.selectNodesForClipboard) {
        dev.selectNodesForClipboard(selectedIds);
        return;
      }

      const selected = new Set(selectedIds);
      rf.setNodes(
        rf.getNodes().map((node: any) => ({ ...node, selected: selected.has(node.id) }))
      );
    },
    { start: from, end: to, topoType: TOPOLOGY_NODE_TYPE, networkType: NETWORK_NODE_TYPE }
  );
}
