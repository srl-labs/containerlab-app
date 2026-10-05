import type { Theme } from "@mui/material/styles";
import type { ExplorerSectionId } from "../shared/explorer/types";

export const COLOR_TEXT_PRIMARY = "text.primary";

export const COLOR_TEXT_SECONDARY = "text.secondary";

export const FILTER_UPDATE_DEBOUNCE_MS = 250;

export const UI_STATE_UPDATE_DEBOUNCE_MS = 160;

export const DEFAULT_EXPANDED_SECTIONS = new Set<ExplorerSectionId>([
  "runningLabs",
  "localLabs",
  "fileExplorer",
  "helpFeedback"
]);

/** Horizontal step between tree levels. */
export const TREE_INDENT_PX = 14;

export const TREE_DISCLOSURE_SLOT_PX = 18;

export const TREE_ROW_GAP_PX = 6;

export const NODE_MARKER_SLOT_PX = 16;

export const SECTION_HEADER_HEIGHT_PX = 30;

export const TREE_ROW_HEIGHT_PX = 26;

export const TREE_SECTION_ROW_HEIGHT_PX = 24;

export const TREE_ENDPOINT_ROW_HEIGHT_PX = 30;

export const RESIZE_DIVIDER_HEIGHT_PX = 5;

export const MIN_SECTION_BODY_HEIGHT_PX = 40;

export const FIXED_HEIGHT_SECTIONS: ReadonlySet<ExplorerSectionId> = new Set(["helpFeedback"]);

export const ROW_RADIUS_PX = 6;

/** Gap between the tree rows and the edge of the pane. */
export const TREE_ROW_INSET_PX = 6;

export const TOOLBAR_ICON_BUTTON_SX = {
  width: 26,
  height: 26,
  borderRadius: `${ROW_RADIUS_PX}px`,
  color: COLOR_TEXT_SECONDARY,
  "&:hover": {
    color: COLOR_TEXT_PRIMARY,
    bgcolor: (theme: Theme) => theme.alpha(theme.palette.text.primary, 0.1)
  }
} as const;
