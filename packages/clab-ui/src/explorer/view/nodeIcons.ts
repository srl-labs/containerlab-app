import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import CodeIcon from "@mui/icons-material/Code";
import CssIcon from "@mui/icons-material/Css";
import DataObjectOutlinedIcon from "@mui/icons-material/DataObjectOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import FolderIcon from "@mui/icons-material/Folder";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import HtmlIcon from "@mui/icons-material/Html";
import JavascriptIcon from "@mui/icons-material/Javascript";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import SearchIcon from "@mui/icons-material/Search";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import SourceIcon from "@mui/icons-material/Source";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { SvgIconComponent } from "@mui/icons-material";
import type { ExplorerNode, ExplorerSectionId } from "../shared/explorer/types";
import { COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY } from "./constants";
import { isEndpointNode } from "./nodeState";

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
  {
    match: /\.(drawio|xml|xsd|svg|xhtml|xaml|plist|gml|kml|wsdl)$/i,
    icon: CodeIcon,
    color: "#e37933"
  },
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

export function nodeLeadingIcon(
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
