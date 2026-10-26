// A card with a node's or link's details while the pointer rests on it (a global setting).
import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Popper, { type PopperProps } from "@mui/material/Popper";

import { useLinkCreationContext } from "../../../stores/canvasStore";
import { useDeploymentState } from "../../../stores/topoViewerStore";
import { useHoverCardsEnabled } from "../useHoverCardsEnabled";

import { LinkHoverCardContent } from "./LinkHoverCardContent";
import { NodeHoverCardContent } from "./NodeHoverCardContent";
import { useLinkTrafficRecorder } from "./useLinkTrafficRecorder";

/** How long the pointer rests on a node or link before its card shows. */
const SHOW_DELAY_MS = 450;
const NODE_CLASS = "react-flow__node-topology-node";
const TARGET_SELECTOR = `.${NODE_CLASS}, .react-flow__edge-topology-edge`;
const CARD_WIDTH = { node: 260, link: 400 };
// Beside the node or pointer, or on its other side near the canvas edge.
const POPPER_MODIFIERS = [
  { name: "offset", options: { offset: [0, 14] } },
  { name: "flip", options: { fallbackPlacements: ["left-start", "bottom", "top"] } },
  { name: "preventOverflow", options: { padding: 8 } }
];

interface Hovered {
  kind: "node" | "link";
  id: string;
  anchor: PopperProps["anchorEl"];
}

/** A link is long, so its card shows where the pointer rests rather than beside the whole line. */
function pointAnchor(x: number, y: number): PopperProps["anchorEl"] {
  return { getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) };
}

/** The node or link under the pointer, once it rested there; null while dragging, panning or zooming. */
function useRestingTarget(canvasRef: React.RefObject<HTMLDivElement | null>, enabled: boolean): Hovered | null {
  const [hovered, setHovered] = useState<Hovered | null>(null);

  useEffect(() => {
    const container = canvasRef.current;
    if (!enabled || !container) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Element | null = null;
    const pointer = { x: 0, y: 0 };

    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    };
    const hide = () => {
      cancel();
      setHovered(null);
    };
    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };
    const onOver = (event: PointerEvent) => {
      onMove(event);
      if (event.buttons !== 0 || !(event.target instanceof Element)) return;
      const element = event.target.closest(TARGET_SELECTOR);
      const id = element?.getAttribute("data-id");
      if (!element || id == null || id === "" || element === pending) return;
      cancel();
      pending = element;
      timer = setTimeout(() => {
        timer = undefined;
        if (!element.isConnected) return;
        setHovered(element.classList.contains(NODE_CLASS)
          ? { kind: "node", id, anchor: element }
          : { kind: "link", id, anchor: pointAnchor(pointer.x, pointer.y) });
      }, SHOW_DELAY_MS);
    };
    const onOut = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const element = event.target.closest(TARGET_SELECTOR);
      if (!element) return;
      // Moving between the parts of one node or link keeps its card.
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      hide();
    };

    container.addEventListener("pointerover", onOver);
    container.addEventListener("pointermove", onMove, { passive: true });
    container.addEventListener("pointerout", onOut);
    container.addEventListener("pointerdown", hide, true);
    container.addEventListener("wheel", hide, { passive: true, capture: true });
    container.addEventListener("pointerleave", hide);
    return () => {
      cancel();
      setHovered(null);
      container.removeEventListener("pointerover", onOver);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerout", onOut);
      container.removeEventListener("pointerdown", hide, true);
      container.removeEventListener("wheel", hide, { capture: true });
      container.removeEventListener("pointerleave", hide);
    };
  }, [canvasRef, enabled]);

  return enabled ? hovered : null;
}

export default function CanvasHoverCard({ canvasRef }: { canvasRef: React.RefObject<HTMLDivElement | null> }) {
  const enabled = useHoverCardsEnabled();
  const { linkSourceNode } = useLinkCreationContext();
  const hovered = useRestingTarget(canvasRef, enabled && linkSourceNode === null);
  const deployed = useDeploymentState() === "deployed";
  useLinkTrafficRecorder(enabled && deployed);
  return (
    <Popper
      open={hovered !== null}
      anchorEl={hovered?.anchor}
      placement="right-start"
      modifiers={POPPER_MODIFIERS}
      sx={{ zIndex: 1300, pointerEvents: "none" }}
    >
      {hovered ? (
        <Paper
          elevation={6}
          data-testid={`${hovered.kind}-hover-card`}
          data-target-id={hovered.id}
          sx={{ width: CARD_WIDTH[hovered.kind], border: 1, borderColor: "divider" }}
        >
          <Box sx={{ p: 1.25 }}>
            {hovered.kind === "node"
              ? <NodeHoverCardContent nodeId={hovered.id} />
              : <LinkHoverCardContent edgeId={hovered.id} />}
          </Box>
        </Paper>
      ) : null}
    </Popper>
  );
}
