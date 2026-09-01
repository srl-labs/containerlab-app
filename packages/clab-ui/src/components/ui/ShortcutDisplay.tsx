/**
 * ShortcutDisplay - Visual feedback for keyboard/mouse shortcuts
 * Displays detected input events as floating labels
 */
import React from "react";
import { Box } from "@mantine/core";

interface ShortcutDisplayItem {
  id: number;
  text: string;
}

interface ShortcutDisplayProps {
  shortcuts: ShortcutDisplayItem[];
}

export const ShortcutDisplay: React.FC<ShortcutDisplayProps> = ({ shortcuts }) => {
  if (shortcuts.length === 0) return null;

  return (
    <Box
      className="shortcut-display"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        display: "flex",
        flexDirection: "column-reverse",
        alignItems: "flex-start",
        gap: 4,
        zIndex: 100000,
        pointerEvents: "none"
      }}
    >
      {shortcuts.map((shortcut) => (
        <Box
          key={shortcut.id}
          className="shortcut-display-item"
          style={{
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 6,
            paddingBottom: 6,
            borderRadius: 8,
            boxShadow: "var(--mantine-shadow-md)",
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
