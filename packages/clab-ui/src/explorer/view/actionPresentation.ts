import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import LinkOffRoundedIcon from "@mui/icons-material/LinkOffRounded";
import ManageSearchRoundedIcon from "@mui/icons-material/ManageSearchRounded";
import NoteAddOutlinedIcon from "@mui/icons-material/NoteAddOutlined";
import OpenInBrowserOutlinedIcon from "@mui/icons-material/OpenInBrowserOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutlined";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlined";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import SettingsEthernetRoundedIcon from "@mui/icons-material/SettingsEthernetRounded";
import SourceOutlinedIcon from "@mui/icons-material/SourceOutlined";
import StarBorderRoundedIcon from "@mui/icons-material/StarBorderRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import type { ContextMenuItem } from "../../components/context-menu/ContextMenu";
import type { ExplorerAction } from "../shared/explorer/types";

export type ActionGroupId =
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

export type ExplorerNodeKind = "lab" | "container" | "interface" | "link" | "file" | "other";

export interface ExplorerActionGroup {
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

export type SharingBucket = "sshx" | "gotty" | "other";

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
  link: [
    "sharing",
    "copy",
    "view",
    "topology",
    "graph",
    "lifecycle",
    "save",
    "network",
    "inspect",
    "tools",
    "other",
    "access"
  ],
  file: ["topology", "view", "copy", "tools", "other", "danger"],
  other: ACTION_GROUP_ORDER_DEFAULT
};

const ACTION_ICON_BY_COMMAND: Record<string, SvgIconComponent> = {
  "containerlab.endpoint.add": AddRoundedIcon,
  "containerlab.inspectall": ManageSearchRoundedIcon,
  "containerlab.treeview.runninglabs.hidenonownedlabs": VisibilityOffOutlinedIcon,
  "containerlab.treeview.runninglabs.shownonownedlabs": VisibilityOutlinedIcon,
  "containerlab.images.manage": Inventory2OutlinedIcon,
  "containerlab.editor.topoviewereditor": NoteAddOutlinedIcon,
  "containerlab.lab.clonerepo": SourceOutlinedIcon,
  "containerlab.lab.togglefavorite": StarBorderRoundedIcon,
  "containerlab.lab.addtoworkspace": FolderOpenOutlinedIcon,
  "containerlab.lab.save": SaveOutlinedIcon,
  "containerlab.lab.start": PlayArrowRoundedIcon,
  "containerlab.lab.stop": StopRoundedIcon,
  "containerlab.lab.restart": RefreshRoundedIcon,
  "containerlab.node.start": PlayArrowRoundedIcon,
  "containerlab.node.save": SaveOutlinedIcon,
  "containerlab.node.showlogs": ArticleOutlinedIcon,
  "containerlab.node.stop": StopRoundedIcon,
  "containerlab.node.restart": RefreshRoundedIcon,
  "containerlab.node.pause": PauseCircleOutlineIcon,
  "containerlab.node.unpause": PlayCircleOutlineIcon,
  "containerlab.interface.setdelay": TuneRoundedIcon,
  "containerlab.interface.setjitter": TuneRoundedIcon,
  "containerlab.interface.setloss": TuneRoundedIcon,
  "containerlab.interface.setrate": TuneRoundedIcon,
  "containerlab.interface.setcorruption": TuneRoundedIcon,
  "containerlab.lab.sshx.attach": LinkRoundedIcon,
  "containerlab.lab.sshx.detach": LinkOffRoundedIcon,
  "containerlab.lab.sshx.reattach": LinkRoundedIcon,
  "containerlab.lab.sshx.copylink": LinkRoundedIcon,
  "containerlab.lab.gotty.attach": OpenInBrowserOutlinedIcon,
  "containerlab.lab.gotty.detach": OpenInBrowserOutlinedIcon,
  "containerlab.lab.gotty.reattach": OpenInBrowserOutlinedIcon,
  "containerlab.lab.gotty.copylink": OpenInBrowserOutlinedIcon,
  "containerlab.file.open": ArticleOutlinedIcon,
  "containerlab.file.opentopology": AccountTreeOutlinedIcon,
  "containerlab.file.newfile": NoteAddOutlinedIcon,
  "containerlab.file.newfolder": FolderOpenOutlinedIcon,
  "containerlab.file.download": DownloadOutlinedIcon,
  "containerlab.file.downloadarchive": DownloadOutlinedIcon,
  "containerlab.file.upload": FileUploadOutlinedIcon,
  "containerlab.lab.downloadarchive": DownloadOutlinedIcon,
  "containerlab.install.edgeshark": SettingsEthernetRoundedIcon,
  "containerlab.uninstall.edgeshark": DeleteOutlineIcon,
  "containerlab.capture.killallwiresharkvnc": StopRoundedIcon,
  "containerlab.set.sessionhostname": SettingsEthernetRoundedIcon,
  "containerlab.endpoint.reconnect": RefreshRoundedIcon,
  "containerlab.endpoint.remove": DeleteOutlineIcon,
  "containerlab.endpoint.copyurl": ContentCopyOutlinedIcon
};

const ACTION_ICON_RULES: ReadonlyArray<CommandIconRule> = [
  { match: (command) => command.includes("upload"), icon: FileUploadOutlinedIcon },
  { match: (command) => command.includes("download"), icon: DownloadOutlinedIcon },
  { match: (command) => command.includes("copy"), icon: ContentCopyOutlinedIcon },
  {
    match: (command) =>
      command.includes("destroy") || command.includes("delete") || command.includes("detach"),
    icon: DeleteOutlineIcon
  },
  {
    match: (command) => command.includes("redeploy"),
    icon: RefreshRoundedIcon
  },
  {
    match: (command) => command.includes("restart"),
    icon: RefreshRoundedIcon
  },
  { match: (command) => command.includes("stop"), icon: StopRoundedIcon },
  { match: (command) => command.includes("unpause"), icon: PlayCircleOutlineIcon },
  { match: (command) => command.includes("pause"), icon: PauseCircleOutlineIcon },
  {
    match: (command) =>
      command.includes("ssh") || command.includes("shell") || command.includes("telnet"),
    icon: TerminalRoundedIcon
  },
  { match: (command) => command.includes("filter"), icon: FilterAltOutlinedIcon },
  { match: (command) => command.includes(".save"), icon: SaveOutlinedIcon },
  {
    match: (command) => command.includes("showlogs") || command.includes("logs"),
    icon: ArticleOutlinedIcon
  },
  { match: (command) => command.startsWith("containerlab.lab.fcli."), icon: BuildOutlinedIcon },
  { match: (command) => command.includes(".gotty."), icon: OpenInBrowserOutlinedIcon },
  { match: (command) => command.startsWith("containerlab.lab.graph."), icon: AccountTreeOutlinedIcon },
  {
    match: (command) =>
      command.includes("open") || command.includes("graph") || command.includes("inspect"),
    icon: OpenInNewRoundedIcon
  },
  { match: (command) => command.includes("folder"), icon: FolderOpenOutlinedIcon },
  {
    match: (command) => command.includes("capture") || command.includes("impairment"),
    icon: SettingsEthernetRoundedIcon
  },
  {
    match: (command) =>
      command.includes("delay") ||
      command.includes("jitter") ||
      command.includes("loss") ||
      command.includes("rate") ||
      command.includes("corruption"),
    icon: TuneRoundedIcon
  },
  {
    match: (command) =>
      command.includes("deploy") || command.includes("start") || command.includes("run"),
    icon: PlayArrowRoundedIcon
  },
  { match: (command) => command.includes("link"), icon: LinkRoundedIcon }
];

const ACTION_GROUP_RULES: ReadonlyArray<CommandActionGroupRule> = [
  { match: (command) => command.startsWith("containerlab.lab.graph."), group: "graph" },
  { match: (command) => command.includes(".save"), group: "save" },
  { match: (command) => command.startsWith("containerlab.lab.fcli."), group: "tools" },
  {
    match: (command) =>
      command.startsWith("containerlab.interface.") || command.includes("impairment"),
    group: "network"
  },
  {
    match: (command) => command.includes(".sshx.") || command.includes(".gotty."),
    group: "sharing"
  },
  { match: (command) => command.includes("copy"), group: "copy" },
  {
    match: (command) => command.includes("inspect") || command.includes("showlogs"),
    group: "inspect"
  },
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
      command.includes("filter") || command.includes("hide") || command.includes("show"),
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

export function actionIcon(action: ExplorerAction): SvgIconComponent {
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

  return BuildOutlinedIcon;
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
  topology: FolderOpenOutlinedIcon,
  graph: AccountTreeOutlinedIcon,
  lifecycle: PlayArrowRoundedIcon,
  save: SaveOutlinedIcon,
  access: TerminalRoundedIcon,
  sharing: LinkRoundedIcon,
  network: SettingsEthernetRoundedIcon,
  inspect: ManageSearchRoundedIcon,
  copy: ContentCopyOutlinedIcon,
  tools: BuildOutlinedIcon,
  view: FilterAltOutlinedIcon,
  danger: DeleteOutlineIcon,
  other: BuildOutlinedIcon
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

export function actionGroupIcon(groupId: ActionGroupId): SvgIconComponent {
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

export function groupActions(
  actions: ExplorerAction[],
  nodeKind: ExplorerNodeKind
): ExplorerActionGroup[] {
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

export function isInterfaceTimingAction(commandId: string): boolean {
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

export function withSectionDividers(
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
      items.push({
        id: `divider:${nodeKind}:${group.id}:${items.length}`,
        label: "",
        divider: true
      });
    }
    items.push(...rendered);
    previousSection = section;
  }
  return items;
}
