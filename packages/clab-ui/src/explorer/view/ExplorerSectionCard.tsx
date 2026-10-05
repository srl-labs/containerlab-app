import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import UnfoldLessRoundedIcon from "@mui/icons-material/UnfoldLessRounded";
import UnfoldMoreRoundedIcon from "@mui/icons-material/UnfoldMoreRounded";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { ContextMenu } from "../../components/context-menu/ContextMenu";
import { flattenExpandableNodeIds } from "../explorerUiState";
import { ROW_RADIUS_PX, SECTION_HEADER_HEIGHT_PX, TOOLBAR_ICON_BUTTON_SX, TREE_ROW_INSET_PX } from "./constants";
import type { ExplorerSectionCardProps } from "./types";
import { formatSectionTitle, isBareTreeSection, showSectionCount } from "./sectionModel";
import { toContextMenuItem } from "./menuItems";
import { SectionToolbarActions, SectionTree } from "./SectionTree";

function getSectionPaperSx(isDropTarget: boolean, flexStyle: string) {
  return {
    flex: flexStyle,
    minHeight: 0,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    borderRadius: 0,
    border: "none",
    bgcolor: "transparent",
    boxShadow: isDropTarget
      ? (theme: Theme) => `inset 0 0 0 1px ${theme.alpha(theme.palette.primary.main, 0.35)}`
      : "none"
  };
}

function getSectionHeaderSx(isBeingDragged: boolean) {
  return {
    mx: `${TREE_ROW_INSET_PX}px`,
    pl: "2px",
    pr: "4px",
    height: SECTION_HEADER_HEIGHT_PX,
    minHeight: SECTION_HEADER_HEIGHT_PX,
    maxHeight: SECTION_HEADER_HEIGHT_PX,
    display: "flex",
    alignItems: "center",
    gap: "2px",
    borderRadius: `${ROW_RADIUS_PX}px`,
    cursor: isBeingDragged ? "grabbing" : "grab",
    userSelect: "none",
    bgcolor: isBeingDragged ? "action.selected" : "transparent",
    "&:hover": {
      bgcolor: "action.hover"
    },
    "& .explorer-section-hover-actions": {
      opacity: isBeingDragged ? 1 : 0,
      pointerEvents: isBeingDragged ? "auto" : "none",
      transition: "opacity 120ms ease"
    },
    "&:hover .explorer-section-hover-actions, &:focus-within .explorer-section-hover-actions": {
      opacity: 1,
      pointerEvents: "auto"
    }
  };
}

export function ExplorerSectionCard({
  section,
  headerless = false,
  expandedItems,
  isCollapsed,
  isDropTarget,
  isBeingDragged,
  flexStyle,
  onSetSectionRef,
  onSectionDragStart,
  onSectionDragOver,
  onSectionDrop,
  onSectionDragEnd,
  onToggleSectionCollapsed,
  onInvokeAction,
  onExpandedItemsChange,
  onExpandAllInSection,
  onCollapseAllInSection
}: Readonly<ExplorerSectionCardProps>) {
  const expandableIds = useMemo(() => flattenExpandableNodeIds(section.nodes), [section.nodes]);
  const bareTreeSection = headerless || isBareTreeSection(section);
  const [sectionMenuPosition, setSectionMenuPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const [sectionMenuOpenToLeft, setSectionMenuOpenToLeft] = useState(false);
  const sectionContextMenuItems = useMemo(
    () => (section.contextActions ?? []).map((action) => toContextMenuItem(action, onInvokeAction)),
    [onInvokeAction, section.contextActions]
  );

  const allExpanded = useMemo(() => {
    if (expandableIds.length === 0) {
      return false;
    }
    const expandedIds = new Set(expandedItems);
    return expandableIds.every((id) => expandedIds.has(id));
  }, [expandableIds, expandedItems]);

  const showExpandAllControl = section.id !== "helpFeedback" && expandableIds.length > 0;
  const handleSectionMenuClose = useCallback(() => {
    setSectionMenuOpenToLeft(false);
    setSectionMenuPosition(null);
  }, []);
  const handleSectionBodyContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (sectionContextMenuItems.length === 0) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-explorer-node-row="true"]')) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setSectionMenuOpenToLeft(event.clientX > window.innerWidth - 260);
      setSectionMenuPosition({ x: event.clientX, y: event.clientY });
    },
    [sectionContextMenuItems.length]
  );

  return (
    <Paper
      variant="outlined"
      ref={(element: HTMLDivElement | null) => {
        onSetSectionRef(section.id, element);
      }}
      sx={getSectionPaperSx(isDropTarget, flexStyle)}
      onDragOver={onSectionDragOver(section.id)}
      onDrop={onSectionDrop(section.id)}
    >
      {!bareTreeSection && (
        <Box
          draggable
          onDragStart={onSectionDragStart(section.id)}
          onDragEnd={onSectionDragEnd}
          sx={{ ...getSectionHeaderSx(isBeingDragged), flex: "0 0 auto" }}
        >
          <IconButton
            size="small"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleSectionCollapsed(section.id);
            }}
            aria-label={isCollapsed ? `Expand ${section.label}` : `Collapse ${section.label}`}
            sx={{ color: "text.disabled", p: 0, width: 18, height: 18, "&:hover": { color: "text.primary", bgcolor: "transparent" } }}
          >
            <ChevronRightRoundedIcon
              sx={{
                fontSize: 16,
                transform: isCollapsed ? "none" : "rotate(90deg)",
                transition: "transform 120ms ease",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" }
              }}
            />
          </IconButton>

          <Box
            onClick={() => onToggleSectionCollapsed(section.id)}
            sx={{
              minWidth: 0,
              flex: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 0.5
            }}
          >
            <Typography className="explorer-section-title" variant="body2" noWrap>
              {formatSectionTitle(section)}
            </Typography>
            {showSectionCount(section) && (
              <Typography
                className="explorer-section-count"
                variant="caption"
                sx={{ color: "text.disabled", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}
              >
                {section.count}
              </Typography>
            )}
          </Box>

          <SectionToolbarActions actions={section.toolbarActions} onInvokeAction={onInvokeAction} />

          {showExpandAllControl && (
            <Tooltip title={allExpanded ? "Collapse All" : "Expand All"}>
              <IconButton
                size="small"
                className="explorer-section-hover-actions"
                sx={TOOLBAR_ICON_BUTTON_SX}
                aria-label={allExpanded ? "Collapse all" : "Expand all"}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (allExpanded) {
                    onCollapseAllInSection(section.id);
                  } else {
                    onExpandAllInSection(section.id, section.nodes);
                  }
                }}
              >
                {allExpanded ? (
                  <UnfoldLessRoundedIcon sx={{ fontSize: 17 }} />
                ) : (
                  <UnfoldMoreRoundedIcon sx={{ fontSize: 17 }} />
                )}
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}

      {!isCollapsed && (
        <Box
          sx={{
            px: 0,
            py: "2px",
            flex: 1,
            minHeight: 0,
            overflowY: "auto"
          }}
          onContextMenu={handleSectionBodyContextMenu}
        >
          <SectionTree
            section={section}
            expandedItems={expandedItems}
            onExpandedItemsChange={(itemIds) => onExpandedItemsChange(section.id, itemIds)}
            onInvokeAction={onInvokeAction}
          />
          <ContextMenu
            isVisible={Boolean(sectionMenuPosition) && sectionContextMenuItems.length > 0}
            position={sectionMenuPosition ?? { x: 0, y: 0 }}
            items={sectionContextMenuItems}
            compact
            openToLeft={sectionMenuOpenToLeft}
            onClose={handleSectionMenuClose}
          />
        </Box>
      )}
    </Paper>
  );
}
