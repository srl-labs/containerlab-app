import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import CodeRoundedIcon from "@mui/icons-material/CodeRounded";
import DataObjectRoundedIcon from "@mui/icons-material/DataObjectRounded";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import FolderSpecialOutlinedIcon from "@mui/icons-material/FolderSpecialOutlined";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";
import TravelExploreOutlinedIcon from "@mui/icons-material/TravelExploreOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import type { ExplorerNode, ExplorerSectionId } from "../shared/explorer/types";
import { COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY } from "./constants";
import { isEndpointNode } from "./nodeState";

interface ExplorerLeadingIcon {
  Icon: SvgIconComponent;
  color: string;
}

interface FileIconRule {
  icon: SvgIconComponent;
  match: RegExp;
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
    return CodeRoundedIcon;
  }
  if (label.includes("download")) {
    return FileDownloadOutlinedIcon;
  }
  if (label.includes("find")) {
    return TravelExploreOutlinedIcon;
  }
  return MenuBookOutlinedIcon;
}

const DOCKERFILE_NAME_REGEX = /^dockerfile(?:\..*)?$/i;
const DOCKERFILE_EXTENSION_REGEX = /\.dockerfile$/i;

// One quiet glyph per kind of file; the tree stays monochrome so state colors stand out.
const FILE_ICON_RULES: FileIconRule[] = [
  { match: /\.clab\.ya?ml$/i, icon: AccountTreeOutlinedIcon },
  { match: /\.(ya?ml|jsonc?|toml|ini|conf|cfg|properties|env|sql|tf|tfvars|hcl|proto)$/i, icon: DataObjectRoundedIcon },
  { match: /\.(mdx?|txt|lic|license)$/i, icon: ArticleOutlinedIcon },
  { match: /\.(sh|bash|zsh|fish|ps1|bat|cmd)$/i, icon: TerminalRoundedIcon },
  {
    match: /\.(drawio|xml|xsd|svg|x?html?|css|scss|sass|less|[cm]?jsx?|tsx?|py|pyw|go|rs|c|cc|cpp|cxx|h|hpp|cs|java|php|rb)$/i,
    icon: CodeRoundedIcon
  }
];

function fileIconForNode(node: ExplorerNode, color: string): ExplorerLeadingIcon {
  const fileName = node.label.toLowerCase();
  if (DOCKERFILE_NAME_REGEX.test(fileName) || DOCKERFILE_EXTENSION_REGEX.test(fileName)) {
    return { Icon: ViewInArOutlinedIcon, color };
  }

  const rule = FILE_ICON_RULES.find((entry) => entry.match.test(fileName));
  return { Icon: rule?.icon ?? InsertDriveFileOutlinedIcon, color };
}

export function nodeLeadingIcon(
  node: ExplorerNode,
  sectionId: ExplorerSectionId,
  expanded = false
): ExplorerLeadingIcon | undefined {
  if (isHelpFeedbackLinkNode(node, sectionId)) {
    return { Icon: helpFeedbackIconForNode(node), color: COLOR_TEXT_SECONDARY };
  }

  const context = node.contextValue;
  if (isEndpointNode(context)) {
    return { Icon: DnsOutlinedIcon, color: COLOR_TEXT_SECONDARY };
  }
  if (context === "containerlabFolder" || context === "containerlabFileFolder") {
    return { Icon: expanded ? FolderOpenOutlinedIcon : FolderOutlinedIcon, color: COLOR_TEXT_SECONDARY };
  }
  if (context === "containerlabFileExplorerRoot") {
    return { Icon: FolderSpecialOutlinedIcon, color: COLOR_TEXT_SECONDARY };
  }
  if (context === "containerlabFileTopology") {
    return fileIconForNode(node, COLOR_TEXT_PRIMARY);
  }
  if (context === "containerlabFile") {
    return fileIconForNode(node, COLOR_TEXT_SECONDARY);
  }
  if (typeof context === "string" && context.includes("containerlabLabUndeployed")) {
    return { Icon: AccountTreeOutlinedIcon, color: COLOR_TEXT_SECONDARY };
  }
  return undefined;
}
