import type { Theme } from "@mui/material/styles";
import type { ExplorerSectionId } from "../shared/explorer/types";

const COLOR_ERROR_MAIN = "error.main";

export const COLOR_TEXT_PRIMARY = "text.primary";

export const COLOR_TEXT_SECONDARY = "text.secondary";

export const COLOR_TEXT_DISABLED = "text.disabled";

export const FILTER_UPDATE_DEBOUNCE_MS = 250;

export const UI_STATE_UPDATE_DEBOUNCE_MS = 160;

export const DEFAULT_EXPANDED_SECTIONS = new Set<ExplorerSectionId>([
  "runningLabs",
  "localLabs",
  "fileExplorer",
  "helpFeedback"
]);

export const TREE_DEPTH_INDENT = 1.25;

export const TREE_DISCLOSURE_SLOT_PX = 16;

export const TREE_ROW_GAP = 0.2;

export const NODE_MARKER_SLOT_PX = 13;

export const SECTION_HEADER_HEIGHT_PX = 24;

export const TREE_ROW_HEIGHT_PX = 22;

export const TREE_SECTION_ROW_HEIGHT_PX = 22;

export const TREE_ENDPOINT_ROW_HEIGHT_PX = 24;

export const RESIZE_DIVIDER_HEIGHT_PX = 4;

export const MIN_SECTION_BODY_HEIGHT_PX = 40;

export const FIXED_HEIGHT_SECTIONS: ReadonlySet<ExplorerSectionId> = new Set(["helpFeedback"]);

export const STATUS_COLOR_MAP: Record<string, string> = {
  green: "success.main",
  red: COLOR_ERROR_MAIN,
  yellow: "warning.main",
  blue: "info.main",
  gray: COLOR_TEXT_DISABLED
};

export const TOOLBAR_ICON_BUTTON_SX = {
  width: 24,
  height: 24,
  borderRadius: 1,
  color: COLOR_TEXT_PRIMARY,
  "&:hover": {
    bgcolor: (theme: Theme) => theme.alpha(theme.palette.primary.main, 0.14)
  }
} as const;
