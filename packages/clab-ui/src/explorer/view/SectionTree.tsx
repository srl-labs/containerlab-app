import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useMemo } from "react";
import type { ExplorerAction, ExplorerNode, ExplorerSectionId } from "../shared/explorer/types";
import { flattenDescendantNodeIds, nextExpandedItemsForNodeToggle } from "../explorerUiState";
import {
  ROW_RADIUS_PX,
  TOOLBAR_ICON_BUTTON_SX,
  TREE_DISCLOSURE_SLOT_PX,
  TREE_INDENT_PX,
  TREE_ROW_INSET_PX
} from "./constants";
import type { SectionToolbarProps, SectionTreeProps } from "./types";
import {
  endpointRowHeight,
  isEndpointNode,
  isEndpointSectionNode,
  isFileExplorerFolderNode
} from "./nodeState";
import { actionIcon } from "./actionPresentation";
import { ExplorerNodeLabel } from "./ExplorerNodeLabel";

interface SectionTreeNodeProps {
  node: ExplorerNode;
  sectionId: ExplorerSectionId;
  depth: number;
  expandedIds: ReadonlySet<string>;
  onToggleExpanded: (nodeId: string) => void;
  onInvokeAction: (action: ExplorerAction) => void;
}

function SectionTreeNode({
  node,
  sectionId,
  depth,
  expandedIds,
  onToggleExpanded,
  onInvokeAction
}: Readonly<SectionTreeNodeProps>) {
  const hasChildren = node.hasChildren || node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isEndpointRoot = isEndpointNode(node.contextValue);
  const isEndpointSection = isEndpointSectionNode(node.contextValue);
  const toggleOnRowClick =
    hasChildren &&
    (isEndpointRoot || isEndpointSection || isFileExplorerFolderNode(node.contextValue));
  const rowMinHeight = endpointRowHeight(isEndpointRoot, isEndpointSection);
  const indent = depth * TREE_INDENT_PX;

  return (
    <Box>
      <Box
        className="explorer-tree-row"
        sx={{
          display: "flex",
          alignItems: "center",
          minHeight: rowMinHeight,
          ml: `${TREE_ROW_INSET_PX}px`,
          mr: `${TREE_ROW_INSET_PX}px`,
          pl: `${indent + 2}px`,
          pr: "4px",
          borderRadius: `${ROW_RADIUS_PX}px`,
          transition: "background-color 90ms ease",
          "&:hover, &:has([data-menu-open='true'])": { bgcolor: "action.hover" },
          "&:hover .explorer-tree-chevron": { color: "text.secondary" },
          "&:hover .explorer-node-actions-trigger, &:focus-within .explorer-node-actions-trigger": {
            opacity: 1,
            pointerEvents: "auto"
          }
        }}
      >
        <Box
          sx={{
            width: TREE_DISCLOSURE_SLOT_PX,
            flex: `0 0 ${TREE_DISCLOSURE_SLOT_PX}px`,
            display: "flex",
            justifyContent: "center",
            alignItems: "center"
          }}
        >
          {hasChildren && (
            <IconButton
              size="small"
              className="explorer-tree-chevron"
              sx={{
                width: TREE_DISCLOSURE_SLOT_PX,
                height: TREE_DISCLOSURE_SLOT_PX,
                p: 0,
                borderRadius: "4px",
                color: "text.disabled",
                "&:hover": { color: "text.primary", bgcolor: "transparent" }
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleExpanded(node.id);
              }}
              aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
            >
              <ChevronRightRoundedIcon
                sx={{
                  fontSize: 16,
                  transform: isExpanded ? "rotate(90deg)" : "none",
                  transition: "transform 120ms ease",
                  "@media (prefers-reduced-motion: reduce)": { transition: "none" }
                }}
              />
            </IconButton>
          )}
        </Box>

        <Box
          onClick={(event) => {
            if (!toggleOnRowClick) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onToggleExpanded(node.id);
          }}
          sx={{ flex: 1, minWidth: 0, cursor: toggleOnRowClick ? "pointer" : "default" }}
        >
          <ExplorerNodeLabel
            node={node}
            sectionId={sectionId}
            expanded={isExpanded}
            onInvokeAction={onInvokeAction}
          />
        </Box>
      </Box>

      {hasChildren && isExpanded && (
        <Box
          sx={{
            position: "relative",
            "&::before": {
              content: '""',
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${TREE_ROW_INSET_PX + indent + 2 + TREE_DISCLOSURE_SLOT_PX / 2}px`,
              width: "1px",
              bgcolor: (theme) => theme.alpha(theme.palette.divider, 0.7),
              pointerEvents: "none"
            }
          }}
        >
          {node.children.map((child) => (
            <SectionTreeNode
              key={child.id}
              node={child}
              sectionId={sectionId}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
              onInvokeAction={onInvokeAction}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

export function SectionTree({
  section,
  expandedItems,
  onExpandedItemsChange,
  onInvokeAction
}: Readonly<SectionTreeProps>) {
  const nodeById = useMemo(() => {
    const map = new Map<string, ExplorerNode>();
    const visit = (nodes: ExplorerNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node);
        if (node.children.length > 0) {
          visit(node.children);
        }
      }
    };
    visit(section.nodes);
    return map;
  }, [section.nodes]);

  const descendantIdsByNodeId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of nodeById.values()) {
      map.set(node.id, flattenDescendantNodeIds(node));
    }
    return map;
  }, [nodeById]);

  const expandedIds = useMemo(() => new Set(expandedItems), [expandedItems]);

  const toggleExpanded = useCallback(
    (nodeId: string) => {
      const node = nodeById.get(nodeId);
      const shouldResetEndpointDescendants = Boolean(node && isEndpointNode(node.contextValue));
      const childIdsToExpand = shouldResetEndpointDescendants
        ? (node?.children ?? []).map((child) => child.id)
        : [];
      onExpandedItemsChange(
        nextExpandedItemsForNodeToggle({
          childIdsToExpand,
          descendantIds: descendantIdsByNodeId.get(nodeId) ?? [],
          expandedItems,
          nodeId,
          resetDescendants: shouldResetEndpointDescendants
        })
      );
    },
    [descendantIdsByNodeId, expandedItems, nodeById, onExpandedItemsChange]
  );

  if (section.nodes.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.78rem", px: 1.5, py: 1 }}>
        No items found.
      </Typography>
    );
  }

  return (
    <Stack spacing="1px" sx={{ minHeight: 0 }}>
      {section.nodes.map((node) => (
        <SectionTreeNode
          key={node.id}
          node={node}
          sectionId={section.id}
          depth={0}
          expandedIds={expandedIds}
          onToggleExpanded={toggleExpanded}
          onInvokeAction={onInvokeAction}
        />
      ))}
    </Stack>
  );
}

export function SectionToolbarActions({ actions, onInvokeAction }: Readonly<SectionToolbarProps>) {
  return (
    <Stack direction="row" spacing={0.1} className="explorer-section-hover-actions">
      {actions.map((action) => {
        const IconComponent = actionIcon(action);
        return (
          <Tooltip key={action.id} title={action.label}>
            <IconButton
              size="small"
              aria-label={action.label}
              disabled={action.disabled}
              sx={TOOLBAR_ICON_BUTTON_SX}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (action.disabled === true) {
                  return;
                }
                onInvokeAction(action);
              }}
            >
              <IconComponent sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        );
      })}
    </Stack>
  );
}
