import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

/**
 * How many steps the toolbar gives up to stay on one line, measured rather
 * than guessed, since what it holds depends on the mode and the lab host's name.
 * Every step is measured before the paint, so the bar never shows too wide.
 */
export function useToolbarTrim(
  roomRef: RefObject<HTMLElement | null>,
  barRef: RefObject<HTMLElement | null>,
  maxLevel: number,
  /** Changes when the bar's contents do, so it is measured again from the start. */
  contentKey: string
): { trimLevel: number } {
  const [trimLevel, setTrimLevel] = useState(0);
  const [roomWidth, setRoomWidth] = useState(0);
  const measuredKey = useRef(contentKey);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || typeof ResizeObserver === "undefined") return undefined;
    let previousWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      flushSync(() => {
        setRoomWidth(width);
        // With more room, what was trimmed may fit again.
        if (width > previousWidth) setTrimLevel(0);
      });
      previousWidth = width;
    });
    observer.observe(room);
    return () => observer.disconnect();
  }, [roomRef]);

  useLayoutEffect(() => {
    if (measuredKey.current !== contentKey) {
      measuredKey.current = contentKey;
      if (trimLevel > 0) {
        setTrimLevel(0);
        return;
      }
    }
    const bar = barRef.current;
    if (bar && trimLevel < maxLevel && bar.scrollWidth > bar.clientWidth) setTrimLevel(trimLevel + 1);
  }, [barRef, contentKey, maxLevel, roomWidth, trimLevel]);

  return { trimLevel };
}
