// Grid settings popover.
import type { GridStyle } from "../../hooks/ui";

export interface GridSettingsControlsProps {
  gridLineWidth: number;
  onGridLineWidthChange: (width: number) => void;
  gridStyle: GridStyle;
  onGridStyleChange: (style: GridStyle) => void;
  gridColor: string | null;
  onGridColorChange: (color: string | null) => void;
  gridBgColor: string | null;
  onGridBgColorChange: (color: string | null) => void;
  onResetGridColors: () => void;
}
