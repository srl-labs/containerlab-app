import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ColorizeIcon from "@mui/icons-material/Colorize";
import type { Node } from "@xyflow/react";

import {
  FREE_SHAPE_NODE_TYPE,
  FREE_TEXT_NODE_TYPE,
  nodeToFreeShape
} from "../../annotations/annotationNodeConverters";
import { formatRotation, getPathRotation, getShapeRotation } from "../../annotations/rotation";
import { useGraphStore } from "../../stores/graphStore";
import { useRotationStore } from "../../stores/rotationStore";
import { useIsLocked } from "../../stores/topoViewerStore";
import type { FreeShapeNodeData } from "./types";

function isShapeNode(node: Node): node is Node<FreeShapeNodeData> {
  return (
    node.type === FREE_SHAPE_NODE_TYPE &&
    ["rectangle", "circle", "line"].includes(String(node.data.shapeType))
  );
}

interface Candidate {
  element: Element;
  angle: number;
  label: string;
}

function getCandidate(target: EventTarget | null, targetId: string): Candidate | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest(".react-flow__node, .react-flow__edge");
  const id = element?.getAttribute("data-id");
  if (!element || id == null || id === "" || id === targetId) return null;
  if (element.classList.contains("react-flow__edge")) {
    const path = element.querySelector<SVGPathElement>(".react-flow__edge-path");
    const angle = path ? getPathRotation(path) : null;
    return angle === null ? null : { element, angle, label: "Link direction" };
  }
  const node = useGraphStore.getState().nodes.find((item) => item.id === id);
  if (!node) return null;
  if (isShapeNode(node)) {
    return {
      element,
      angle: getShapeRotation(nodeToFreeShape(node)),
      label: node.data.shapeType === "line" ? "Line direction" : "Shape rotation"
    };
  }
  if (node.type === FREE_TEXT_NODE_TYPE) {
    return {
      element,
      angle: typeof node.data.rotation === "number" ? node.data.rotation : 0,
      label: "Text rotation"
    };
  }
  return null;
}

/** Capture before React Flow so sampling never changes selection or moves the source. */
export function RotationMatchOverlay({
  canvasRef
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const pick = useRotationStore((state) => state.pick);
  const locked = useIsLocked();
  const [preview, setPreview] = useState<{
    angle: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (locked) useRotationStore.getState().cancelPick();
  }, [locked]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pick || !canvas || locked) return;
    let highlighted: Element | null = null;
    const clearHighlight = () => {
      highlighted?.removeAttribute("data-rotation-source");
      highlighted = null;
    };
    const move = (event: MouseEvent) => {
      const candidate = getCandidate(event.target, pick.targetId);
      if (candidate?.element === highlighted) return;
      clearHighlight();
      if (candidate) {
        highlighted = candidate.element;
        highlighted.setAttribute("data-rotation-source", "true");
      }
      setPreview(candidate ? { angle: candidate.angle, label: candidate.label } : null);
    };
    const blockCanvasAction = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".react-flow")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const click = (event: MouseEvent) => {
      blockCanvasAction(event);
      const candidate = getCandidate(event.target, pick.targetId);
      if (!candidate) return;
      pick.onPick(candidate.angle);
      useRotationStore.getState().cancelPick();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      useRotationStore.getState().cancelPick();
    };
    canvas.setAttribute("data-rotation-picking", "true");
    canvas.addEventListener("pointerdown", blockCanvasAction, true);
    canvas.addEventListener("mousedown", blockCanvasAction, true);
    canvas.addEventListener("click", click, true);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("keydown", escape, true);
    return () => {
      clearHighlight();
      setPreview(null);
      canvas.removeAttribute("data-rotation-picking");
      canvas.removeEventListener("pointerdown", blockCanvasAction, true);
      canvas.removeEventListener("mousedown", blockCanvasAction, true);
      canvas.removeEventListener("click", click, true);
      canvas.removeEventListener("mousemove", move);
      window.removeEventListener("keydown", escape, true);
    };
  }, [pick, canvasRef, locked]);

  if (!pick || locked) return null;
  return (
    <Box
      data-testid="rotation-match-hint"
      role="status"
      sx={{
        position: "absolute",
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 1,
        px: 1.5,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.paper",
        boxShadow: 6,
        maxWidth: "calc(100% - 32px)",
        color: "text.primary",
        pointerEvents: "auto"
      }}
    >
      <ColorizeIcon color="primary" fontSize="small" />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, whiteSpace: "nowrap" }}>
          {preview ? `${preview.label} · ${formatRotation(preview.angle)}°` : "Pick a direction"}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
          {preview ? "Click to match rotation" : "Choose a link, line, text or shape"}
        </Typography>
      </Box>
      <Button size="small" onClick={useRotationStore.getState().cancelPick} sx={{ minWidth: 36 }}>
        Esc
      </Button>
    </Box>
  );
}
