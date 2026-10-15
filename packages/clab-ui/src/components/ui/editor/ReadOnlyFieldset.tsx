// Editor form body that turns read-only while the lab is locked.
import React from "react";
import Box from "@mui/material/Box";

import { useTopoViewerStore } from "../../../stores/topoViewerStore";
import { FIELDSET_RESET_STYLE } from "../../panels/context-panel/ContextPanelScrollArea";

/** Read-only forms read as a property sheet: muted values, no dropdown arrows or action buttons. */
const READ_ONLY_SX = {
  ...FIELDSET_RESET_STYLE,
  // Presses fall through to the wrapper, which shakes the lock.
  pointerEvents: "none",
  "& .MuiInputBase-root, & .MuiInputBase-input": {
    color: "text.secondary",
    WebkitTextFillColor: "currentColor"
  },
  // Required markers only make sense while typing.
  "& .MuiFormLabel-asterisk": { display: "none" },
  "& .MuiSelect-icon, & .MuiAutocomplete-endAdornment": { display: "none" },
  "& .MuiButton-root, & .MuiIconButton-root": { display: "none" },
  "& .MuiCheckbox-root, & .MuiSwitch-root, & .MuiRadio-root, & .MuiSlider-root": {
    opacity: 0.5
  }
} as const;

/** Keys that would open a select or press a focused control. */
const ACTIVATION_KEYS = new Set(["Enter", " ", "ArrowDown", "ArrowUp"]);

/**
 * A read-only form is disabled and styled so it can't look editable, while
 * staying readable to screen readers. Pressing it shakes the navbar lock.
 */
export const ReadOnlyFieldset: React.FC<{ readOnly: boolean; children: React.ReactNode }> = ({
  readOnly,
  children
}) => {
  const nudgeLock = useTopoViewerStore((state) => state.nudgeLock);

  if (!readOnly) {
    return <fieldset style={FIELDSET_RESET_STYLE}>{children}</fieldset>;
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <Box
      data-testid="editor-readonly"
      onMouseDown={(event: React.MouseEvent) => {
        if (event.button === 0) nudgeLock();
      }}
      // Selects stay focusable inside a disabled fieldset; keep them closed.
      onKeyDownCapture={(event: React.KeyboardEvent) => {
        if (!ACTIVATION_KEYS.has(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        nudgeLock();
      }}
    >
      <Box component="fieldset" disabled sx={READ_ONLY_SX}>
        {children}
      </Box>
    </Box>
  );
};
