/**
 * Shared button constants for Easter Egg modes
 */
import type React from "react";

/** Button visible state style */
export const BTN_VISIBLE_SX: React.CSSProperties = {
  opacity: 1,
  transform: "translateY(0)"
};

/** Button hidden state style */
export const BTN_HIDDEN_SX: React.CSSProperties = {
  opacity: 0,
  transform: "translateY(16px)"
};

/** Button backdrop blur value */
export const BTN_BLUR = "blur(10px)";
