// Keyboard shortcuts section for the settings drawer.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { SHORTCUTS, formatKey, shortcutKeys, type ShortcutId } from "../../../utils/shortcuts";

interface ShortcutRowProps {
  label: string;
  shortcut: string;
}

const KEYCAP_SX = {
  display: "inline-flex",
  alignItems: "center",
  height: 20,
  px: 0.75,
  borderRadius: 1,
  border: 1,
  borderColor: "divider",
  bgcolor: "action.hover",
  color: "text.primary",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 500,
  lineHeight: 1,
  whiteSpace: "nowrap"
} as const;

/** Renders "Ctrl + A" as separate keycaps joined by a quiet plus. */
const ShortcutKeys: React.FC<{ shortcut: string }> = ({ shortcut }) => {
  const keys = formatKey(shortcut).split(" + ");
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
      {keys.map((key, index) => (
        <React.Fragment key={key}>
          {index > 0 && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              +
            </Typography>
          )}
          <Box component="kbd" sx={KEYCAP_SX}>
            {key}
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
};

const ShortcutRow: React.FC<ShortcutRowProps> = ({ label, shortcut }) => (
  <Box
    sx={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 2,
      minHeight: 28
    }}
  >
    <Typography variant="body2">{label}</Typography>
    <ShortcutKeys shortcut={shortcut} />
  </Box>
);

interface ShortcutSectionProps {
  title: string;
  children: React.ReactNode;
}

/** A keyboard shortcut from the editor's shortcut table. */
const KeyRow: React.FC<{ id: ShortcutId }> = ({ id }) => (
  <ShortcutRow label={SHORTCUTS[id].label} shortcut={SHORTCUTS[id].keys} />
);

const ShortcutSection: React.FC<ShortcutSectionProps> = ({ title, children }) => (
  <Box sx={{ "& + &": { mt: 2.5 } }}>
    <Typography
      variant="overline"
      component="h3"
      sx={{ display: "block", color: "text.secondary", mb: 0.5 }}
    >
      {title}
    </Typography>
    <Box>{children}</Box>
  </Box>
);

export const ShortcutsSection: React.FC = () => {
  return (
    <Box sx={{ px: 2.5, py: 2 }}>
      {/* Viewer Mode */}
      <ShortcutSection title="Viewer Mode">
        <ShortcutRow label="Select node/link" shortcut="Left Click" />
        <ShortcutRow label="Node actions" shortcut="Right Click" />
        <ShortcutRow label="Capture packets" shortcut="Right Click + Link" />
        <ShortcutRow label="Move nodes" shortcut="Drag" />
      </ShortcutSection>

      {/* Editor Mode */}
      <ShortcutSection title="Editor Mode">
        <ShortcutRow label="Add node" shortcut="Shift + Click" />
        <ShortcutRow label="Create link" shortcut="Shift + Click node" />
        <ShortcutRow label="Delete element" shortcut="Alt + Click" />
        <ShortcutRow label="Context menu" shortcut="Right Click" />
        <ShortcutRow label="Multi-select" shortcut="Shift + Click" />
        <KeyRow id="selectAll" />
        <KeyRow id="copy" />
        <KeyRow id="paste" />
        <KeyRow id="duplicate" />
        <KeyRow id="undo" />
        <KeyRow id="redo" />
        <KeyRow id="group" />
        <KeyRow id="delete" />
      </ShortcutSection>

      {/* Tools */}
      <ShortcutSection title="Tools">
        <KeyRow id="selectTool" />
        <KeyRow id="textTool" />
        <KeyRow id="rectangleTool" />
        <KeyRow id="circleTool" />
        <KeyRow id="linkTool" />
      </ShortcutSection>

      {/* Annotation order */}
      <ShortcutSection title="Arrange Annotations">
        <KeyRow id="bringForward" />
        <KeyRow id="sendBackward" />
        <KeyRow id="bringToFront" />
        <KeyRow id="sendToBack" />
      </ShortcutSection>

      {/* Navigation */}
      <ShortcutSection title="Navigation">
        <KeyRow id="fitView" />
        <KeyRow id="deselect" />
      </ShortcutSection>

      {/* Tips */}
      <ShortcutSection title="Tips">
        <Typography
          variant="body2"
          component="ul"
          sx={{
            pl: 2,
            m: 0,
            color: "text.secondary",
            "& li": { mb: 0.5 },
            "& code": { fontFamily: MONO_FONT_FAMILY, fontSize: 12, color: "text.primary" }
          }}
        >
          <li>Use layout algorithms to auto-arrange</li>
          <li>
            Box select nodes, then <code>{shortcutKeys("group")}</code> to group or{" "}
            <code>{shortcutKeys("delete")}</code> to delete
          </li>
          <li>Double-click an item to edit it</li>
          <li>Shift+click a node to start a link</li>
        </Typography>
      </ShortcutSection>
    </Box>
  );
};
