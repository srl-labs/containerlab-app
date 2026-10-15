// Locked labs keep nodes in place; dragging one reports a blocked edit.
import { useEffect } from "react";

/** Pointer travel (px) before a press on a node counts as a drag attempt. */
const DRAG_THRESHOLD_PX = 6;
const NODE_SELECTOR = ".react-flow__node";

export function useLockedDragNudge(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onLockedAction: (() => void) | undefined
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container || !onLockedAction) return;

    let start: { x: number; y: number; pointerId: number } | null = null;

    const handlePointerDown = (event: PointerEvent) => {
      start = null;
      if (event.button !== 0 || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element) || !event.target.closest(NODE_SELECTOR)) return;
      start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.pointerId) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (distance < DRAG_THRESHOLD_PX) return;
      start = null;
      onLockedAction();
    };
    const handlePointerEnd = () => {
      start = null;
    };

    container.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
    };
  }, [containerRef, enabled, onLockedAction]);
}
