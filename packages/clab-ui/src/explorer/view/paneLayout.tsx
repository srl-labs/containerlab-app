import Box from "@mui/material/Box";
import type { Theme } from "@mui/material/styles";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState
} from "react";
import type { ExplorerSectionId, ExplorerSectionSnapshot } from "../shared/explorer/types";
import {
  FIXED_HEIGHT_SECTIONS,
  MIN_SECTION_BODY_HEIGHT_PX,
  RESIZE_DIVIDER_HEIGHT_PX
} from "./constants";
import { sectionHeaderHeight } from "./sectionModel";

interface ResizeDividerProps {
  aboveId: ExplorerSectionId;
  belowId: ExplorerSectionId;
  onResizeStart: (aboveId: ExplorerSectionId, belowId: ExplorerSectionId, startY: number) => void;
}

export function ResizeDivider({ aboveId, belowId, onResizeStart }: Readonly<ResizeDividerProps>) {
  return (
    <Box
      onMouseDown={(e) => {
        e.preventDefault();
        onResizeStart(aboveId, belowId, e.clientY);
      }}
      sx={{
        height: RESIZE_DIVIDER_HEIGHT_PX,
        flex: `0 0 ${RESIZE_DIVIDER_HEIGHT_PX}px`,
        cursor: "row-resize",
        position: "relative",
        "&::after": {
          content: '""',
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          height: "1px",
          transform: "translateY(-50%)",
          bgcolor: "divider",
          transition: "height 90ms ease, background-color 90ms ease"
        },
        "&:hover::after": {
          height: "2px",
          bgcolor: (theme: Theme) => theme.alpha(theme.palette.text.primary, 0.35)
        }
      }}
    />
  );
}

export function usePaneResize(
  containerRef: RefObject<HTMLDivElement | null>,
  heightRatioBySection: Partial<Record<ExplorerSectionId, number>>,
  setHeightRatioBySection: Dispatch<SetStateAction<Partial<Record<ExplorerSectionId, number>>>>,
  collapsedBySection: Partial<Record<ExplorerSectionId, boolean>>,
  orderedSections: ExplorerSectionSnapshot[]
) {
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);

  const handleResizeStart = useCallback(
    (aboveId: ExplorerSectionId, belowId: ExplorerSectionId, startY: number) => {
      const container = containerRef.current;
      if (!container) return;

      isResizingRef.current = true;
      setIsResizing(true);

      const expandedSections = orderedSections.filter(
        (section) => !collapsedBySection[section.id] && !FIXED_HEIGHT_SECTIONS.has(section.id)
      );
      const expandedIds = expandedSections.map((section) => section.id);
      const headerHeight = expandedSections.reduce(
        (sum, section) => sum + sectionHeaderHeight(section),
        0
      );
      const dividerCount = Math.max(0, expandedIds.length - 1);
      const containerHeight = container.clientHeight;
      const availableBody =
        containerHeight - headerHeight - dividerCount * RESIZE_DIVIDER_HEIGHT_PX;

      const initialAboveRatio = heightRatioBySection[aboveId] ?? 1 / expandedIds.length;
      const initialBelowRatio = heightRatioBySection[belowId] ?? 1 / expandedIds.length;
      const combinedRatio = initialAboveRatio + initialBelowRatio;

      const onMouseMove = (ev: globalThis.MouseEvent) => {
        if (!isResizingRef.current) return;

        const deltaY = ev.clientY - startY;
        const ratioDelta = availableBody > 0 ? deltaY / availableBody : 0;

        const minRatio = availableBody > 0 ? MIN_SECTION_BODY_HEIGHT_PX / availableBody : 0;
        let newAboveRatio = initialAboveRatio + ratioDelta;
        let newBelowRatio = initialBelowRatio - ratioDelta;

        if (newAboveRatio < minRatio) {
          newAboveRatio = minRatio;
          newBelowRatio = combinedRatio - minRatio;
        }
        if (newBelowRatio < minRatio) {
          newBelowRatio = minRatio;
          newAboveRatio = combinedRatio - minRatio;
        }

        setHeightRatioBySection((current) => ({
          ...current,
          [aboveId]: newAboveRatio,
          [belowId]: newBelowRatio
        }));
      };

      const onMouseUp = () => {
        isResizingRef.current = false;
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [
      containerRef,
      heightRatioBySection,
      setHeightRatioBySection,
      collapsedBySection,
      orderedSections
    ]
  );

  return { isResizing, handleResizeStart };
}

export function normalizeHeightRatios(
  currentRatios: Partial<Record<ExplorerSectionId, number>>,
  expandedIds: ExplorerSectionId[]
): Partial<Record<ExplorerSectionId, number>> {
  const n = expandedIds.length;
  if (n === 0) return currentRatios;

  const nextRatios: Partial<Record<ExplorerSectionId, number>> = { ...currentRatios };
  for (const id of expandedIds) {
    if (nextRatios[id] === undefined || nextRatios[id] === 0) {
      nextRatios[id] = 1 / n;
    }
  }
  const total = expandedIds.reduce((sum, id) => sum + (nextRatios[id] ?? 0), 0);
  if (total > 0) {
    for (const id of expandedIds) {
      nextRatios[id] = (nextRatios[id] ?? 0) / total;
    }
  }
  return nextRatios;
}
