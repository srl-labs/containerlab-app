import CodeRoundedIcon from "@mui/icons-material/CodeRounded";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import NoteAddOutlinedIcon from "@mui/icons-material/NoteAddOutlined";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import type { SvgIconComponent } from "@mui/icons-material";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type MouseEvent, useMemo } from "react";
import { ContextMenu, type ContextMenuItem } from "../../components/context-menu/ContextMenu";
import type { ExplorerAction, ExplorerNode } from "../shared/explorer/types";
import { NODE_MARKER_SLOT_PX, ROW_RADIUS_PX, TREE_ROW_GAP_PX } from "./constants";
import type { ExplorerNodeLabelProps } from "./types";
import { indicatorThemeColor } from "./sectionModel";
import {
  type ExplorerEndpointQuickActionsState,
  deriveExplorerNodeDisplayFlags,
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

const SMALL_ICON_BUTTON_SX = {
  width: 22,
  height: 22,
  p: 0,
  borderRadius: `${ROW_RADIUS_PX - 1}px`,
  color: "text.secondary",
  "&:hover": { color: "text.primary", bgcolor: "action.selected" }
} as const;

function portStateOf(node: ExplorerNode): "up" | "down" | undefined {
  if (node.contextValue === "containerlabInterfaceUp") {
    return "up";
  }
  return node.contextValue === "containerlabInterfaceDown" ? "down" : undefined;
}

function statusWord(status: string): string {
  const word = status === "expired" ? "session expired" : status;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

interface StatusDotProps {
  indicator: ExplorerNode["statusIndicator"];
  size?: number;
}

/** A solid dot with a soft halo; the only way the tree signals state besides text. */
function StatusDot({ indicator, size = 7 }: Readonly<StatusDotProps>) {
  return (
    <Box
      aria-hidden="true"
      sx={(theme) => {
        const tone = indicatorThemeColor(theme, indicator);
        return {
          width: size,
          height: size,
          borderRadius: "50%",
          flex: "0 0 auto",
          bgcolor: tone,
          boxShadow: indicator && indicator !== "gray" ? `0 0 0 2.5px ${theme.alpha(tone, 0.18)}` : "none"
        };
      }}
    />
  );
}

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
  description: string | undefined;
  isLab: boolean;
  handlePrimaryAction: (event: MouseEvent<HTMLElement>) => void;
  handleShareAction: (event: MouseEvent<HTMLElement>) => void;
}

interface ExplorerNodeMarkerProps {
  leadingIcon: ReturnType<typeof nodeLeadingIcon>;
  showStatusDot: boolean;
  statusIndicator: ExplorerNode["statusIndicator"];
  portState: "up" | "down" | undefined;
}

/** Interfaces are hollow rings so they read as ports next to the solid dots of labs and nodes. */
function PortRing({ state }: Readonly<{ state: "up" | "down" }>) {
  return (
    <Box
      aria-hidden="true"
      sx={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        flex: "0 0 auto",
        border: "1.5px solid",
        borderColor: state === "up" ? "success.main" : "text.disabled"
      }}
    />
  );
}

function ExplorerNodeMarker({
  leadingIcon,
  showStatusDot,
  statusIndicator,
  portState
}: Readonly<ExplorerNodeMarkerProps>) {
  if (!leadingIcon && !showStatusDot && !portState) {
    return null;
  }
  return (
    <Box
      sx={{
        width: NODE_MARKER_SLOT_PX,
        flex: `0 0 ${NODE_MARKER_SLOT_PX}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      {leadingIcon && (
        <leadingIcon.Icon sx={{ fontSize: 16, color: leadingIcon.color, flex: "0 0 auto" }} />
      )}
      {!leadingIcon && portState && <PortRing state={portState} />}
      {!leadingIcon && !portState && showStatusDot && <StatusDot indicator={statusIndicator} />}
    </Box>
  );
}

const EMPHASIS_WEIGHT = { endpoint: 600, strong: 500, normal: 400, muted: 500 } as const;

interface ExplorerNodePrimaryLabelProps {
  label: string;
  emphasis: "endpoint" | "strong" | "normal" | "muted";
  isDisconnectedPlaceholder: boolean;
  color: string | undefined;
}

function ExplorerNodePrimaryLabel({
  label,
  emphasis,
  isDisconnectedPlaceholder,
  color
}: Readonly<ExplorerNodePrimaryLabelProps>) {
  return (
    <Typography
      className="explorer-node-label"
      variant="body2"
      noWrap
      sx={{
        flex: "0 1 auto",
        minWidth: "6ch",
        fontWeight: EMPHASIS_WEIGHT[emphasis],
        color,
        fontStyle: isDisconnectedPlaceholder ? "italic" : undefined
      }}
    >
      {label}
    </Typography>
  );
}

interface EndpointStatusProps {
  node: ExplorerNode;
  status: string;
}

/** Connected endpoints show just the dot; anything else names its problem in plain words. */
function EndpointStatus({ node, status }: Readonly<EndpointStatusProps>) {
  const connected = status === "connected";
  return (
    <Tooltip title={statusWord(status)} placement="bottom" enterDelay={300} disableInteractive>
      <Box
        component="span"
        sx={{ display: "inline-flex", alignItems: "center", gap: "6px", minWidth: 0, flexShrink: 1, ml: "8px" }}
      >
        <StatusDot indicator={node.statusIndicator} />
        {!connected && (
          <Typography
            variant="caption"
            noWrap
            sx={(theme) => ({
              color: indicatorThemeColor(theme, node.statusIndicator),
              fontWeight: 500,
              lineHeight: 1
            })}
          >
            {statusWord(status)}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
}

interface ExplorerNodeTrailingContentProps {
  node: ExplorerNode;
  showFavoriteIcon: boolean;
  showSharedIcon: boolean;
  handleShareAction: (event: MouseEvent<HTMLElement>) => void;
}

function ExplorerNodeTrailingContent({
  node,
  showFavoriteIcon,
  showSharedIcon,
  handleShareAction
}: Readonly<ExplorerNodeTrailingContentProps>) {
  return (
    <>
      {node.workspaceScope === "shared" && (
        <Tooltip title="Shared lab" placement="bottom" enterDelay={300} disableInteractive>
          <GroupsOutlinedIcon
            titleAccess="Shared lab"
            sx={{ fontSize: 15, color: "text.secondary", flexShrink: 0, ml: "6px" }}
          />
        </Tooltip>
      )}
      {showFavoriteIcon && (
        <StarRoundedIcon
          className="explorer-node-inline-icon explorer-node-inline-icon-favorite"
          aria-hidden="true"
          sx={{ fontSize: 14, flexShrink: 0, ml: "6px" }}
        />
      )}
      {showSharedIcon && (
        <IconButton
          size="small"
          className="explorer-node-inline-icon-button"
          onClick={handleShareAction}
          aria-label={node.shareAction?.label ?? "Open shared session"}
          sx={{ ...SMALL_ICON_BUTTON_SX, ml: "4px", flexShrink: 0 }}
        >
          <LinkRoundedIcon
            className="explorer-node-inline-icon explorer-node-inline-icon-shared"
            aria-hidden="true"
            sx={{ fontSize: 15 }}
          />
        </IconButton>
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
            ...SMALL_ICON_BUTTON_SX,
            opacity: 0,
            pointerEvents: "none",
            transition: "opacity 120ms ease"
          }}
        >
          <Icon sx={{ fontSize: 15 }} />
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
        icon={NoteAddOutlinedIcon}
        onInvokeAction={onInvokeAction}
      />
      <ExplorerEndpointActionButton
        action={actions.cloneRepoAction}
        ariaLabel="Clone repository"
        icon={CodeRoundedIcon}
        onInvokeAction={onInvokeAction}
      />
      <ExplorerEndpointActionButton
        action={actions.reconnectAction}
        ariaLabel="Reconnect"
        icon={RefreshRoundedIcon}
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
  description,
  isLab,
  handlePrimaryAction,
  handleShareAction
}: Readonly<ExplorerNodeTextBlockProps>) {
  const endpointStatus = endpointStatusText(node, isEndpointRoot);
  const deployed = isLab && Boolean(node.statusIndicator);
  let emphasis: ExplorerNodePrimaryLabelProps["emphasis"] = "normal";
  if (isEndpointRoot) {
    emphasis = "endpoint";
  } else if (deployed) {
    emphasis = "strong";
  } else if (isEndpointSection) {
    emphasis = "muted";
  }

  return (
    <Box
      onClick={handlePrimaryAction}
      sx={{ minWidth: 0, flex: 1, cursor: node.primaryAction ? "pointer" : "default" }}
    >
      <Tooltip
        title={hasEntryTooltip ? node.tooltip : ""}
        placement="bottom"
        enterDelay={500}
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
          sx={{ alignItems: "center", gap: `${TREE_ROW_GAP_PX}px`, minWidth: 0, width: "100%" }}
        >
          <ExplorerNodeMarker
            leadingIcon={leadingIcon}
            showStatusDot={showStatusDot}
            statusIndicator={node.statusIndicator}
            portState={portStateOf(node)}
          />
          <ExplorerNodePrimaryLabel
            label={node.label}
            emphasis={emphasis}
            isDisconnectedPlaceholder={isDisconnectedPlaceholder}
            color={explorerNodeLabelColor({
              isEndpointRoot,
              isEndpointSection,
              isDisconnectedPlaceholder
            })}
          />
          {endpointStatus && <EndpointStatus node={node} status={endpointStatus} />}
          <Typography
            variant="caption"
            noWrap
            sx={{
              flex: "1 1 0",
              minWidth: 0,
              flexShrink: 3,
              ml: "10px",
              textAlign: "right",
              color: "text.secondary",
              // Names matter more than details once the pane gets narrow.
              "@container (max-width: 250px)": { visibility: "hidden" }
            }}
          >
            {description}
          </Typography>
          <ExplorerNodeTrailingContent
            node={node}
            showFavoriteIcon={showFavoriteIcon}
            showSharedIcon={showSharedIcon}
            handleShareAction={handleShareAction}
          />
        </Stack>
      </Tooltip>
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
          ...SMALL_ICON_BUTTON_SX,
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
          transition: "opacity 120ms ease"
        }}
      >
        <MoreHorizRoundedIcon sx={{ fontSize: 17 }} />
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

export function ExplorerNodeLabel({
  node,
  sectionId,
  expanded = false,
  onInvokeAction
}: Readonly<ExplorerNodeLabelProps>) {
  const hasEntryTooltip = Boolean(node.tooltip);
  const leadingIcon = nodeLeadingIcon(node, sectionId, expanded);
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
  const { inlineContainerStatus, showStatusDot, showFavoriteIcon, showSharedIcon } =
    deriveExplorerNodeDisplayFlags(
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
  const description = inlineContainerStatus ?? (isEndpointSection ? undefined : secondaryText);

  return (
    <Stack
      direction="row"
      onContextMenu={handleRowContextMenu}
      data-explorer-node-row="true"
      data-menu-open={menuOpen ? "true" : undefined}
      sx={{ alignItems: "center", gap: "2px", width: "100%", minHeight: rowMinHeight }}
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
        description={description}
        isLab={nodeKind === "lab"}
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
