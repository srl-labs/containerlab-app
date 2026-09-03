import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import BuildIcon from "@mui/icons-material/Build";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CodeIcon from "@mui/icons-material/Code";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CssIcon from "@mui/icons-material/Css";
import DataObjectOutlinedIcon from "@mui/icons-material/DataObjectOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import HtmlIcon from "@mui/icons-material/Html";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import JavascriptIcon from "@mui/icons-material/Javascript";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import SearchIcon from "@mui/icons-material/Search";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import SourceIcon from "@mui/icons-material/Source";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import StopIcon from "@mui/icons-material/Stop";
import TerminalIcon from "@mui/icons-material/Terminal";
import TuneIcon from "@mui/icons-material/Tune";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import type { SvgIconComponent } from "@mui/icons-material";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import {
  type Dispatch,
  type DragEvent,
  type MouseEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { useClabUiHost } from "../host";
import {
  ContextMenu,
  type ContextMenuItem
} from "../components/context-menu/ContextMenu";
import { useMessageListener, useReadySignal } from "./shared/hooks";
import {
  EXPLORER_SECTION_IDS,
  EXPLORER_SECTION_ORDER,
  type ExplorerAction,
  type ExplorerIncomingMessage,
  type ExplorerNode,
  type ExplorerSectionId,
  type ExplorerSectionSnapshot,
  type ExplorerUiState
} from "./shared/explorer/types";
import {
  buildExplorerUiState,
  flattenDescendantNodeIds,
  flattenExpandableNodeIds,
  flattenNodeIds,
  nextExpandedBySectionForSnapshot,
  nextExpandedItemsForNodeToggle,
  shouldPersistExpandedSectionImmediately,
  withExpandedSectionItems
} from "./explorerUiState";

const COLOR_ERROR_MAIN = "error.main";
const COLOR_TEXT_PRIMARY = "text.primary";
const COLOR_TEXT_SECONDARY = "text.secondary";
const COLOR_TEXT_DISABLED = "text.disabled";
const FILTER_UPDATE_DEBOUNCE_MS = 250;
const UI_STATE_UPDATE_DEBOUNCE_MS = 160;
const DEFAULT_EXPANDED_SECTIONS = new Set<ExplorerSectionId>([
  "runningLabs",
  "localLabs",
  "fileExplorer",
  "helpFeedback"
]);
const TREE_DEPTH_INDENT = 1.25;
const TREE_DISCLOSURE_SLOT_PX = 16;
const TREE_ROW_GAP = 0.2;
const NODE_MARKER_SLOT_PX = 13;
const SECTION_HEADER_HEIGHT_PX = 24;
const TREE_ROW_HEIGHT_PX = 22;
const TREE_SECTION_ROW_HEIGHT_PX = 22;
const TREE_ENDPOINT_ROW_HEIGHT_PX = 24;
const RESIZE_DIVIDER_HEIGHT_PX = 4;
const MIN_SECTION_BODY_HEIGHT_PX = 40;
const FIXED_HEIGHT_SECTIONS: ReadonlySet<ExplorerSectionId> = new Set(["helpFeedback"]);

const STATUS_COLOR_MAP: Record<string, string> = {
  green: "success.main",
  red: COLOR_ERROR_MAIN,
  yellow: "warning.main",
  blue: "info.main",
  gray: COLOR_TEXT_DISABLED
};

const TOOLBAR_ICON_BUTTON_SX = {
  width: 24,
  height: 24,
  borderRadius: 1,
  color: COLOR_TEXT_PRIMARY,
  "&:hover": {
    bgcolor: (theme: Theme) => theme.alpha(theme.palette.primary.main, 0.14)
  }
} as const;

interface ExplorerNodeLabelProps {
  node: ExplorerNode;
  sectionId: ExplorerSectionId;
  onInvokeAction: (action: ExplorerAction) => void;
}

type ActionGroupId =
  | "topology"
  | "graph"
  | "lifecycle"
  | "save"
  | "access"
  | "sharing"
  | "network"
  | "inspect"
  | "copy"
  | "tools"
  | "view"
  | "danger"
  | "other";

type ExplorerNodeKind = "lab" | "container" | "interface" | "link" | "file" | "other";

interface ExplorerActionGroup {
  id: ActionGroupId;
  label: string;
  actions: ExplorerAction[];
}

type CommandMatcher = (command: string) => boolean;

interface CommandIconRule {
  match: CommandMatcher;
  icon: SvgIconComponent;
}

interface CommandActionGroupRule {
  match: CommandMatcher;
  group: ActionGroupId;
}

type SharingBucket = "sshx" | "gotty" | "other";

const ACTION_GROUP_ORDER_DEFAULT: ActionGroupId[] = [
  "topology",
  "graph",
  "lifecycle",
  "save",
  "access",
  "sharing",
  "network",
  "inspect",
  "copy",
  "tools",
  "view",
  "other",
  "danger"
];

const ACTION_GROUP_ORDER_BY_NODE_KIND: Record<ExplorerNodeKind, ActionGroupId[]> = {
  lab: [
    "lifecycle",
    "save",
    "topology",
    "graph",
    "access",
    "sharing",
    "inspect",
    "tools",
    "copy",
    "view",
    "network",
    "other",
    "danger"
  ],
  container: [
    "lifecycle",
    "save",
    "access",
    "inspect",
    "network",
    "copy",
    "sharing",
    "tools",
    "view",
    "topology",
    "graph",
    "other"
  ],
  interface: ACTION_GROUP_ORDER_DEFAULT,
  link: ["sharing", "copy", "view", "topology", "graph", "lifecycle", "save", "network", "inspect", "tools", "other", "access"],
  file: ["topology", "view", "copy", "tools", "other", "danger"],
  other: ACTION_GROUP_ORDER_DEFAULT
};

const ACTION_ICON_BY_COMMAND: Record<string, SvgIconComponent> = {
  "containerlab.endpoint.add": AddIcon,
  "containerlab.inspectall": ManageSearchIcon,
  "containerlab.treeview.runninglabs.hidenonownedlabs": VisibilityOffIcon,
  "containerlab.treeview.runninglabs.shownonownedlabs": VisibilityIcon,
  "containerlab.images.manage": Inventory2OutlinedIcon,
  "containerlab.editor.topoviewereditor": NoteAddIcon,
  "containerlab.lab.clonerepo": SourceIcon,
  "containerlab.lab.togglefavorite": StarBorderIcon,
  "containerlab.lab.addtoworkspace": FolderOpenIcon,
  "containerlab.lab.save": SaveOutlinedIcon,
  "containerlab.lab.start": PlayArrowIcon,
  "containerlab.lab.stop": StopIcon,
  "containerlab.lab.restart": RefreshIcon,
  "containerlab.node.start": PlayArrowIcon,
  "containerlab.node.save": SaveOutlinedIcon,
  "containerlab.node.showlogs": ArticleOutlinedIcon,
  "containerlab.node.stop": StopIcon,
  "containerlab.node.restart": RefreshIcon,
  "containerlab.node.pause": PauseCircleOutlineIcon,
  "containerlab.node.unpause": PlayCircleOutlineIcon,
  "containerlab.interface.setdelay": TuneIcon,
  "containerlab.interface.setjitter": TuneIcon,
  "containerlab.interface.setloss": TuneIcon,
  "containerlab.interface.setrate": TuneIcon,
  "containerlab.interface.setcorruption": TuneIcon,
  "containerlab.lab.sshx.attach": LinkIcon,
  "containerlab.lab.sshx.detach": LinkOffIcon,
  "containerlab.lab.sshx.reattach": LinkIcon,
  "containerlab.lab.sshx.copylink": LinkIcon,
  "containerlab.lab.gotty.attach": OpenInBrowserIcon,
  "containerlab.lab.gotty.detach": OpenInBrowserIcon,
  "containerlab.lab.gotty.reattach": OpenInBrowserIcon,
  "containerlab.lab.gotty.copylink": OpenInBrowserIcon,
  "containerlab.file.open": ArticleOutlinedIcon,
  "containerlab.file.opentopology": AccountTreeIcon,
  "containerlab.file.newfile": NoteAddIcon,
  "containerlab.file.newfolder": FolderOpenIcon,
  "containerlab.file.download": DownloadOutlinedIcon,
  "containerlab.file.downloadarchive": DownloadOutlinedIcon,
  "containerlab.file.upload": FileUploadOutlinedIcon,
  "containerlab.lab.downloadarchive": DownloadOutlinedIcon,
  "containerlab.install.edgeshark": SettingsEthernetIcon,
  "containerlab.uninstall.edgeshark": DeleteOutlineIcon,
  "containerlab.capture.killallwiresharkvnc": StopIcon,
  "containerlab.set.sessionhostname": SettingsEthernetIcon,
  "containerlab.endpoint.reconnect": RefreshIcon,
  "containerlab.endpoint.remove": DeleteOutlineIcon,
  "containerlab.endpoint.copyurl": ContentCopyIcon
};

const ACTION_ICON_RULES: ReadonlyArray<CommandIconRule> = [
  { match: (command) => command.includes("upload"), icon: FileUploadOutlinedIcon },
  { match: (command) => command.includes("download"), icon: DownloadOutlinedIcon },
  { match: (command) => command.includes("copy"), icon: ContentCopyIcon },
  {
    match: (command) =>
      command.includes("destroy") || command.includes("delete") || command.includes("detach"),
    icon: DeleteOutlineIcon
  },
  {
    match: (command) => command.includes("redeploy"),
    icon: RefreshIcon
  },
  {
    match: (command) => command.includes("restart"),
    icon: RefreshIcon
  },
  { match: (command) => command.includes("stop"), icon: StopIcon },
  { match: (command) => command.includes("unpause"), icon: PlayCircleOutlineIcon },
  { match: (command) => command.includes("pause"), icon: PauseCircleOutlineIcon },
  {
    match: (command) =>
      command.includes("ssh") || command.includes("shell") || command.includes("telnet"),
    icon: TerminalIcon
  },
  { match: (command) => command.includes("filter"), icon: FilterAltIcon },
  { match: (command) => command.includes(".save"), icon: SaveOutlinedIcon },
  {
    match: (command) => command.includes("showlogs") || command.includes("logs"),
    icon: ArticleOutlinedIcon
  },
  { match: (command) => command.startsWith("containerlab.lab.fcli."), icon: BuildIcon },
  { match: (command) => command.includes(".gotty."), icon: OpenInBrowserIcon },
  { match: (command) => command.startsWith("containerlab.lab.graph."), icon: AccountTreeIcon },
  {
    match: (command) =>
      command.includes("open") || command.includes("graph") || command.includes("inspect"),
    icon: OpenInNewIcon
  },
  { match: (command) => command.includes("folder"), icon: FolderOpenIcon },
  {
    match: (command) => command.includes("capture") || command.includes("impairment"),
    icon: SettingsEthernetIcon
  },
  {
    match: (command) =>
      command.includes("delay") ||
      command.includes("jitter") ||
      command.includes("loss") ||
      command.includes("rate") ||
      command.includes("corruption"),
    icon: TuneIcon
  },
  {
    match: (command) =>
      command.includes("deploy") || command.includes("start") || command.includes("run"),
    icon: PlayArrowIcon
  },
  { match: (command) => command.includes("link"), icon: LinkIcon }
];

const ACTION_GROUP_RULES: ReadonlyArray<CommandActionGroupRule> = [
  { match: (command) => command.startsWith("containerlab.lab.graph."), group: "graph" },
  { match: (command) => command.includes(".save"), group: "save" },
  { match: (command) => command.startsWith("containerlab.lab.fcli."), group: "tools" },
  {
    match: (command) => command.startsWith("containerlab.interface.") || command.includes("impairment"),
    group: "network"
  },
  { match: (command) => command.includes(".sshx.") || command.includes(".gotty."), group: "sharing" },
  { match: (command) => command.includes("copy"), group: "copy" },
  { match: (command) => command.includes("inspect") || command.includes("showlogs"), group: "inspect" },
  {
    match: (command) =>
      command.includes("ssh") ||
      command.includes("shell") ||
      command.includes("telnet") ||
      command.includes("openbrowser"),
    group: "access"
  },
  {
    match: (command) =>
      command.includes("deploy") ||
      command.includes("destroy") ||
      command.includes("redeploy") ||
      command.includes("restart") ||
      command.includes("start") ||
      command.includes("stop") ||
      command.includes("pause") ||
      command.includes("unpause"),
    group: "lifecycle"
  },
  {
    match: (command) =>
      command.includes("openfile") ||
      command.includes("topoviewer") ||
      command.includes("openfolder") ||
      command.includes("addtoworkspace") ||
      command.includes("togglefavorite") ||
      command.includes("clonerepo"),
    group: "topology"
  },
  {
    match: (command) => command.includes("delete"),
    group: "danger"
  },
  {
    match: (command) => command.startsWith("containerlab.file."),
    group: "topology"
  },
  {
    match: (command) =>
      command.includes("filter") ||
      command.includes("hide") ||
      command.includes("show"),
    group: "view"
  }
];

const ACTION_GROUP_SECTION_DEFAULT_BY_NODE_KIND: Record<ExplorerNodeKind, number> = {
  lab: 4,
  container: 3,
  interface: 1,
  link: 2,
  file: 1,
  other: 1
};

const ACTION_GROUP_SECTION_BY_NODE_KIND: Partial<
  Record<ExplorerNodeKind, Partial<Record<ActionGroupId, number>>>
> = {
  lab: {
    lifecycle: 1,
    save: 1,
    topology: 2,
    graph: 2,
    access: 3,
    sharing: 3,
    inspect: 3,
    tools: 3,
    danger: 5
  },
  container: {
    lifecycle: 1,
    save: 1,
    access: 2,
    inspect: 2,
    network: 2
  },
  link: {
    sharing: 1,
    copy: 1
  },
  file: {
    topology: 1,
    view: 1,
    copy: 2,
    danger: 3
  }
};

interface SectionTreeProps {
  section: ExplorerSectionSnapshot;
  expandedItems: string[];
  onExpandedItemsChange: (itemIds: string[]) => void;
  onInvokeAction: (action: ExplorerAction) => void;
}

interface SectionToolbarProps {
  actions: ExplorerAction[];
  onInvokeAction: (action: ExplorerAction) => void;
}

interface ExplorerSectionCardProps {
  section: ExplorerSectionSnapshot;
  expandedItems: string[];
  isCollapsed: boolean;
  isDropTarget: boolean;
  isBeingDragged: boolean;
  flexStyle: string;
  onSetSectionRef: (sectionId: ExplorerSectionId, element: HTMLDivElement | null) => void;
  onSectionDragStart: (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => void;
  onSectionDragOver: (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => void;
  onSectionDrop: (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => void;
  onSectionDragEnd: () => void;
  onToggleSectionCollapsed: (sectionId: ExplorerSectionId) => void;
  onInvokeAction: (action: ExplorerAction) => void;
  onExpandedItemsChange: (sectionId: ExplorerSectionId, itemIds: string[]) => void;
  onExpandAllInSection: (sectionId: ExplorerSectionId, nodes: ExplorerNode[]) => void;
  onCollapseAllInSection: (sectionId: ExplorerSectionId) => void;
}

type SnapshotExplorerMessage = Extract<ExplorerIncomingMessage, { command: "snapshot" }>;
type FilterStateExplorerMessage = Extract<ExplorerIncomingMessage, { command: "filterState" }>;
type UiStateExplorerMessage = Extract<ExplorerIncomingMessage, { command: "uiState" }>;
type ErrorExplorerMessage = Extract<ExplorerIncomingMessage, { command: "error" }>;

function statusColor(indicator: string | undefined): string {
  if (!indicator) {
    return COLOR_TEXT_DISABLED;
  }
  return STATUS_COLOR_MAP[indicator] || COLOR_TEXT_DISABLED;
}

function indicatorThemeColor(theme: Theme, indicator: ExplorerNode["statusIndicator"]): string {
  switch (indicator) {
    case "green":
      return theme.palette.success.main;
    case "red":
      return theme.palette.error.main;
    case "yellow":
      return theme.palette.warning.main;
    case "blue":
      return theme.palette.info.main;
    default:
      return theme.palette.text.disabled;
  }
}

function formatSectionTitle(section: ExplorerSectionSnapshot): string {
  return section.label;
}

function showSectionCount(section: ExplorerSectionSnapshot): boolean {
  return section.id !== "helpFeedback";
}

function isBareTreeSection(section: ExplorerSectionSnapshot): boolean {
  return section.appearance === "bareTree";
}

function sectionHeaderHeight(section: ExplorerSectionSnapshot): number {
  return isBareTreeSection(section) ? 0 : SECTION_HEADER_HEIGHT_PX;
}

function mergeSectionOrder(
  currentOrder: ExplorerSectionId[],
  sections: ExplorerSectionSnapshot[]
): ExplorerSectionId[] {
  const visibleIds = sections.map((section) => section.id);
  const visibleSet = new Set(visibleIds);

  const nextOrder = currentOrder.filter((id) => visibleSet.has(id));
  for (let index = 0; index < visibleIds.length; index += 1) {
    const sectionId = visibleIds[index];
    if (!nextOrder.includes(sectionId)) {
      const previousVisibleId = visibleIds
        .slice(0, index)
        .reverse()
        .find((id) => nextOrder.includes(id));
      const insertIndex = previousVisibleId ? nextOrder.indexOf(previousVisibleId) + 1 : 0;
      nextOrder.splice(insertIndex, 0, sectionId);
    }
  }

  return nextOrder;
}

function reorderSections(
  currentOrder: ExplorerSectionId[],
  sourceId: ExplorerSectionId,
  targetId: ExplorerSectionId
): ExplorerSectionId[] {
  if (sourceId === targetId) {
    return currentOrder;
  }

  const nextOrder = currentOrder.filter((sectionId) => sectionId !== sourceId);
  const targetIndex = nextOrder.indexOf(targetId);
  if (targetIndex < 0) {
    return currentOrder;
  }

  nextOrder.splice(targetIndex, 0, sourceId);
  return nextOrder;
}

function isExplorerSectionId(value: string): value is ExplorerSectionId {
  return EXPLORER_SECTION_IDS.includes(value as ExplorerSectionId);
}

function nodeKindFromContext(contextValue: string | undefined): ExplorerNodeKind {
  if (!contextValue) {
    return "other";
  }
  if (contextValue.includes("containerlabLab")) {
    return "lab";
  }
  if (contextValue === "containerlabContainer" || contextValue === "containerlabContainerGroup") {
    return "container";
  }
  if (contextValue === "containerlabInterfaceUp" || contextValue === "containerlabInterfaceDown") {
    return "interface";
  }
  if (contextValue === "containerlabSSHXLink" || contextValue === "containerlabGottyLink") {
    return "link";
  }
  if (
    contextValue === "containerlabFileExplorerRoot" ||
    contextValue === "containerlabFileFolder" ||
    contextValue === "containerlabFile" ||
    contextValue === "containerlabFileTopology"
  ) {
    return "file";
  }
  return "other";
}

function isEndpointNode(contextValue: string | undefined): boolean {
  return contextValue === "containerlabEndpoint";
}

function isEndpointSectionNode(contextValue: string | undefined): boolean {
  return (
    contextValue === "containerlabEndpointSectionRunning" ||
    contextValue === "containerlabEndpointSectionLocal"
  );
}

function isEndpointDisconnectedNode(contextValue: string | undefined): boolean {
  return contextValue === "containerlabEndpointDisconnected";
}

function isFileExplorerFolderNode(contextValue: string | undefined): boolean {
  return contextValue === "containerlabFileExplorerRoot" || contextValue === "containerlabFileFolder";
}

function endpointStatusLabel(
  state: ExplorerNode["state"],
  indicator: ExplorerNode["statusIndicator"]
): string {
  switch (String(state ?? "").toLowerCase()) {
    case "connected":
      return "connected";
    case "session_expired":
      return "expired";
    case "offline":
      return "offline";
    case "saved":
      return "saved";
    default:
      switch (indicator) {
        case "green":
          return "connected";
        case "red":
          return "disconnected";
        case "yellow":
          return "degraded";
        default:
          return "unknown";
      }
  }
}

function isFavoriteLabNode(contextValue: string | undefined): boolean {
  return (
    typeof contextValue === "string" &&
    contextValue.includes("containerlabLab") &&
    contextValue.includes("Favorite")
  );
}

function isSharedLabNode(node: ExplorerNode): boolean {
  return Boolean(node.shareAction);
}

function endpointRowHeight(isEndpointRoot: boolean, isEndpointSection: boolean): number {
  if (isEndpointRoot) {
    return TREE_ENDPOINT_ROW_HEIGHT_PX;
  }
  if (isEndpointSection) {
    return TREE_SECTION_ROW_HEIGHT_PX;
  }
  return TREE_ROW_HEIGHT_PX;
}

function explorerNodeLabelColor({
  isEndpointRoot,
  isEndpointSection,
  isDisconnectedPlaceholder
}: {
  isEndpointRoot: boolean;
  isEndpointSection: boolean;
  isDisconnectedPlaceholder: boolean;
}): string | undefined {
  if (isDisconnectedPlaceholder || isEndpointSection) {
    return COLOR_TEXT_SECONDARY;
  }
  if (isEndpointRoot) {
    return COLOR_TEXT_PRIMARY;
  }
  return undefined;
}

function endpointStatusText(node: ExplorerNode, isEndpointRoot: boolean): string | null {
  if (!isEndpointRoot) {
    return null;
  }
  return endpointStatusLabel(node.state, node.statusIndicator);
}

function endpointDescriptionText(
  secondaryText: string | undefined,
  isEndpointRoot: boolean
): string | null {
  if (!isEndpointRoot || !secondaryText || secondaryText.trim().length === 0) {
    return null;
  }
  return secondaryText;
}

interface ExplorerNodeDisplayFlags {
  inlineContainerStatus: string | undefined;
  showSecondaryLine: boolean;
  showStatusDot: boolean;
  showFavoriteIcon: boolean;
  showSharedIcon: boolean;
}

function deriveExplorerNodeDisplayFlags(
  node: ExplorerNode,
  secondaryText: string | undefined,
  isEndpointRoot: boolean,
  isEndpointSection: boolean,
  isDisconnectedPlaceholder: boolean
): ExplorerNodeDisplayFlags {
  const isContainer =
    node.contextValue === "containerlabContainer" || node.contextValue === "containerlabContainerGroup";
  const isInterface =
    node.contextValue === "containerlabInterfaceUp" || node.contextValue === "containerlabInterfaceDown";
  return {
    inlineContainerStatus: isContainer ? secondaryText?.trim() : undefined,
    showSecondaryLine:
      Boolean(secondaryText) &&
      !isContainer &&
      !isInterface &&
      !isEndpointRoot &&
      !isEndpointSection &&
      !isDisconnectedPlaceholder,
    showStatusDot: Boolean(node.statusIndicator) && !isInterface && !isEndpointRoot && !isDisconnectedPlaceholder,
    showFavoriteIcon: isFavoriteLabNode(node.contextValue),
    showSharedIcon: isSharedLabNode(node)
  };
}

interface ExplorerEndpointQuickActions {
  newTopologyAction: ExplorerAction | undefined;
  cloneRepoAction: ExplorerAction | undefined;
  reconnectAction: ExplorerAction | undefined;
}

function resolveEndpointQuickActions(
  actions: readonly ExplorerAction[],
  isEndpointRoot: boolean,
  isEndpointConnected: boolean
): ExplorerEndpointQuickActions {
  if (!isEndpointRoot) {
    return {
      newTopologyAction: undefined,
      cloneRepoAction: undefined,
      reconnectAction: undefined
    };
  }
  if (isEndpointConnected) {
    return {
      newTopologyAction: actions.find((action) => action.commandId === "containerlab.editor.topoViewerEditor"),
      cloneRepoAction: actions.find((action) => action.commandId === "containerlab.lab.cloneRepo"),
      reconnectAction: undefined
    };
  }
  return {
    newTopologyAction: undefined,
    cloneRepoAction: undefined,
    reconnectAction: actions.find((action) => action.commandId === "containerlab.endpoint.reconnect")
  };
}

function actionIcon(action: ExplorerAction): SvgIconComponent {
  const command = action.commandId.toLowerCase();
  const commandIcon = ACTION_ICON_BY_COMMAND[command];
  if (commandIcon) {
    return commandIcon;
  }

  for (const rule of ACTION_ICON_RULES) {
    if (rule.match(command)) {
      return rule.icon;
    }
  }

  return BuildIcon;
}

function actionGroupId(action: ExplorerAction): ActionGroupId {
  const command = action.commandId.toLowerCase();

  for (const rule of ACTION_GROUP_RULES) {
    if (rule.match(command)) {
      return rule.group;
    }
  }

  return "other";
}

const ACTION_GROUP_LABELS: Record<ActionGroupId, string> = {
  topology: "Topology",
  graph: "Graph",
  lifecycle: "Lifecycle",
  save: "Save",
  access: "Access",
  sharing: "Sharing",
  network: "Network",
  inspect: "Inspect",
  copy: "Copy",
  tools: "Tools",
  view: "View",
  danger: "Danger",
  other: "Other"
};

const ACTION_GROUP_ICONS: Record<ActionGroupId, SvgIconComponent> = {
  topology: FolderOpenIcon,
  graph: AccountTreeIcon,
  lifecycle: PlayArrowIcon,
  save: SaveOutlinedIcon,
  access: TerminalIcon,
  sharing: LinkIcon,
  network: SettingsEthernetIcon,
  inspect: ManageSearchIcon,
  copy: ContentCopyIcon,
  tools: BuildIcon,
  view: FilterAltIcon,
  danger: DeleteOutlineIcon,
  other: BuildIcon
};

const GRAPH_COMMAND_ORDER = new Map<string, number>([
  ["containerlab.lab.graph.topoviewer", 1],
  ["containerlab.lab.graph.drawio.interactive", 2],
  ["containerlab.lab.graph.drawio.horizontal", 3],
  ["containerlab.lab.graph.drawio.vertical", 4]
]);

function actionGroupLabel(groupId: ActionGroupId): string {
  return ACTION_GROUP_LABELS[groupId];
}

function actionGroupIcon(groupId: ActionGroupId): SvgIconComponent {
  return ACTION_GROUP_ICONS[groupId];
}

function sortGroupActions(groupId: ActionGroupId, actions: ExplorerAction[]): ExplorerAction[] {
  if (groupId !== "graph") {
    return actions;
  }

  return [...actions].sort((a, b) => {
    const aOrder = GRAPH_COMMAND_ORDER.get(a.commandId.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = GRAPH_COMMAND_ORDER.get(b.commandId.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return a.label.localeCompare(b.label);
  });
}

function groupActions(actions: ExplorerAction[], nodeKind: ExplorerNodeKind): ExplorerActionGroup[] {
  const grouped = new Map<ActionGroupId, ExplorerAction[]>();
  const order = ACTION_GROUP_ORDER_BY_NODE_KIND[nodeKind] ?? ACTION_GROUP_ORDER_DEFAULT;

  for (const action of actions) {
    const groupId = actionGroupId(action);
    const bucket = grouped.get(groupId) ?? [];
    bucket.push(action);
    grouped.set(groupId, bucket);
  }

  return order
    .map((groupId) => ({
      id: groupId,
      label: actionGroupLabel(groupId),
      actions: sortGroupActions(groupId, grouped.get(groupId) ?? [])
    }))
    .filter((group) => group.actions.length > 0);
}

function isInterfaceTimingAction(commandId: string): boolean {
  return (
    commandId === "containerlab.interface.setdelay" ||
    commandId === "containerlab.interface.setjitter" ||
    commandId === "containerlab.interface.setloss" ||
    commandId === "containerlab.interface.setrate" ||
    commandId === "containerlab.interface.setcorruption"
  );
}

function actionGroupSection(groupId: ActionGroupId, nodeKind: ExplorerNodeKind): number {
  const nodeKindSections = ACTION_GROUP_SECTION_BY_NODE_KIND[nodeKind];
  const section = nodeKindSections?.[groupId];
  if (section !== undefined) {
    return section;
  }
  return ACTION_GROUP_SECTION_DEFAULT_BY_NODE_KIND[nodeKind] ?? 1;
}

function withSectionDividers(
  groups: ExplorerActionGroup[],
  nodeKind: ExplorerNodeKind,
  renderGroup: (group: ExplorerActionGroup) => ContextMenuItem[]
): ContextMenuItem[] {
  if (groups.length === 0) {
    return [];
  }

  const items: ContextMenuItem[] = [];
  let previousSection: number | null = null;
  for (const group of groups) {
    const section = actionGroupSection(group.id, nodeKind);
    const rendered = renderGroup(group);
    if (rendered.length === 0) {
      continue;
    }
    if (items.length > 0 && previousSection !== null && section !== previousSection) {
      items.push({ id: `divider:${nodeKind}:${group.id}:${items.length}`, label: "", divider: true });
    }
    items.push(...rendered);
    previousSection = section;
  }
  return items;
}

function isHelpFeedbackLinkNode(node: ExplorerNode, sectionId: ExplorerSectionId): boolean {
  if (sectionId !== "helpFeedback") {
    return false;
  }
  return node.primaryAction?.commandId.toLowerCase() === "containerlab.openlink";
}

function helpFeedbackIconForNode(node: ExplorerNode): SvgIconComponent {
  const label = node.label.toLowerCase();
  if (label.includes("discord")) {
    return ForumOutlinedIcon;
  }
  if (label.includes("github")) {
    return SourceIcon;
  }
  if (label.includes("download")) {
    return DownloadOutlinedIcon;
  }
  if (label.includes("find")) {
    return SearchIcon;
  }
  if (label.includes("extension")) {
    return ArticleOutlinedIcon;
  }
  return DescriptionOutlinedIcon;
}

interface ExplorerLeadingIcon {
  Icon: SvgIconComponent;
  color: string;
}

interface FileIconRule {
  color: string;
  icon: SvgIconComponent;
  match: RegExp;
}

const FILE_ICON_DEFAULT_COLOR = "#90a4ae";
const FILE_ICON_FOLDER_COLOR = "#dcb67a";
const FILE_ICON_ENDPOINT_COLOR = "#42a5f5";
const DOCKERFILE_NAME_REGEX = /^dockerfile(?:\..*)?$/i;
const DOCKERFILE_EXTENSION_REGEX = /\.dockerfile$/i;

const FILE_ICON_RULES: FileIconRule[] = [
  { match: /\.clab\.ya?ml$/i, icon: AccountTreeIcon, color: "#519aba" },
  { match: /\.ya?ml$/i, icon: DataObjectOutlinedIcon, color: "#cbcb41" },
  { match: /\.jsonc?$/i, icon: DataObjectOutlinedIcon, color: "#cbcb41" },
  { match: /\.(drawio|xml|xsd|svg|xhtml|xaml|plist|gml|kml|wsdl)$/i, icon: CodeIcon, color: "#e37933" },
  { match: /\.html?$/i, icon: HtmlIcon, color: "#e44d26" },
  { match: /\.css$/i, icon: CssIcon, color: "#42a5f5" },
  { match: /\.(scss|sass)$/i, icon: CssIcon, color: "#c6538c" },
  { match: /\.less$/i, icon: CssIcon, color: "#2b7489" },
  { match: /\.(js|jsx|mjs|cjs)$/i, icon: JavascriptIcon, color: "#f1e05a" },
  { match: /\.(ts|tsx)$/i, icon: CodeIcon, color: "#3178c6" },
  { match: /\.mdx?$/i, icon: ArticleOutlinedIcon, color: "#519aba" },
  { match: /\.(sh|bash|zsh|fish)$/i, icon: TerminalIcon, color: "#89e051" },
  { match: /\.ps1$/i, icon: TerminalIcon, color: "#5391fe" },
  { match: /\.(bat|cmd)$/i, icon: TerminalIcon, color: "#c1f12e" },
  { match: /\.(py|pyw)$/i, icon: CodeIcon, color: "#3572a5" },
  { match: /\.go$/i, icon: CodeIcon, color: "#00add8" },
  { match: /\.rs$/i, icon: CodeIcon, color: "#dea584" },
  { match: /\.(c|cc|cpp|cxx|h|hpp)$/i, icon: CodeIcon, color: "#659ad2" },
  { match: /\.cs$/i, icon: CodeIcon, color: "#68217a" },
  { match: /\.java$/i, icon: CodeIcon, color: "#e76f00" },
  { match: /\.php$/i, icon: CodeIcon, color: "#777bb4" },
  { match: /\.rb$/i, icon: CodeIcon, color: "#cc342d" },
  { match: /\.(sql|mysql|pgsql)$/i, icon: DataObjectOutlinedIcon, color: "#f29111" },
  { match: /\.(tf|tfvars|hcl)$/i, icon: DataObjectOutlinedIcon, color: "#844fba" },
  { match: /\.proto$/i, icon: DataObjectOutlinedIcon, color: "#e37933" },
  { match: /\.(ini|conf|cfg|properties|env)$/i, icon: DataObjectOutlinedIcon, color: "#6d8086" },
  { match: /\.(lic|license|pem|crt|key)$/i, icon: DescriptionOutlinedIcon, color: "#f9c74f" }
];

function fileIconForNode(node: ExplorerNode): ExplorerLeadingIcon {
  const fileName = node.label.toLowerCase();
  if (DOCKERFILE_NAME_REGEX.test(fileName) || DOCKERFILE_EXTENSION_REGEX.test(fileName)) {
    return { Icon: HubOutlinedIcon, color: "#2496ed" };
  }

  const rule = FILE_ICON_RULES.find((entry) => entry.match.test(fileName));
  return rule
    ? { Icon: rule.icon, color: rule.color }
    : { Icon: DescriptionOutlinedIcon, color: FILE_ICON_DEFAULT_COLOR };
}

function nodeLeadingIcon(
  node: ExplorerNode,
  sectionId: ExplorerSectionId
): ExplorerLeadingIcon | undefined {
  if (isHelpFeedbackLinkNode(node, sectionId)) {
    return { Icon: helpFeedbackIconForNode(node), color: COLOR_TEXT_SECONDARY };
  }

  const context = node.contextValue;
  if (isEndpointNode(context)) {
    return { Icon: HubOutlinedIcon, color: COLOR_TEXT_PRIMARY };
  }
  if (context === "containerlabInterfaceUp") {
    return { Icon: SettingsEthernetIcon, color: "success.main" };
  }
  if (context === "containerlabInterfaceDown") {
    return { Icon: LinkOffIcon, color: "error.main" };
  }
  if (context === "containerlabFolder") {
    return { Icon: FolderIcon, color: FILE_ICON_FOLDER_COLOR };
  }
  if (context === "containerlabFileExplorerRoot") {
    return { Icon: HubOutlinedIcon, color: FILE_ICON_ENDPOINT_COLOR };
  }
  if (context === "containerlabFileFolder") {
    return { Icon: FolderIcon, color: FILE_ICON_FOLDER_COLOR };
  }
  if (context === "containerlabFileTopology") {
    return fileIconForNode(node);
  }
  if (context === "containerlabFile") {
    return fileIconForNode(node);
  }
  if (typeof context === "string" && context.includes("containerlabLabUndeployed")) {
    return { Icon: DescriptionOutlinedIcon, color: COLOR_TEXT_SECONDARY };
  }
  return undefined;
}

function toContextMenuItem(
  action: ExplorerAction,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem {
  const ActionIcon = actionIcon(action);
  return {
    id: action.id,
    label: action.label,
    icon: <ActionIcon fontSize="small" />,
    danger: Boolean(action.destructive),
    disabled: action.disabled,
    onClick: () => onInvokeAction(action)
  };
}

function sharingBucketForCommand(commandId: string): SharingBucket {
  const command = commandId.toLowerCase();
  if (command.includes(".sshx.")) {
    return "sshx";
  }
  if (command.includes(".gotty.")) {
    return "gotty";
  }
  return "other";
}

function buildSharingGroupChildren(
  actions: ExplorerAction[],
  groupId: ActionGroupId,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  const sharingChildren: ContextMenuItem[] = [];
  let previousBucket: SharingBucket | null = null;

  for (const action of actions) {
    const bucket = sharingBucketForCommand(action.commandId);
    if (sharingChildren.length > 0 && previousBucket !== null && bucket !== previousBucket) {
      sharingChildren.push({
        id: `group:${groupId}:divider:${action.id}`,
        label: "",
        divider: true
      });
    }
    sharingChildren.push(toContextMenuItem(action, onInvokeAction));
    previousBucket = bucket;
  }

  return sharingChildren;
}

function toGroupMenuItem(
  group: ExplorerActionGroup,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem {
  if (group.actions.length === 1) {
    return toContextMenuItem(group.actions[0], onInvokeAction);
  }

  const GroupIcon = actionGroupIcon(group.id);
  const children =
    group.id === "sharing"
      ? buildSharingGroupChildren(group.actions, group.id, onInvokeAction)
      : group.actions.map((action) => toContextMenuItem(action, onInvokeAction));

  return {
    id: `group:${group.id}`,
    label: group.label,
    icon: <GroupIcon fontSize="small" />,
    children
  };
}

function toGroupMenuItems(
  group: ExplorerActionGroup,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  if (group.id === "lifecycle") {
    return group.actions.map((action) => toContextMenuItem(action, onInvokeAction));
  }
  return [toGroupMenuItem(group, onInvokeAction)];
}

function buildInterfaceMenuItems(
  actions: ExplorerAction[],
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  const interfaceItems: ContextMenuItem[] = [];
  let inTimingGroup = false;
  for (const action of actions) {
    const commandId = action.commandId.toLowerCase();
    const isTimingAction = isInterfaceTimingAction(commandId);

    if (isTimingAction && !inTimingGroup && interfaceItems.length > 0) {
      interfaceItems.push({
        id: `group:interface:timing-start:${action.id}`,
        label: "",
        divider: true
      });
    }
    if (!isTimingAction && inTimingGroup) {
      interfaceItems.push({
        id: `group:interface:timing-end:${action.id}`,
        label: "",
        divider: true
      });
    }

    interfaceItems.push(toContextMenuItem(action, onInvokeAction));
    inTimingGroup = isTimingAction;
  }

  return interfaceItems;
}

const ENDPOINT_ROOT_MENU_COMMANDS = [
  "containerlab.editor.topoViewerEditor",
  "containerlab.lab.cloneRepo",
  "containerlab.endpoint.reconnect",
  "containerlab.endpoint.copyUrl",
  "containerlab.endpoint.remove"
] as const;

const ENDPOINT_CAPTURE_MENU_COMMANDS = [
  "containerlab.install.edgeshark",
  "containerlab.uninstall.edgeshark",
  "containerlab.capture.killAllWiresharkVNC",
  "containerlab.set.sessionHostname"
] as const;

function findActionByCommandId(
  actions: readonly ExplorerAction[],
  commandId: string
): ExplorerAction | undefined {
  return actions.find((action) => action.commandId === commandId);
}

function buildEndpointMenuItems(
  actions: ExplorerAction[],
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  const groupedCommandIds = new Set<string>([
    ...ENDPOINT_ROOT_MENU_COMMANDS,
    ...ENDPOINT_CAPTURE_MENU_COMMANDS
  ]);
  const rootItems = ENDPOINT_ROOT_MENU_COMMANDS
    .map((commandId) => findActionByCommandId(actions, commandId))
    .filter((action): action is ExplorerAction => Boolean(action))
    .map((action) => toContextMenuItem(action, onInvokeAction));
  const extraEndpointItems = actions
    .filter((action) => !groupedCommandIds.has(action.commandId))
    .map((action) => toContextMenuItem(action, onInvokeAction));
  const captureItems = ENDPOINT_CAPTURE_MENU_COMMANDS
    .map((commandId) => findActionByCommandId(actions, commandId))
    .filter((action): action is ExplorerAction => Boolean(action))
    .map((action) => toContextMenuItem(action, onInvokeAction));

  if (captureItems.length === 0) {
    return [...rootItems, ...extraEndpointItems];
  }

  return [
    ...rootItems,
    ...extraEndpointItems,
    {
      id: "group:endpoint:capture",
      label: "Capture",
      icon: <SettingsEthernetIcon fontSize="small" />,
      children: captureItems
    }
  ];
}

function buildNodeContextMenuItems(
  menuActions: ExplorerAction[],
  nodeKind: ExplorerNodeKind,
  contextValue: string | undefined,
  onInvokeAction: (action: ExplorerAction) => void
): ContextMenuItem[] {
  if (isEndpointNode(contextValue)) {
    return buildEndpointMenuItems(menuActions, onInvokeAction);
  }

  if (nodeKind === "interface") {
    return buildInterfaceMenuItems(menuActions, onInvokeAction);
  }

  const groupedActions = groupActions(menuActions, nodeKind);
  if (nodeKind === "file") {
    return withSectionDividers(groupedActions, nodeKind, (group) =>
      group.actions.map((action) => toContextMenuItem(action, onInvokeAction))
    );
  }

  return withSectionDividers(groupedActions, nodeKind, (group) =>
    toGroupMenuItems(group, onInvokeAction)
  );
}

function filterNodeMenuActions(nodeActions: ExplorerAction[], nodeKind: ExplorerNodeKind): ExplorerAction[] {
  if (nodeKind !== "lab") {
    return nodeActions;
  }
  return nodeActions.filter(
    (action) => action.commandId.toLowerCase() !== "containerlab.lab.graph.topoviewer"
  );
}

function useExplorerNodeMenu(params: {
  hasActions: boolean;
  hasContextMenuItems: boolean;
}) {
  const { hasActions, hasContextMenuItems } = params;
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [menuOpenToLeft, setMenuOpenToLeft] = useState(false);

  const openMenuFromElement = useCallback((element: HTMLElement, openToLeft = true) => {
    const rect = element.getBoundingClientRect();
    setMenuOpenToLeft(openToLeft);
    setMenuPosition({ x: Math.round(rect.right), y: Math.round(rect.bottom + 2) });
  }, []);

  const handleMenuOpen = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!hasActions) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openMenuFromElement(event.currentTarget, true);
    },
    [hasActions, openMenuFromElement]
  );

  const handleRowContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!hasActions) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const trigger = event.currentTarget.querySelector<HTMLElement>('[data-node-actions-trigger="true"]');
      openMenuFromElement(trigger ?? event.currentTarget, true);
    },
    [hasActions, openMenuFromElement]
  );

  const handleMenuClose = useCallback(() => {
    setMenuOpenToLeft(false);
    setMenuPosition(null);
  }, []);

  const handleBackdropContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const relayTarget = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>('[data-explorer-node-row="true"]'))
      .find((element): element is HTMLElement => Boolean(element));
    if (!relayTarget) {
      return;
    }

    handleMenuClose();
    relayTarget.dispatchEvent(
      new window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        button: 2,
        buttons: 2
      })
    );
  }, [handleMenuClose]);

  const menuOpen = Boolean(menuPosition) && hasContextMenuItems;

  return {
    menuPosition,
    menuOpenToLeft,
    menuOpen,
    handleMenuOpen,
    handleRowContextMenu,
    handleMenuClose,
    handleBackdropContextMenu
  };
}

function usePrimaryActionHandler(
  primaryAction: ExplorerNode["primaryAction"],
  onInvokeAction: (action: ExplorerAction) => void
) {
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!primaryAction) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onInvokeAction(primaryAction);
    },
    [primaryAction, onInvokeAction]
  );
}

function useShareActionHandler(
  shareAction: ExplorerNode["shareAction"],
  onInvokeAction: (action: ExplorerAction) => void
) {
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!shareAction) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onInvokeAction(shareAction);
    },
    [shareAction, onInvokeAction]
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
  const markerSlotPx = leadingIcon && isEndpointRoot ? NODE_MARKER_SLOT_PX + 3 : NODE_MARKER_SLOT_PX;

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
            fontSize="inherit"
            className="explorer-node-inline-icon explorer-node-inline-icon-shared"
            aria-hidden="true"
          />
        </IconButton>
      )}
      {inlineContainerStatus && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
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
            fontWeight={500}
            sx={{
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
          color="text.secondary"
          noWrap
          sx={{
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
  actions: ExplorerEndpointQuickActions;
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
          alignItems="center"
          sx={{ minWidth: 0, width: "100%" }}
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
        </Stack>
      </Tooltip>
      {showSecondaryLine && (
        <Typography variant="caption" color="text.secondary" noWrap>
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

function ExplorerNodeLabel({ node, sectionId, onInvokeAction }: Readonly<ExplorerNodeLabelProps>) {
  const hasEntryTooltip = Boolean(node.tooltip);
  const leadingIcon = nodeLeadingIcon(node, sectionId);
  const nodeKind = nodeKindFromContext(node.contextValue);
  const isEndpointRoot = isEndpointNode(node.contextValue);
  const isEndpointSection = isEndpointSectionNode(node.contextValue);
  const isDisconnectedPlaceholder = isEndpointDisconnectedNode(node.contextValue);
  const menuActions = useMemo(() => filterNodeMenuActions(node.actions, nodeKind), [node.actions, nodeKind]);
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
      alignItems="center"
      spacing={0.55}
      onContextMenu={handleRowContextMenu}
      data-explorer-node-row="true"
      sx={{
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
    hasChildren && (isEndpointRoot || isEndpointSection || isFileExplorerFolderNode(node.contextValue));
  const rowMinHeight = endpointRowHeight(isEndpointRoot, isEndpointSection);

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        spacing={TREE_ROW_GAP}
        sx={{ minHeight: rowMinHeight, pl: depth * TREE_DEPTH_INDENT }}
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
              {isExpanded ? <ExpandMoreIcon fontSize="inherit" /> : <ChevronRightIcon fontSize="inherit" />}
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

function SectionTree({
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
      <Typography variant="body2" color="text.secondary">
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

function SectionToolbarActions({ actions, onInvokeAction }: Readonly<SectionToolbarProps>) {
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

interface ResizeDividerProps {
  aboveId: ExplorerSectionId;
  belowId: ExplorerSectionId;
  onResizeStart: (aboveId: ExplorerSectionId, belowId: ExplorerSectionId, startY: number) => void;
}

function ResizeDivider({ aboveId, belowId, onResizeStart }: Readonly<ResizeDividerProps>) {
  return (
    <Box
      onMouseDown={(e) => {
        e.preventDefault();
        onResizeStart(aboveId, belowId, e.clientY);
      }}
      sx={{
        height: RESIZE_DIVIDER_HEIGHT_PX,
        flex: `0 0 ${RESIZE_DIVIDER_HEIGHT_PX}px`,
        cursor: "row-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "&:hover": {
          bgcolor: (theme: Theme) => theme.alpha(theme.palette.primary.main, 0.18)
        }
      }}
    />
  );
}

function usePaneResize(
  containerRef: RefObject<HTMLDivElement | null>,
  heightRatioBySection: Partial<Record<ExplorerSectionId, number>>,
  setHeightRatioBySection: Dispatch<SetStateAction<Partial<Record<ExplorerSectionId, number>>>>,
  collapsedBySection: Partial<Record<ExplorerSectionId, boolean>>,
  orderedSections: ExplorerSectionSnapshot[]
) {
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);

  const handleResizeStart = useCallback(
    (aboveId: ExplorerSectionId, belowId: ExplorerSectionId, startY: number) => {
      const container = containerRef.current;
      if (!container) return;

      isResizingRef.current = true;
      setIsResizing(true);

      const expandedSections = orderedSections.filter(
        (section) => !collapsedBySection[section.id] && !FIXED_HEIGHT_SECTIONS.has(section.id)
      );
      const expandedIds = expandedSections.map((section) => section.id);
      const headerHeight = expandedSections.reduce(
        (sum, section) => sum + sectionHeaderHeight(section),
        0
      );
      const dividerCount = Math.max(0, expandedIds.length - 1);
      const containerHeight = container.clientHeight;
      const availableBody =
        containerHeight - headerHeight - dividerCount * RESIZE_DIVIDER_HEIGHT_PX;

      const initialAboveRatio = heightRatioBySection[aboveId] ?? (1 / expandedIds.length);
      const initialBelowRatio = heightRatioBySection[belowId] ?? (1 / expandedIds.length);
      const combinedRatio = initialAboveRatio + initialBelowRatio;

      const onMouseMove = (ev: globalThis.MouseEvent) => {
        if (!isResizingRef.current) return;

        const deltaY = ev.clientY - startY;
        const ratioDelta = availableBody > 0 ? deltaY / availableBody : 0;

        const minRatio = availableBody > 0 ? MIN_SECTION_BODY_HEIGHT_PX / availableBody : 0;
        let newAboveRatio = initialAboveRatio + ratioDelta;
        let newBelowRatio = initialBelowRatio - ratioDelta;

        if (newAboveRatio < minRatio) {
          newAboveRatio = minRatio;
          newBelowRatio = combinedRatio - minRatio;
        }
        if (newBelowRatio < minRatio) {
          newBelowRatio = minRatio;
          newAboveRatio = combinedRatio - minRatio;
        }

        setHeightRatioBySection((current) => ({
          ...current,
          [aboveId]: newAboveRatio,
          [belowId]: newBelowRatio
        }));
      };

      const onMouseUp = () => {
        isResizingRef.current = false;
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [containerRef, heightRatioBySection, setHeightRatioBySection, collapsedBySection, orderedSections]
  );

  return { isResizing, handleResizeStart };
}

function normalizeHeightRatios(
  currentRatios: Partial<Record<ExplorerSectionId, number>>,
  expandedIds: ExplorerSectionId[]
): Partial<Record<ExplorerSectionId, number>> {
  const n = expandedIds.length;
  if (n === 0) return currentRatios;

  const nextRatios: Partial<Record<ExplorerSectionId, number>> = { ...currentRatios };
  for (const id of expandedIds) {
    if (nextRatios[id] === undefined || nextRatios[id] === 0) {
      nextRatios[id] = 1 / n;
    }
  }
  const total = expandedIds.reduce((sum, id) => sum + (nextRatios[id] ?? 0), 0);
  if (total > 0) {
    for (const id of expandedIds) {
      nextRatios[id] = (nextRatios[id] ?? 0) / total;
    }
  }
  return nextRatios;
}

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

function getSectionHeaderSx(_isCollapsed: boolean, isBeingDragged: boolean) {
  return {
    px: 0.35,
    py: 0.1,
    height: SECTION_HEADER_HEIGHT_PX,
    minHeight: SECTION_HEADER_HEIGHT_PX,
    maxHeight: SECTION_HEADER_HEIGHT_PX,
    display: "flex",
    alignItems: "center",
    gap: 0.2,
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

function ExplorerSectionCard({
  section,
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
  const bareTreeSection = isBareTreeSection(section);
  const [sectionMenuPosition, setSectionMenuPosition] = useState<{ x: number; y: number } | null>(null);
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
          sx={{ ...getSectionHeaderSx(isCollapsed, isBeingDragged), flex: "0 0 auto" }}
        >
          <IconButton
            size="small"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleSectionCollapsed(section.id);
            }}
            aria-label={isCollapsed ? `Expand ${section.label}` : `Collapse ${section.label}`}
            sx={{ color: COLOR_TEXT_PRIMARY, p: 0.25 }}
          >
            {isCollapsed ? <ChevronRightIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
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
              <Box
                className="explorer-section-count"
                sx={(theme) => ({
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  px: 0.7,
                  py: 0.05,
                  minWidth: 18,
                  borderRadius: 999,
                  bgcolor: theme.alpha(theme.palette.text.primary, 0.08),
                  color: "text.secondary"
                })}
              >
                <Typography variant="caption" sx={{ color: "inherit", lineHeight: 1.3, fontWeight: 700 }}>
                  {section.count}
                </Typography>
              </Box>
            )}
          </Box>

          <SectionToolbarActions actions={section.toolbarActions} onInvokeAction={onInvokeAction} />

          {showExpandAllControl && (
            <Tooltip title={allExpanded ? "Collapse All" : "Expand All"}>
              <IconButton
                size="small"
                className="explorer-section-hover-actions"
                sx={{ color: COLOR_TEXT_PRIMARY }}
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
                {allExpanded ? <ChevronRightIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}

      {!isCollapsed && (
        <Box
          sx={{
            px: bareTreeSection ? 0.15 : 0.3,
            py: bareTreeSection ? 0.1 : 0.25,
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

export function ContainerlabExplorerView() {
  const host = useClabUiHost();
  const [sections, setSections] = useState<ExplorerSectionSnapshot[]>([]);
  const [sectionOrder, setSectionOrder] = useState<ExplorerSectionId[]>(EXPLORER_SECTION_ORDER);
  const [collapsedBySection, setCollapsedBySection] = useState<
    Partial<Record<ExplorerSectionId, boolean>>
  >({});
  const [expandedBySection, setExpandedBySection] = useState<
    Partial<Record<ExplorerSectionId, string[]>>
  >({
    runningLabs: [],
    localLabs: []
  });
  const [filterText, setFilterText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [draggingSection, setDraggingSection] = useState<ExplorerSectionId | null>(null);
  const [dragOverSection, setDragOverSection] = useState<ExplorerSectionId | null>(null);
  const [heightRatioBySection, setHeightRatioBySection] = useState<
    Partial<Record<ExplorerSectionId, number>>
  >({});
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const paneContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Partial<Record<ExplorerSectionId, HTMLDivElement | null>>>({});
  const pendingFilterSyncRef = useRef<string | null>(null);
  const filterTimeoutRef = useRef<number | null>(null);
  const uiStateTimeoutRef = useRef<number | null>(null);
  const expandedBeforeFilterRef = useRef<Partial<Record<ExplorerSectionId, string[]>> | null>(null);
  const latestUiStateRef = useRef<ExplorerUiState>(
    buildExplorerUiState({
      sectionOrder,
      collapsedBySection,
      expandedBySection,
      heightRatioBySection
    })
  );

  const handleSnapshotMessage = useCallback((message: SnapshotExplorerMessage) => {
    const pending = pendingFilterSyncRef.current;
    if (pending !== null && message.filterText !== pending) {
      return;
    }
    if (pending !== null && message.filterText === pending) {
      pendingFilterSyncRef.current = null;
    }

    setSections(message.sections);
    setSectionOrder((currentOrder) => mergeSectionOrder(currentOrder, message.sections));
    setCollapsedBySection((current) => {
      const next: Partial<Record<ExplorerSectionId, boolean>> = {};
      for (const section of message.sections) {
        next[section.id] = isBareTreeSection(section)
          ? false
          : (current[section.id] ?? !DEFAULT_EXPANDED_SECTIONS.has(section.id));
      }
      if (message.filterText.length > 0) {
        next.runningLabs = false;
        next.localLabs = false;
      }
      return next;
    });

    setExpandedBySection((current) => {
      const next = nextExpandedBySectionForSnapshot({
        current,
        expandedBeforeFilter: expandedBeforeFilterRef.current,
        filterText: message.filterText,
        sections: message.sections
      });
      expandedBeforeFilterRef.current = next.expandedBeforeFilter ?? null;
      return next.expandedBySection ?? current;
    });

    setFilterText(message.filterText);
  }, []);

  const handleFilterStateMessage = useCallback((message: FilterStateExplorerMessage) => {
    const pending = pendingFilterSyncRef.current;
    if (pending !== null && message.filterText !== pending) {
      return;
    }
    if (pending !== null && message.filterText === pending) {
      pendingFilterSyncRef.current = null;
    }
    setFilterText(message.filterText);
  }, []);

  const handleUiStateMessage = useCallback((message: UiStateExplorerMessage) => {
    const state = message.state || {};
    if (Array.isArray(state.sectionOrder) && state.sectionOrder.length > 0) {
      setSectionOrder(state.sectionOrder.filter((id) => isExplorerSectionId(id)));
    }
    if (state.collapsedBySection) {
      setCollapsedBySection(state.collapsedBySection);
    }
    if (state.expandedBySection) {
      setExpandedBySection(state.expandedBySection);
    }
    if (state.heightRatioBySection) {
      setHeightRatioBySection(state.heightRatioBySection);
    }
    setUiStateHydrated(true);
  }, []);

  const handleErrorMessage = useCallback((message: ErrorExplorerMessage) => {
    setErrorMessage(message.message);
    setErrorOpen(true);
  }, []);

  const handleErrorClose = useCallback(() => {
    setErrorOpen(false);
  }, []);

  useMessageListener<ExplorerIncomingMessage>(
    useCallback((message) => {
      switch (message.command) {
        case "snapshot":
          handleSnapshotMessage(message);
          return;
        case "filterState":
          handleFilterStateMessage(message);
          return;
        case "uiState":
          handleUiStateMessage(message);
          return;
        case "error":
          handleErrorMessage(message);
          return;
        default:
          break;
      }
    }, [handleErrorMessage, handleFilterStateMessage, handleSnapshotMessage, handleUiStateMessage])
  );
  useReadySignal();

  const invokeAction = useCallback(
    (action: ExplorerAction) => {
      if (action.disabled === true) {
        return;
      }
      void Promise.resolve(host.explorer.invokeAction(action.actionRef));
    },
    [host]
  );

  const persistExplorerUiStateImmediately = useCallback(
    (uiState: ExplorerUiState) => {
      latestUiStateRef.current = uiState;
      if (uiStateTimeoutRef.current !== null) {
        window.clearTimeout(uiStateTimeoutRef.current);
        uiStateTimeoutRef.current = null;
      }
      if (!uiStateHydrated) {
        return;
      }
      void Promise.resolve(host.explorer.persistUiState(uiState));
    },
    [host, uiStateHydrated]
  );

  const handleFilterChange = useCallback(
    (value: string) => {
      setFilterText(value);
      pendingFilterSyncRef.current = value.trim();

      if (filterTimeoutRef.current !== null) {
        window.clearTimeout(filterTimeoutRef.current);
        filterTimeoutRef.current = null;
      }

      if (value.trim().length === 0) {
        void Promise.resolve(host.explorer.setFilter(""));
        return;
      }

      filterTimeoutRef.current = window.setTimeout(() => {
        filterTimeoutRef.current = null;
        void Promise.resolve(host.explorer.setFilter(value));
      }, FILTER_UPDATE_DEBOUNCE_MS);
    },
    [host]
  );

  const applyExpandedItemsChange = useCallback(
    (sectionId: ExplorerSectionId, itemIds: string[]) => {
      const nextExpandedBySection = withExpandedSectionItems(
        latestUiStateRef.current.expandedBySection,
        sectionId,
        itemIds
      );
      const nextUiState = {
        ...latestUiStateRef.current,
        expandedBySection: nextExpandedBySection
      };
      latestUiStateRef.current = nextUiState;
      setExpandedBySection(nextExpandedBySection);
      if (shouldPersistExpandedSectionImmediately(sectionId)) {
        persistExplorerUiStateImmediately(nextUiState);
      }
    },
    [persistExplorerUiStateImmediately]
  );

  const handleExpandedItemsChange = useCallback(
    (sectionId: ExplorerSectionId, itemIds: string[]) => {
      applyExpandedItemsChange(sectionId, itemIds);
    },
    [applyExpandedItemsChange]
  );

  const expandAllInSection = useCallback((sectionId: ExplorerSectionId, nodes: ExplorerNode[]) => {
    applyExpandedItemsChange(sectionId, flattenNodeIds(nodes));
  }, [applyExpandedItemsChange]);

  const collapseAllInSection = useCallback((sectionId: ExplorerSectionId) => {
    applyExpandedItemsChange(sectionId, []);
  }, [applyExpandedItemsChange]);

  const sectionsById = useMemo(() => {
    const map = new Map<ExplorerSectionId, ExplorerSectionSnapshot>();
    for (const section of sections) {
      map.set(section.id, section);
    }
    return map;
  }, [sections]);

  const orderedSections = useMemo(() => {
    const visible: ExplorerSectionSnapshot[] = [];
    for (const sectionId of sectionOrder) {
      const section = sectionsById.get(sectionId);
      if (section) {
        visible.push(section);
      }
    }
    return visible;
  }, [sectionOrder, sectionsById]);

  const orderedSectionIds = useMemo(() => orderedSections.map((s) => s.id), [orderedSections]);

  const floatingToolbarActions = useMemo(() => {
    const primaryBareTreeSection = orderedSections.find((section) => isBareTreeSection(section));
    return primaryBareTreeSection?.toolbarActions ?? [];
  }, [orderedSections]);

  const toggleSectionCollapsed = useCallback((sectionId: ExplorerSectionId) => {
    setCollapsedBySection((current) => {
      const section = sectionsById.get(sectionId);
      if (section && isBareTreeSection(section)) {
        return current;
      }
      const wasCollapsed = current[sectionId] ?? false;
      const next = { ...current, [sectionId]: !wasCollapsed };

      const expandedAfter = orderedSectionIds.filter((id) => !next[id] && !FIXED_HEIGHT_SECTIONS.has(id));
      setHeightRatioBySection((currentRatios) => normalizeHeightRatios(currentRatios, expandedAfter));

      return next;
    });
  }, [orderedSectionIds, sectionsById]);

  const setSectionRef = useCallback((sectionId: ExplorerSectionId, element: HTMLDivElement | null) => {
    sectionRefs.current[sectionId] = element;
  }, []);

  const handleSectionDragStart = useCallback(
    (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", sectionId);
      setDraggingSection(sectionId);
      setDragOverSection(sectionId);
    },
    []
  );

  const handleSectionDragOver = useCallback(
    (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (draggingSection && draggingSection !== sectionId) {
        setDragOverSection(sectionId);
      }
    },
    [draggingSection]
  );

  const handleSectionDrop = useCallback(
    (targetId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const sourceValue = event.dataTransfer.getData("text/plain");
      const sourceId = isExplorerSectionId(sourceValue) ? sourceValue : draggingSection;

      if (!sourceId || sourceId === targetId) {
        setDraggingSection(null);
        setDragOverSection(null);
        return;
      }

      setSectionOrder((currentOrder) => reorderSections(currentOrder, sourceId, targetId));
      setDraggingSection(null);
      setDragOverSection(null);
    },
    [draggingSection]
  );

  const handleSectionDragEnd = useCallback(() => {
    setDraggingSection(null);
    setDragOverSection(null);
  }, []);

  const { isResizing, handleResizeStart } = usePaneResize(
    paneContainerRef,
    heightRatioBySection,
    setHeightRatioBySection,
    collapsedBySection,
    orderedSections
  );

  const sectionFlexStyles = useMemo(() => {
    const styles: Partial<Record<ExplorerSectionId, string>> = {};
    const expandedIds = orderedSectionIds.filter((id) => !collapsedBySection[id] && !FIXED_HEIGHT_SECTIONS.has(id));
    const n = expandedIds.length;
    for (const id of orderedSectionIds) {
      if (collapsedBySection[id] || FIXED_HEIGHT_SECTIONS.has(id)) {
        styles[id] = "0 0 auto";
      } else {
        const ratio = heightRatioBySection[id] ?? (n > 0 ? 1 / n : 1);
        styles[id] = `${ratio} 1 0px`;
      }
    }
    return styles;
  }, [orderedSectionIds, collapsedBySection, heightRatioBySection]);

  useEffect(
    () => () => {
      if (filterTimeoutRef.current !== null) {
        window.clearTimeout(filterTimeoutRef.current);
      }
      if (uiStateTimeoutRef.current !== null) {
        window.clearTimeout(uiStateTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const uiState = buildExplorerUiState({
      sectionOrder,
      collapsedBySection,
      expandedBySection,
      heightRatioBySection
    });
    latestUiStateRef.current = uiState;

    if (!uiStateHydrated) {
      return;
    }

    if (uiStateTimeoutRef.current !== null) {
      window.clearTimeout(uiStateTimeoutRef.current);
    }
    uiStateTimeoutRef.current = window.setTimeout(() => {
      uiStateTimeoutRef.current = null;
      void Promise.resolve(host.explorer.persistUiState(uiState));
    }, UI_STATE_UPDATE_DEBOUNCE_MS);
  }, [sectionOrder, collapsedBySection, expandedBySection, heightRatioBySection, host, uiStateHydrated]);

  return (
    <Box
      className="containerlab-explorer-root"
      sx={{
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        minHeight: 0,
        boxSizing: "border-box",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        pt: 0,
        px: 0,
        pb: 0,
        gap: 0
      }}
    >
      <Snackbar
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        autoHideDuration={10000}
        open={errorOpen && Boolean(errorMessage)}
        onClose={handleErrorClose}
        sx={{
          mt: 1,
          mr: 1,
          maxWidth: { xs: "calc(100vw - 16px)", sm: 560 }
        }}
      >
        <Alert
          severity="error"
          variant="filled"
          onClose={handleErrorClose}
          sx={{
            width: "100%",
            alignItems: "flex-start",
            "& .MuiAlert-message": {
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }
          }}
        >
          {errorMessage}
        </Alert>
      </Snackbar>

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          px: 0.75,
          py: 0.5,
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider"
        }}
      >
        <TextField
          size="small"
          fullWidth
          value={filterText}
          placeholder="Filter labs, nodes, interfaces"
          onChange={(event) => handleFilterChange(event.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: undefined
            }
          }}
        />
        {floatingToolbarActions.length > 0 && (
          <SectionToolbarActions actions={floatingToolbarActions} onInvokeAction={invokeAction} />
        )}
      </Stack>

      <Box
        ref={paneContainerRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...(isResizing && { cursor: "row-resize", userSelect: "none" })
        }}
      >
        {orderedSections.map((section, index) => {
          const isExpanded = !(collapsedBySection[section.id] ?? false);
          const prevExpandedId = (() => {
            for (let i = index - 1; i >= 0; i--) {
              if (!(collapsedBySection[orderedSections[i].id] ?? false)) {
                return orderedSections[i].id;
              }
            }
            return null;
          })();

          return (
            <Box key={section.id} sx={{ display: "contents" }}>
              {isExpanded && prevExpandedId && !FIXED_HEIGHT_SECTIONS.has(section.id) && !FIXED_HEIGHT_SECTIONS.has(prevExpandedId) && (
                <ResizeDivider
                  aboveId={prevExpandedId}
                  belowId={section.id}
                  onResizeStart={handleResizeStart}
                />
              )}
              <ExplorerSectionCard
                section={section}
                expandedItems={expandedBySection[section.id] ?? []}
                isCollapsed={collapsedBySection[section.id] ?? false}
                isDropTarget={dragOverSection === section.id && draggingSection !== section.id}
                isBeingDragged={draggingSection === section.id}
                flexStyle={sectionFlexStyles[section.id] ?? "0 0 auto"}
                onSetSectionRef={setSectionRef}
                onSectionDragStart={handleSectionDragStart}
                onSectionDragOver={handleSectionDragOver}
                onSectionDrop={handleSectionDrop}
                onSectionDragEnd={handleSectionDragEnd}
                onToggleSectionCollapsed={toggleSectionCollapsed}
                onInvokeAction={invokeAction}
                onExpandedItemsChange={handleExpandedItemsChange}
                onExpandAllInSection={expandAllInSection}
                onCollapseAllInSection={collapseAllInSection}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
