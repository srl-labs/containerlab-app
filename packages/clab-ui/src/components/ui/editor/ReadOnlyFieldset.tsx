// Editor form body that turns read-only while the lab is locked.
import React from "react";
import Box from "@mui/material/Box";

import { useTopoViewerStore } from "../../../stores/topoViewerStore";
import { FIELDSET_RESET_STYLE } from "../../panels/context-panel/ContextPanelScrollArea";

/** Read-only forms read as a property sheet: muted values, no dropdown arrows or action buttons. */
const READ_ONLY_SX = {
  ...FIELDSET_RESET_STYLE,
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

/**
 * A read-only form is inert (no clicks, focus or typing) and styled so it
 * can't look editable. Pressing it shakes the navbar lock instead.
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
    // Inert content passes presses through to this wrapper.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <Box
      data-testid="editor-readonly"
      onMouseDown={(event: React.MouseEvent) => {
        if (event.button === 0) nudgeLock();
      }}
    >
      <Box component="fieldset" disabled inert sx={READ_ONLY_SX}>
        {children}
      </Box>
    </Box>
  );
};
