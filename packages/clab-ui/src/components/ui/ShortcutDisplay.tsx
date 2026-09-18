/**
 * ShortcutDisplay - Visual feedback for keyboard/mouse shortcuts
 * Displays detected input events as floating labels
 */
import React from "react";
import Box from "@mui/material/Box";

import { floatingRadius } from "../../theme/surfaces";

interface ShortcutDisplayItem {
  id: number;
  text: string;
}

interface ShortcutDisplayProps {
  shortcuts: ShortcutDisplayItem[];
  side?: "left" | "right";
}

export const ShortcutDisplay: React.FC<ShortcutDisplayProps> = ({ shortcuts, side = "left" }) => {
  if (shortcuts.length === 0) return null;

  const isLeft = side === "left";

  return (
    <Box
      className="shortcut-display"
      sx={{
        position: "absolute",
        bottom: 16,
        ...(isLeft
          ? { left: "calc(var(--clab-ui-panel-left, 0px) + 16px)" }
          : { right: "calc(var(--clab-ui-panel-right, 0px) + 16px)" }),
        display: "flex",
        flexDirection: "column-reverse",
        alignItems: isLeft ? "flex-start" : "flex-end",
        gap: 0.5,
        zIndex: 100000,
        pointerEvents: "none"
      }}
    >
      {shortcuts.map((shortcut) => (
        <Box
          key={shortcut.id}
          className="shortcut-display-item"
          sx={{
            px: 2,
            py: 0.75,
            borderRadius: floatingRadius,
            boxShadow: 3,
            fontFamily: "sans-serif",
            fontSize: "0.875rem",
            letterSpacing: "0.025em",
            animation: "shortcutFade 2s ease-in-out forwards"
          }}
        >
          {shortcut.text}
        </Box>
      ))}
    </Box>
  );
};
