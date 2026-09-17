/**
 * Group types for group editor panel and hooks
 */

/** Style properties for groups */
interface GroupStyle {
  backgroundColor?: string;
  backgroundOpacity?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dotted" | "dashed" | "double";
  borderRadius?: number;
  color?: string;
  labelColor?: string;
  labelPosition?: string;
}

/** Editor data for group editing panel */
export interface GroupEditorData {
  id: string;
  name: string;
  level: string;
  style: GroupStyle;
  position: { x: number; y: number };
  width: number;
  height: number;
  members?: string[];
  parentId?: string;
  zIndex?: number;
}

/** Label position options */
export const GROUP_LABEL_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right"
] as const;
