import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

/** Resize within the containing workspace, without rendering on every pointer event. */
export function useHorizontalResize({
  initialWidth,
  minimumWidth,
  maximumWidth,
  side = "left",
  onCommit
}: {
  initialWidth: number;
  minimumWidth: number;
  maximumWidth: (availableWidth: number) => number;
  side?: "left" | "right";
  onCommit?: (width: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [preferredWidth, setPreferredWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const pendingWidth = useRef(initialWidth);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    setAvailableWidth(parent.clientWidth);
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const max = Math.max(0, Math.floor(maximumWidth(availableWidth)));
  const min = Math.min(minimumWidth, max);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const width = clamp(preferredWidth);
  const commit = (value: number) => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const next = clamp(value);
    setPreferredWidth(next);
    onCommit?.(next);
  };
  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    setIsDragging(false);
    commit(pendingWidth.current);
  };

  return {
    ref,
    width,
    availableWidth,
    isDragging,
    separatorProps: {
      role: "separator",
      tabIndex: 0,
      "aria-orientation": "vertical" as const,
      "aria-valuemin": min,
      "aria-valuemax": max,
      "aria-valuenow": Math.round(width),
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        pendingWidth.current = width;
        setIsDragging(true);
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        if (!drag.current) return;
        const delta = (event.clientX - drag.current.x) * (side === "left" ? 1 : -1);
        pendingWidth.current = clamp(drag.current.width + delta);
        if (!frame.current) {
          frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            setPreferredWidth(pendingWidth.current);
          });
        }
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        finish();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      onPointerCancel() {
        if (!drag.current) return;
        pendingWidth.current = drag.current.width;
        finish();
      },
      onLostPointerCapture: finish,
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const delta = ({ ArrowRight: 20, ArrowLeft: -20 } as Record<string, number>)[event.key] ?? 0;
        if (!delta && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        if (event.key === "Home") commit(min);
        else if (event.key === "End") commit(max);
        else commit(width + delta * (side === "left" ? 1 : -1));
      }
    }
  };
}
