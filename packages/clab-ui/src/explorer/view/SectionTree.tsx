import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useMemo } from "react";
import type { ExplorerAction, ExplorerNode, ExplorerSectionId } from "../shared/explorer/types";
import { flattenDescendantNodeIds, nextExpandedItemsForNodeToggle } from "../explorerUiState";
import {
  COLOR_TEXT_PRIMARY,
  TOOLBAR_ICON_BUTTON_SX,
  TREE_DEPTH_INDENT,
  TREE_DISCLOSURE_SLOT_PX,
  TREE_ROW_GAP
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

  return (
    <Box>
      <Stack
        direction="row"
        spacing={TREE_ROW_GAP}
        sx={{
          alignItems: "center",
          minHeight: rowMinHeight,
          pl: depth * TREE_DEPTH_INDENT
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
              sx={{
                width: TREE_DISCLOSURE_SLOT_PX,
                height: TREE_DISCLOSURE_SLOT_PX,
                p: 0,
                color: COLOR_TEXT_PRIMARY
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleExpanded(node.id);
              }}
              aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
            >
              {isExpanded ? (
                <ExpandMoreIcon fontSize="inherit" />
              ) : (
                <ChevronRightIcon fontSize="inherit" />
              )}
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
          <ExplorerNodeLabel node={node} sectionId={sectionId} onInvokeAction={onInvokeAction} />
        </Box>
      </Stack>

      {hasChildren && isExpanded && (
        <Stack spacing={0.1}>
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
        </Stack>
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
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary"
        }}
      >
        No items found.
      </Typography>
    );
  }

  return (
    <Stack spacing={0.05} sx={{ minHeight: 0 }}>
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
              <IconComponent fontSize="small" />
            </IconButton>
          </Tooltip>
        );
      })}
    </Stack>
  );
}
