import LinkIcon from "@mui/icons-material/Link";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import RefreshIcon from "@mui/icons-material/Refresh";
import SourceIcon from "@mui/icons-material/Source";
import StarIcon from "@mui/icons-material/Star";
import type { SvgIconComponent } from "@mui/icons-material";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type MouseEvent, useMemo } from "react";
import { ContextMenu, type ContextMenuItem } from "../../components/context-menu/ContextMenu";
import type { ExplorerAction, ExplorerNode } from "../shared/explorer/types";
import { NODE_MARKER_SLOT_PX, TREE_ROW_GAP } from "./constants";
import type { ExplorerNodeLabelProps } from "./types";
import { indicatorThemeColor, statusColor } from "./sectionModel";
import {
  type ExplorerEndpointQuickActionsState,
  deriveExplorerNodeDisplayFlags,
  endpointDescriptionText,
  endpointRowHeight,
  endpointStatusText,
  explorerNodeLabelColor,
  isEndpointDisconnectedNode,
  isEndpointNode,
  isEndpointSectionNode,
  nodeKindFromContext,
  resolveEndpointQuickActions
} from "./nodeState";
import { nodeLeadingIcon } from "./nodeIcons";
import { buildNodeContextMenuItems, filterNodeMenuActions } from "./menuItems";
import {
  useExplorerNodeMenu,
  usePrimaryActionHandler,
  useShareActionHandler
} from "./useNodeInteractions";

interface ExplorerNodeTextBlockProps {
  node: ExplorerNode;
  hasEntryTooltip: boolean;
  isEndpointRoot: boolean;
  isEndpointSection: boolean;
  isDisconnectedPlaceholder: boolean;
  leadingIcon: ReturnType<typeof nodeLeadingIcon>;
  showStatusDot: boolean;
  showFavoriteIcon: boolean;
  showSharedIcon: boolean;
  inlineContainerStatus: string | undefined;
  showSecondaryLine: boolean;
  secondaryText: string | undefined;
  handlePrimaryAction: (event: MouseEvent<HTMLElement>) => void;
  handleShareAction: (event: MouseEvent<HTMLElement>) => void;
}

interface ExplorerNodeMarkerProps {
  leadingIcon: ReturnType<typeof nodeLeadingIcon>;
  isEndpointRoot: boolean;
  showStatusDot: boolean;
  statusIndicator: ExplorerNode["statusIndicator"];
}

function ExplorerNodeMarker({
  leadingIcon,
  isEndpointRoot,
  showStatusDot,
  statusIndicator
}: Readonly<ExplorerNodeMarkerProps>) {
  const markerSlotPx =
    leadingIcon && isEndpointRoot ? NODE_MARKER_SLOT_PX + 3 : NODE_MARKER_SLOT_PX;

  return (
    <Box
      sx={{
        width: markerSlotPx,
        flex: `0 0 ${markerSlotPx}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      {leadingIcon ? (
        <leadingIcon.Icon
          fontSize="inherit"
          sx={{
            fontSize: isEndpointRoot ? 14 : 13,
            color: leadingIcon.color,
            flex: "0 0 auto"
          }}
        />
      ) : (
        showStatusDot && (
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flex: "0 0 auto",
              bgcolor: statusColor(statusIndicator)
            }}
          />
        )
      )}
    </Box>
  );
}

interface ExplorerNodePrimaryLabelProps {
  label: string;
  isEndpointRoot: boolean;
  isEndpointSection: boolean;
  isDisconnectedPlaceholder: boolean;
}

function ExplorerNodePrimaryLabel({
  label,
  isEndpointRoot,
  isEndpointSection,
  isDisconnectedPlaceholder
}: Readonly<ExplorerNodePrimaryLabelProps>) {
  return (
    <Typography
      className="explorer-node-label"
      variant="body2"
      noWrap
      sx={{
        flex: 1,
        minWidth: 0,
        fontWeight: isEndpointRoot || isEndpointSection ? 600 : undefined,
        fontSize: isEndpointSection ? "0.72rem" : undefined,
        letterSpacing: isEndpointSection ? "0.04em" : undefined,
        color: explorerNodeLabelColor({
          isEndpointRoot,
          isEndpointSection,
          isDisconnectedPlaceholder
        }),
        fontStyle: isDisconnectedPlaceholder ? "italic" : undefined
      }}
    >
      {label}
    </Typography>
  );
}

interface ExplorerNodeTrailingContentProps {
  node: ExplorerNode;
  showFavoriteIcon: boolean;
  showSharedIcon: boolean;
  inlineContainerStatus: string | undefined;
  endpointStatus: string | null;
  endpointDescription: string | null;
  handleShareAction: (event: MouseEvent<HTMLElement>) => void;
}

function ExplorerNodeTrailingContent({
  node,
  showFavoriteIcon,
  showSharedIcon,
  inlineContainerStatus,
  endpointStatus,
  endpointDescription,
  handleShareAction
}: Readonly<ExplorerNodeTrailingContentProps>) {
  return (
    <>
      {showFavoriteIcon && (
        <StarIcon
          fontSize="inherit"
          className="explorer-node-inline-icon explorer-node-inline-icon-favorite"
          aria-hidden="true"
          sx={{ flexShrink: 0 }}
        />
      )}
      {showSharedIcon && (
        <IconButton
          size="small"
          className="explorer-node-inline-icon-button"
          onClick={handleShareAction}
          aria-label={node.shareAction?.label ?? "Open shared session"}
          sx={{ flexShrink: 0 }}
        >
          <LinkIcon
            className="explorer-node-inline-icon explorer-node-inline-icon-shared"
            aria-hidden="true"
            sx={{
              fontSize: "inherit"
            }}
          />
        </IconButton>
      )}
      {inlineContainerStatus && (
        <Typography
          variant="caption"
          noWrap
          sx={{
            color: "text.secondary",
            flexShrink: 0
          }}
        >
          {inlineContainerStatus}
        </Typography>
      )}
      {endpointStatus && (
        <Box
          sx={(theme) => {
            const tone = indicatorThemeColor(theme, node.statusIndicator);
            return {
              display: "inline-flex",
              alignItems: "center",
              px: "6px",
              borderRadius: 8,
              color: tone,
              bgcolor: theme.alpha(tone, 0.15),
              height: 16,
              flexShrink: 0,
              ml: "6px"
            };
          }}
        >
          <Typography
            variant="caption"
            sx={{
              fontWeight: 500,
              lineHeight: "16px",
              color: "inherit",
              letterSpacing: "0.03em",
              fontSize: "0.65rem",
              textTransform: "uppercase"
            }}
          >
            {endpointStatus}
          </Typography>
        </Box>
      )}
      {endpointDescription && (
        <Typography
          variant="caption"
          noWrap
          sx={{
            color: "text.secondary",
            ml: "8px",
            maxWidth: 120,
            fontSize: "0.75rem",
            flexShrink: 0
          }}
        >
          {endpointDescription}
        </Typography>
      )}
    </>
  );
}

interface ExplorerEndpointActionButtonProps {
  action: ExplorerAction | undefined;
  ariaLabel: string;
  icon: SvgIconComponent;
  onInvokeAction: (action: ExplorerAction) => void;
}

function ExplorerEndpointActionButton({
  action,
  ariaLabel,
  icon: Icon,
  onInvokeAction
}: Readonly<ExplorerEndpointActionButtonProps>) {
  if (!action) {
    return null;
  }

  return (
    <Tooltip title={action.label || ariaLabel} placement="bottom" enterDelay={300}>
      <Box component="span" sx={{ display: "inline-flex" }}>
        <IconButton
          size="small"
          className="explorer-node-actions-trigger"
          disabled={action.disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (action.disabled === true) {
              return;
            }
            onInvokeAction(action);
          }}
          aria-label={ariaLabel}
          sx={{
            width: 20,
            height: 20,
            p: 0.25,
            color: "text.secondary",
            opacity: 0,
            pointerEvents: "none",
            transition: "opacity 120ms ease"
          }}
        >
          <Icon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>
    </Tooltip>
  );
}

interface ExplorerEndpointQuickActionsProps {
  actions: ExplorerEndpointQuickActionsState;
  onInvokeAction: (action: ExplorerAction) => void;
}

function ExplorerEndpointQuickActions({
  actions,
  onInvokeAction
}: Readonly<ExplorerEndpointQuickActionsProps>) {
  return (
    <>
      <ExplorerEndpointActionButton
        action={actions.newTopologyAction}
        ariaLabel="New topology file"
        icon={NoteAddIcon}
        onInvokeAction={onInvokeAction}
      />
      <ExplorerEndpointActionButton
        action={actions.cloneRepoAction}
        ariaLabel="Clone repository"
        icon={SourceIcon}
        onInvokeAction={onInvokeAction}
      />
      <ExplorerEndpointActionButton
        action={actions.reconnectAction}
        ariaLabel="Reconnect"
        icon={RefreshIcon}
        onInvokeAction={onInvokeAction}
      />
    </>
  );
}

function ExplorerNodeTextBlock({
  node,
  hasEntryTooltip,
  isEndpointRoot,
  isEndpointSection,
  isDisconnectedPlaceholder,
  leadingIcon,
  showStatusDot,
  showFavoriteIcon,
  showSharedIcon,
  inlineContainerStatus,
  showSecondaryLine,
  secondaryText,
  handlePrimaryAction,
  handleShareAction
}: Readonly<ExplorerNodeTextBlockProps>) {
  const endpointStatus = endpointStatusText(node, isEndpointRoot);
  const endpointDescription = endpointDescriptionText(secondaryText, isEndpointRoot);

  return (
    <Box
      onClick={handlePrimaryAction}
      sx={{ minWidth: 0, flex: 1, cursor: node.primaryAction ? "pointer" : "default" }}
    >
      <Tooltip
        title={hasEntryTooltip ? node.tooltip : ""}
        placement="bottom"
        enterDelay={300}
        disableInteractive
        disableHoverListener={!hasEntryTooltip}
        disableFocusListener={!hasEntryTooltip}
        disableTouchListener={!hasEntryTooltip}
        slotProps={{
          tooltip: {
            sx: {
              maxWidth: "min(360px, calc(100vw - 24px))",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }
          }
        }}
      >
        <Stack
          direction="row"
          spacing={isEndpointRoot ? 0.45 : TREE_ROW_GAP}
          sx={{
            alignItems: "center",
            minWidth: 0,
            width: "100%"
          }}
        >
          <ExplorerNodeMarker
            leadingIcon={leadingIcon}
            isEndpointRoot={isEndpointRoot}
            showStatusDot={showStatusDot}
            statusIndicator={node.statusIndicator}
          />
          <ExplorerNodePrimaryLabel
            label={node.label}
            isEndpointRoot={isEndpointRoot}
            isEndpointSection={isEndpointSection}
            isDisconnectedPlaceholder={isDisconnectedPlaceholder}
          />
          <ExplorerNodeTrailingContent
            node={node}
            showFavoriteIcon={showFavoriteIcon}
            showSharedIcon={showSharedIcon}
            inlineContainerStatus={inlineContainerStatus}
            endpointStatus={endpointStatus}
            endpointDescription={endpointDescription}
            handleShareAction={handleShareAction}
          />
          {node.workspaceScope === "shared" && (
            <Box
              component="span"
              aria-label="Shared lab"
              sx={{
                flexShrink: 0,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 0.75,
                px: 0.55,
                fontSize: 10,
                lineHeight: "17px",
                color: "text.secondary"
              }}
            >
              Shared
            </Box>
          )}
        </Stack>
      </Tooltip>
      {showSecondaryLine && (
        <Typography
          variant="caption"
          noWrap
          sx={{
            color: "text.secondary"
          }}
        >
          {secondaryText}
        </Typography>
      )}
    </Box>
  );
}

interface ExplorerNodeActionsProps {
  hasActions: boolean;
  node: ExplorerNode;
  menuOpen: boolean;
  menuPosition: { x: number; y: number } | null;
  contextMenuItems: ContextMenuItem[];
  menuOpenToLeft: boolean;
  handleMenuOpen: (event: MouseEvent<HTMLElement>) => void;
  handleMenuClose: () => void;
  handleBackdropContextMenu: (event: MouseEvent) => void;
}

function ExplorerNodeActions({
  hasActions,
  node,
  menuOpen,
  menuPosition,
  contextMenuItems,
  menuOpenToLeft,
  handleMenuOpen,
  handleMenuClose,
  handleBackdropContextMenu
}: Readonly<ExplorerNodeActionsProps>) {
  if (!hasActions) {
    return null;
  }

  return (
    <>
      <IconButton
        size="small"
        className="explorer-node-actions-trigger"
        onClick={handleMenuOpen}
        aria-label={`Actions for ${node.label}`}
        data-node-actions-trigger="true"
        sx={{
          width: 20,
          height: 20,
          p: 0.25,
          color: "text.secondary",
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
          transition: "opacity 120ms ease"
        }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <ContextMenu
        isVisible={menuOpen}
        position={menuPosition ?? { x: 0, y: 0 }}
        items={contextMenuItems}
        compact
        openToLeft={menuOpenToLeft}
        onClose={handleMenuClose}
        onBackdropContextMenu={handleBackdropContextMenu}
      />
    </>
  );
}

export function ExplorerNodeLabel({ node, sectionId, onInvokeAction }: Readonly<ExplorerNodeLabelProps>) {
  const hasEntryTooltip = Boolean(node.tooltip);
  const leadingIcon = nodeLeadingIcon(node, sectionId);
  const nodeKind = nodeKindFromContext(node.contextValue);
  const isEndpointRoot = isEndpointNode(node.contextValue);
  const isEndpointSection = isEndpointSectionNode(node.contextValue);
  const isDisconnectedPlaceholder = isEndpointDisconnectedNode(node.contextValue);
  const menuActions = useMemo(
    () => filterNodeMenuActions(node.actions, nodeKind),
    [node.actions, nodeKind]
  );
  const hasActions = menuActions.length > 0 && !isDisconnectedPlaceholder;
  const contextMenuItems = useMemo<ContextMenuItem[]>(
    () => buildNodeContextMenuItems(menuActions, nodeKind, node.contextValue, onInvokeAction),
    [menuActions, node.contextValue, nodeKind, onInvokeAction]
  );
  const secondaryText = node.description || node.statusDescription;
  const {
    inlineContainerStatus,
    showSecondaryLine,
    showStatusDot,
    showFavoriteIcon,
    showSharedIcon
  } = deriveExplorerNodeDisplayFlags(
    node,
    secondaryText,
    isEndpointRoot,
    isEndpointSection,
    isDisconnectedPlaceholder
  );
  const {
    menuPosition,
    menuOpenToLeft,
    menuOpen,
    handleMenuOpen,
    handleRowContextMenu,
    handleMenuClose,
    handleBackdropContextMenu
  } = useExplorerNodeMenu({
    hasActions,
    hasContextMenuItems: contextMenuItems.length > 0
  });
  const handlePrimaryAction = usePrimaryActionHandler(node.primaryAction, onInvokeAction);
  const handleShareAction = useShareActionHandler(node.shareAction, onInvokeAction);
  const isEndpointConnected = String(node.state ?? "").toLowerCase() === "connected";
  const endpointActions = useMemo(
    () => resolveEndpointQuickActions(node.actions, isEndpointRoot, isEndpointConnected),
    [isEndpointConnected, isEndpointRoot, node.actions]
  );
  const rowMinHeight = endpointRowHeight(isEndpointRoot, isEndpointSection);

  return (
    <Stack
      direction="row"
      spacing={0.55}
      onContextMenu={handleRowContextMenu}
      data-explorer-node-row="true"
      sx={{
        alignItems: "center",
        width: "100%",
        minHeight: rowMinHeight,
        borderRadius: 0.75,
        px: isEndpointRoot ? 0.35 : 0.15,

        "&:hover": {
          bgcolor: "action.hover"
        },

        ...(menuOpen && {
          bgcolor: "action.selected"
        }),

        "&:hover .explorer-node-actions-trigger, &:focus-within .explorer-node-actions-trigger": {
          opacity: 1,
          pointerEvents: "auto"
        }
      }}
    >
      <ExplorerNodeTextBlock
        node={node}
        hasEntryTooltip={hasEntryTooltip}
        isEndpointRoot={isEndpointRoot}
        isEndpointSection={isEndpointSection}
        isDisconnectedPlaceholder={isDisconnectedPlaceholder}
        leadingIcon={leadingIcon}
        showStatusDot={showStatusDot}
        showFavoriteIcon={showFavoriteIcon}
        showSharedIcon={showSharedIcon}
        inlineContainerStatus={inlineContainerStatus}
        showSecondaryLine={showSecondaryLine}
        secondaryText={secondaryText}
        handlePrimaryAction={handlePrimaryAction}
        handleShareAction={handleShareAction}
      />
      <ExplorerEndpointQuickActions actions={endpointActions} onInvokeAction={onInvokeAction} />
      <ExplorerNodeActions
        hasActions={hasActions}
        node={node}
        menuOpen={menuOpen}
        menuPosition={menuPosition}
        contextMenuItems={contextMenuItems}
        menuOpenToLeft={menuOpenToLeft}
        handleMenuOpen={handleMenuOpen}
        handleMenuClose={handleMenuClose}
        handleBackdropContextMenu={handleBackdropContextMenu}
      />
    </Stack>
  );
}
