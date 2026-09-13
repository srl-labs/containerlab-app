/**
 * Shared types for Easter Egg modes
 */

/** RGB color type */
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/** Base props for all easter egg mode components */
export interface BaseModeProps {
  isActive: boolean;
  onClose?: () => void;
  onSwitchMode?: () => void;
  modeName?: string;
}
