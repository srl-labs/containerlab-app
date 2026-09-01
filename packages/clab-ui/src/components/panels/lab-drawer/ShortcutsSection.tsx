// Keyboard shortcuts section for the settings drawer.
import React from "react";
import { Badge, Box, Text } from "@mantine/core";

/** Platform detection for keyboard symbols */
const isMac =
  typeof window !== "undefined" &&
  typeof window.navigator !== "undefined" &&
  /macintosh/i.test(window.navigator.userAgent);

/** Converts modifier keys based on platform */
function formatKey(key: string): string {
  if (!isMac) return key;
  return key.replace(/Ctrl/g, "Cmd").replace(/Alt/g, "Option");
}

interface ShortcutRowProps {
  label: string;
  shortcut: string;
}

const ShortcutRow: React.FC<ShortcutRowProps> = ({ label, shortcut }) => (
  <Box
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: 4,
      paddingBottom: 4
    }}
  >
    <Text size="sm">{label}</Text>
    <Badge
      variant="default"
      radius="sm"
      tt="none"
      style={{ fontFamily: "monospace", fontSize: "0.75rem", height: 22 }}
    >
      {formatKey(shortcut)}
    </Badge>
  </Box>
);

interface ShortcutSectionProps {
  title: string;
  color: string;
  children: React.ReactNode;
}

const ShortcutSection: React.FC<ShortcutSectionProps> = ({ title, color, children }) => (
  <Box style={{ marginBottom: 24 }}>
    <Text
      size="sm"
      fw={600}
      style={{ color, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}
    >
      {title}
    </Text>
    <Box style={{ paddingLeft: 0 }}>{children}</Box>
  </Box>
);

const SUCCESS_COLOR = "var(--vscode-testing-iconPassed, var(--vscode-charts-green))";
const INFO_COLOR = "var(--vscode-editorInfo-foreground)";
const SECONDARY_COLOR = "var(--vscode-button-secondaryBackground)";
const WARNING_COLOR = "var(--vscode-editorWarning-foreground)";

export const ShortcutsSection: React.FC = () => {
  return (
    <Box style={{ padding: 16 }}>
      <ShortcutSection title="Viewer Mode" color={SUCCESS_COLOR}>
        <ShortcutRow label="Select node/link" shortcut="Left Click" />
        <ShortcutRow label="Node actions" shortcut="Right Click" />
        <ShortcutRow label="Capture packets" shortcut="Right Click + Link" />
        <ShortcutRow label="Move nodes" shortcut="Drag" />
      </ShortcutSection>

      <ShortcutSection title="Editor Mode" color={INFO_COLOR}>
        <ShortcutRow label="Add node" shortcut="Shift + Click" />
        <ShortcutRow label="Create link" shortcut="Shift + Click node" />
        <ShortcutRow label="Delete element" shortcut="Alt + Click" />
        <ShortcutRow label="Context menu" shortcut="Right Click" />
        <ShortcutRow label="Select all" shortcut="Ctrl + A" />
        <ShortcutRow label="Multi-select" shortcut="Shift + Click" />
        <ShortcutRow label="Copy selected" shortcut="Ctrl + C" />
        <ShortcutRow label="Paste" shortcut="Ctrl + V" />
        <ShortcutRow label="Duplicate selected" shortcut="Ctrl + D" />
        <ShortcutRow label="Undo" shortcut="Ctrl + Z" />
        <ShortcutRow label="Redo" shortcut="Ctrl + Y" />
        <ShortcutRow label="Create group" shortcut="Ctrl + G" />
        <ShortcutRow label="Delete selected" shortcut="Del" />
      </ShortcutSection>

      <ShortcutSection title="Navigation" color={SECONDARY_COLOR}>
        <ShortcutRow label="Deselect all" shortcut="Esc" />
      </ShortcutSection>

      <ShortcutSection title="Tips" color={WARNING_COLOR}>
        <Text size="sm" component="ul" style={{ paddingLeft: 16, margin: 0 }}>
          <li style={{ marginBottom: 4 }}>Use layout algorithms to auto-arrange</li>
          <li style={{ marginBottom: 4 }}>
            Box select nodes, then <code>Ctrl+G</code> to group or <code>Del</code> to delete
          </li>
          <li style={{ marginBottom: 4 }}>Double-click any item to directly edit</li>
          <li style={{ marginBottom: 4 }}>Shift+Click a node to start creating a link</li>
        </Text>
      </ShortcutSection>
    </Box>
  );
};
