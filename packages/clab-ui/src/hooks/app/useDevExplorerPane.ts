/**
 * Resizable dev-explorer side pane (dev-mock webview only).
 */
import React from "react";

export const DEV_EXPLORER_MIN_WIDTH = 280;
const DEV_EXPLORER_DEFAULT_WIDTH = 360;

export function getDevExplorerMaxWidth(): number {
  return Math.max(DEV_EXPLORER_MIN_WIDTH, Math.floor(window.innerWidth / 2));
}

export function isDevExplorerDisabledByUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  const rawValue = params.get("devExplorer");
  if (rawValue == null || rawValue.length === 0) return false;
  const normalized = rawValue.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off";
}

export interface DevExplorerPaneState {
  layoutRef: React.RefObject<HTMLDivElement | null>;
  devExplorerWidth: number;
  isDevExplorerDragging: boolean;
  handleDevExplorerResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export function useDevExplorerPane(showDevExplorer: boolean): DevExplorerPaneState {
  const layoutRef = React.useRef<HTMLDivElement | null>(null);
  const [devExplorerWidth, setDevExplorerWidth] = React.useState(DEV_EXPLORER_DEFAULT_WIDTH);
  const [isDevExplorerDragging, setIsDevExplorerDragging] = React.useState(false);
  const isDevExplorerDraggingRef = React.useRef(false);

  const handleDevExplorerResizeStart = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!showDevExplorer) {
        return;
      }

      event.preventDefault();
      isDevExplorerDraggingRef.current = true;
      setIsDevExplorerDragging(true);

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDevExplorerDraggingRef.current) {
          return;
        }

        const layoutLeft = layoutRef.current?.getBoundingClientRect().left ?? 0;
        const nextWidth = moveEvent.clientX - layoutLeft;
        const clampedWidth = Math.min(
          getDevExplorerMaxWidth(),
          Math.max(DEV_EXPLORER_MIN_WIDTH, nextWidth)
        );
        setDevExplorerWidth(clampedWidth);
      };

      const onMouseUp = () => {
        isDevExplorerDraggingRef.current = false;
        setIsDevExplorerDragging(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [showDevExplorer]
  );

  React.useEffect(() => {
    if (!showDevExplorer) {
      return;
    }

    const handleWindowResize = () => {
      setDevExplorerWidth((currentWidth) =>
        Math.min(getDevExplorerMaxWidth(), Math.max(DEV_EXPLORER_MIN_WIDTH, currentWidth))
      );
    };

    handleWindowResize();
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [showDevExplorer]);

  return {
    layoutRef,
    devExplorerWidth,
    isDevExplorerDragging,
    handleDevExplorerResizeStart
  };
}
