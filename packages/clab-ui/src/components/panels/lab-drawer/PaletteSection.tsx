// Node and annotation palette for the context panel.
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountTreeIcon from "@mui/icons-material/AccountTreeOutlined";
import AddIcon from "@mui/icons-material/Add";
import CableIcon from "@mui/icons-material/CableOutlined";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import ClearIcon from "@mui/icons-material/ClearOutlined";
import CropSquareIcon from "@mui/icons-material/CropSquareOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import DeviceHubIcon from "@mui/icons-material/DeviceHubOutlined";
import DnsIcon from "@mui/icons-material/DnsOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FileDownloadIcon from "@mui/icons-material/FileDownloadOutlined";
import FileUploadIcon from "@mui/icons-material/FileUploadOutlined";
import HubIcon from "@mui/icons-material/HubOutlined";
import LanIcon from "@mui/icons-material/LanOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PowerIcon from "@mui/icons-material/PowerOutlined";
import RemoveIcon from "@mui/icons-material/RemoveOutlined";
import SaveIcon from "@mui/icons-material/SaveOutlined";
import SearchIcon from "@mui/icons-material/SearchOutlined";
import SelectAllIcon from "@mui/icons-material/SelectAllOutlined";
import SpeedIcon from "@mui/icons-material/SpeedOutlined";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import TextFieldsIcon from "@mui/icons-material/TextFieldsOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { CustomNodeTemplate } from "../../../core/types/editors";
import {
  collectCustomIconsForTemplates,
  NODE_TEMPLATES_EXPORT_FILENAME,
  serializeCustomNodeTemplates
} from "../../../core/utilities/customNodeImportExport";
import type { CustomIconInfo } from "../../../core/types/icons";
import { DEFAULT_ICON_COLOR, getRoleIcon } from "../../../core/types/graph";
import { generateEncodedSVG } from "../../../icons/SvgGenerator";
import { useIconInk } from "../../../icons/iconInk";
import {
  useCustomIcons,
  useCustomNodes,
  useTopoViewerStore
} from "../../../stores/topoViewerStore";
import { useClabUiHost, useTopologySessionClient, useClabUiRuntime } from "../../../host";
import { buildCustomIconMap, getCustomIconUrl } from "../../../utils/iconUtils";
import { getNetworkNodeTypeColor } from "../../canvas/nodes/networkNodeShared";
import { applyPaletteDragPreview } from "./paletteDragPreview";
import type { TabDefinition } from "../../ui/editor";
import { TabNavigation } from "../../ui/editor/TabNavigation";
import { IconPreview, PanelSectionHeader } from "../../ui/form";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { saveSourceDraft } from "../../../services/editHistoryCommands";
import {
  closeSourceStep,
  discardSourceDraft,
  editSourceDraft,
  useEditHistoryStore
} from "../../../stores/editHistoryStore";
import { useUndoRedoControls } from "../../../hooks/app/useUndoRedoControls";
import { containerlabSchema } from "../../../core/schema/bundledSchema";
import { preloadMonacoCodeEditor } from "../../monaco/preloadMonacoCodeEditor";
import type { LabFileLinks } from "../../monaco/labFileLinks";
import type { MonacoEditDetails, MonacoSelection } from "../../monaco/MonacoCodeEditor";
import { useTopologyFileLinks } from "../../../hooks/editor/useLabFiles";

interface PaletteSectionProps {
  mode?: "edit" | "view";
  isLocked?: boolean;
  requestedTab?: { tabId: string };
  onEditCustomNode?: (nodeName: string) => void;
  onDeleteCustomNode?: (nodeName: string) => void;
  onSetDefaultCustomNode?: (nodeName: string) => void;
  editTabContent?: React.ReactNode;
  showEditTab?: boolean;
  /** Changes whenever an editor is explicitly opened; brings the Edit tab forward. */
  editorRequest?: number;
  editTabTitle?: string;
  onEditDelete?: () => void;
  onEditTabOpen?: () => void;
  onEditTabLeave?: () => void;
  infoTabContent?: React.ReactNode;
  showInfoTab?: boolean;
  infoTabTitle?: string;
}

interface NetworkTypeDefinition {
  readonly type: string;
  readonly label: string;
  readonly icon: React.ReactNode;
}

const NETWORK_TYPE_DEFINITIONS: readonly NetworkTypeDefinition[] = [
  { type: "host", label: "Host", icon: <DnsIcon fontSize="small" /> },
  { type: "mgmt-net", label: "Mgmt Net", icon: <LanIcon fontSize="small" /> },
  { type: "macvlan", label: "Macvlan", icon: <CableIcon fontSize="small" /> },
  { type: "vxlan", label: "VXLAN", icon: <DeviceHubIcon fontSize="small" /> },
  { type: "vxlan-stitch", label: "VXLAN Stitch", icon: <CableIcon fontSize="small" /> },
  { type: "dummy", label: "Dummy", icon: <PowerIcon fontSize="small" /> },
  { type: "bridge", label: "Bridge", icon: <AccountTreeIcon fontSize="small" /> },
  { type: "ovs-bridge", label: "OVS Bridge", icon: <HubIcon fontSize="small" /> }
];

function getTemplateIconUrl(
  template: CustomNodeTemplate,
  customIconMap: Map<string, string>,
  iconInk: string
): string {
  const role = template.icon ?? "pe";
  const customDataUri = customIconMap.get(role);
  if (customDataUri !== undefined && customDataUri.length > 0) {
    return getCustomIconUrl(customDataUri, template.iconColor);
  }
  const color = template.iconColor ?? DEFAULT_ICON_COLOR;
  return generateEncodedSVG(getRoleIcon(role), color, iconInk);
}

function downloadNodeTemplates(
  templates: CustomNodeTemplate[],
  customIcons: CustomIconInfo[]
): void {
  const icons = collectCustomIconsForTemplates(templates, customIcons);
  const blob = new Blob([serializeCustomNodeTemplates(templates, icons)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = NODE_TEMPLATES_EXPORT_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
}

const REACTFLOW_NODE_MIME_TYPE = "application/reactflow-node";
const ACTION_HOVER_BG = "action.hover";
const TEXT_SECONDARY = "text.secondary";
// Monaco is ~4MB of script: warm it only once the opened lab has settled.
// Hovering or opening a source tab loads it right away.
const MONACO_PRELOAD_DELAY_MS = 8000;
const PALETTE_ICON_SIZE = 28;
const PALETTE_LIST_SX = { display: "flex", flexDirection: "column", gap: 0.75 } as const;
const PALETTE_GRID_SX = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 } as const;
const PALETTE_SECTION_BODY_SX = { px: 2, pt: 1, pb: 0.5 } as const;
// Row actions stay out of the way until the row is hovered or focused.
const CARD_ACTIONS_CLASS = "palette-card-actions";

const PALETTE_CARD_SX = {
  display: "flex",
  alignItems: "center",
  gap: 1.25,
  minWidth: 0,
  minHeight: 44,
  px: 1,
  py: 0.75,
  border: 1,
  borderColor: "divider",
  borderRadius: controlRadius,
  cursor: "grab",
  transition: "background-color 120ms ease",
  "&:hover": { bgcolor: ACTION_HOVER_BG },
  "&:active": { cursor: "grabbing" },
  [`& .${CARD_ACTIONS_CLASS} .MuiIconButton-root`]: { transition: "opacity 120ms ease" },
  [`& .${CARD_ACTIONS_CLASS} [data-reveal]`]: { opacity: 0 },
  [`&:hover .${CARD_ACTIONS_CLASS} [data-reveal], & .${CARD_ACTIONS_CLASS} [data-reveal]:focus-visible`]:
    { opacity: 1 },
  "@media (hover: none)": { [`& .${CARD_ACTIONS_CLASS} [data-reveal]`]: { opacity: 1 } }
} as const;

/** A card that cannot be dragged right now: dimmed, no hover lift, not-allowed cursor. */
const PALETTE_CARD_BLOCKED_SX = {
  cursor: "not-allowed",
  opacity: 0.4,
  "&:hover": { bgcolor: "transparent" },
  "&:active": { cursor: "not-allowed" }
} as const;

const ROW_ICON_SX = { fontSize: 16 } as const;
const DESTRUCTIVE_HOVER_SX = {
  "&:hover": {
    color: "error.main",
    bgcolor: "color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent)"
  }
} as const;
const CANVAS_DRAG_FALLBACK_KEY = "__CLAB_UI_CANVAS_DRAG_DATA__";

type CanvasDragPayload = Record<string, unknown>;
type CanvasDragWindow = Window & {
  [CANVAS_DRAG_FALLBACK_KEY]?: {
    payload: CanvasDragPayload;
    timestamp: number;
  };
};

function isSourceTab(tabId: string): boolean {
  return tabId === "yaml" || tabId === "json";
}

function sourceTabTitle(
  tabId: string,
  yamlFileName: string,
  annotationsFileName: string
): string | undefined {
  const [kind, fileName] =
    tabId === "yaml" ? ["Topology", yamlFileName] : ["Annotations", annotationsFileName];
  if (!isSourceTab(tabId)) return undefined;
  return fileName ? `${kind} file: ${fileName}` : `${kind} file`;
}

const MonacoCodeEditor = React.lazy(preloadMonacoCodeEditor);

/** Stands in for the Save button while the source can't be edited. */
const ReadOnlyLabel: React.FC = () => (
  <Box
    data-testid="palette-source-readonly"
    sx={{ display: "flex", alignItems: "center", gap: 0.5, color: TEXT_SECONDARY, flexShrink: 0 }}
  >
    <LockOutlinedIcon sx={{ fontSize: 14 }} />
    <Typography variant="caption">Read-only</Typography>
  </Box>
);

const SourceEditorTab: React.FC<{
  readOnly: boolean;
  error: string | null;
  language: "yaml" | "json";
  value: string;
  jsonSchema?: object;
  fileLinks?: LabFileLinks;
  /** Set when the file changed (canvas edit, undo, another editor) since the unsaved edits began. */
  onDiscardStale?: () => void;
  onChange: (next: string, details: MonacoEditDetails) => void;
  onReadOnlyEditAttempt?: () => void;
  history: { undo: () => void; redo: () => void };
  restoreSelection?: MonacoSelection | null;
}> = ({
  readOnly,
  error,
  language,
  value,
  jsonSchema,
  fileLinks,
  onDiscardStale,
  onChange,
  onReadOnlyEditAttempt,
  history,
  restoreSelection
}) => (
  <Box sx={{ flex: 1, minHeight: 0, overflowY: "hidden", display: "flex", flexDirection: "column" }}>
    {error !== null && error.length > 0 && (
      <Typography variant="caption" color="error" sx={{ px: 2, py: 0.5 }}>
        {error}
      </Typography>
    )}
    {onDiscardStale && (
      <Alert
        severity="warning"
        data-testid="palette-source-stale"
        action={
          <Button color="inherit" size="small" onClick={onDiscardStale}>
            Discard edits
          </Button>
        }
        sx={{ borderRadius: 0, py: 0, alignItems: "center", "& .MuiAlert-message": { fontSize: 12 } }}
      >
        The file changed since you started editing. Saving replaces those changes.
      </Alert>
    )}
    {/* Read-only source shows no caret, so it doesn't invite typing. */}
    <Box
      sx={[
        { flex: 1, minHeight: 0 },
        readOnly && { "& .monaco-editor .cursors-layer": { display: "none" } }
      ]}
    >
      <Suspense
        fallback={
          <Box
            sx={{
              alignItems: "center",
              color: TEXT_SECONDARY,
              display: "flex",
              height: "100%",
              justifyContent: "center"
            }}
          >
            <Typography variant="caption">Loading editor...</Typography>
          </Box>
        }
      >
        <MonacoCodeEditor
          language={language}
          value={value}
          readOnly={readOnly}
          jsonSchema={jsonSchema}
          fileLinks={fileLinks}
          onChange={readOnly ? undefined : onChange}
          onReadOnlyEditAttempt={onReadOnlyEditAttempt}
          onBlur={closeSourceStep}
          history={history}
          restoreSelection={restoreSelection}
        />
      </Suspense>
    </Box>
  </Box>
);

/** Why palette cards in a section can't be dragged, and what to do when someone tries. */
interface PaletteBlock {
  reason: string;
  onAttempt?: () => void;
}

const PaletteBlockContext = React.createContext<PaletteBlock | null>(null);

const PaletteDraggableCard: React.FC<{
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd?: () => void;
  children: React.ReactNode;
}> = ({ onDragStart, onDragEnd, children }) => {
  const block = React.useContext(PaletteBlockContext);
  return (
    <Tooltip
      title={block?.reason ?? "Drag to canvas"}
      placement="top"
      enterDelay={block ? 0 : 500}
      slotProps={{ popper: { modifiers: [{ name: "offset", options: { offset: [-20, -20] } }] } }}
    >
      <Box
        draggable={!block}
        aria-disabled={block ? true : undefined}
        onDragStart={block ? undefined : onDragStart}
        onDragEnd={block ? undefined : onDragEnd}
        onMouseDown={
          block?.onAttempt
            ? (event: React.MouseEvent) => {
                if (event.button === 0) block.onAttempt?.();
              }
            : undefined
        }
        sx={block ? [PALETTE_CARD_SX, PALETTE_CARD_BLOCKED_SX] : PALETTE_CARD_SX}
      >
        {children}
      </Box>
    </Tooltip>
  );
};

/** Square tile behind palette glyphs, sized like a node icon so every row lines up. */
const PaletteGlyphTile: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      width: PALETTE_ICON_SIZE,
      height: PALETTE_ICON_SIZE,
      borderRadius: controlRadius,
      bgcolor: ACTION_HOVER_BG,
      color: TEXT_SECONDARY,
      "& .MuiSvgIcon-root": { fontSize: 16 }
    }}
  >
    {children}
  </Box>
);

const PaletteCardText: React.FC<{ title: string; subtitle: string; mono?: boolean }> = ({
  title,
  subtitle,
  mono = false
}) => (
  <Box sx={{ flex: 1, minWidth: 0 }}>
    <Typography
      variant="body2"
      noWrap
      sx={{ fontWeight: (theme) => theme.typography.fontWeightMedium, lineHeight: 1.35 }}
    >
      {title}
    </Typography>
    <Typography
      variant="caption"
      color={TEXT_SECONDARY}
      noWrap
      component="div"
      sx={{ lineHeight: 1.35, ...(mono ? { fontFamily: MONO_FONT_FAMILY } : undefined) }}
    >
      {subtitle}
    </Typography>
  </Box>
);

type AnnotationPayload = {
  annotationType: "text" | "shape" | "group" | "traffic-rate";
  shapeType?: string;
};

function setCanvasDragPayload(event: React.DragEvent, payload: CanvasDragPayload): void {
  const serialized = JSON.stringify(payload);
  event.dataTransfer.setData(REACTFLOW_NODE_MIME_TYPE, serialized);
  event.dataTransfer.effectAllowed = "move";
  (window as CanvasDragWindow)[CANVAS_DRAG_FALLBACK_KEY] = {
    payload,
    timestamp: Date.now()
  };
}

function clearCanvasDragPayload(): void {
  delete (window as CanvasDragWindow)[CANVAS_DRAG_FALLBACK_KEY];
}

interface DraggableNodeProps {
  template: CustomNodeTemplate;
  customIconMap: Map<string, string>;
  isDefault?: boolean;
  onEdit?: (name: string) => void;
  onDelete?: (name: string) => void;
  onSetDefault?: (name: string) => void;
}

const DraggableNode: React.FC<DraggableNodeProps> = ({
  template,
  customIconMap,
  isDefault,
  onEdit,
  onDelete,
  onSetDefault
}) => {
  const isDefaultNode = isDefault === true;
  const isBlocked = React.useContext(PaletteBlockContext) !== null;
  const iconInk = useIconInk();
  const iconUrl = useMemo(
    () => getTemplateIconUrl(template, customIconMap, iconInk),
    [template, customIconMap, iconInk]
  );

  const onDragStart = useCallback(
    (event: React.DragEvent) => {
      setCanvasDragPayload(event, {
        type: "node",
        templateName: template.name
      });
      applyPaletteDragPreview(event, {
        label: template.name,
        iconUrl,
        iconCornerRadius: template.iconCornerRadius
      });
    },
    [template.name, template.iconCornerRadius, iconUrl]
  );

  return (
    <PaletteDraggableCard onDragStart={onDragStart} onDragEnd={clearCanvasDragPayload}>
      <Box sx={{ display: "flex", flexShrink: 0 }}>
        <IconPreview
          src={iconUrl}
          size={PALETTE_ICON_SIZE}
          cornerRadius={template.iconCornerRadius}
        />
      </Box>
      <PaletteCardText title={template.name} subtitle={template.kind} mono />
      {isBlocked ? (
        isDefaultNode && (
          <StarIcon
            titleAccess="Default node"
            sx={{ ...ROW_ICON_SX, color: "warning.main", mx: 0.75 }}
          />
        )
      ) : (
        <Box className={CARD_ACTIONS_CLASS} sx={{ display: "flex", gap: 0.25 }}>
          <Tooltip title="Edit">
            <IconButton
              size="small"
              data-reveal
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(template.name);
              }}
            >
              <EditOutlinedIcon sx={ROW_ICON_SX} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              data-reveal
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(template.name);
              }}
              sx={DESTRUCTIVE_HOVER_SX}
            >
              <DeleteOutlinedIcon sx={ROW_ICON_SX} />
            </IconButton>
          </Tooltip>
          <Tooltip title={isDefaultNode ? "Default node" : "Set as default"}>
            <IconButton
              size="small"
              data-reveal={isDefaultNode ? undefined : true}
              onClick={(e) => {
                e.stopPropagation();
                if (!isDefaultNode) onSetDefault?.(template.name);
              }}
              sx={isDefaultNode ? { color: "warning.main" } : undefined}
            >
              {isDefaultNode ? <StarIcon sx={ROW_ICON_SX} /> : <StarOutlineIcon sx={ROW_ICON_SX} />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </PaletteDraggableCard>
  );
};

interface DraggableAnnotationProps {
  label: string;
  kind: string;
  icon: React.ReactNode;
  payload: AnnotationPayload;
}

interface PaletteSimpleDraggableProps {
  dragPayload: Record<string, unknown>;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  monoSubtitle?: boolean;
  previewIconUrl?: string;
}

const PaletteSimpleDraggable: React.FC<PaletteSimpleDraggableProps> = ({
  dragPayload,
  icon,
  label,
  subtitle,
  monoSubtitle,
  previewIconUrl
}) => {
  const onDragStart = useCallback(
    (event: React.DragEvent) => {
      setCanvasDragPayload(event, dragPayload);
      applyPaletteDragPreview(event, {
        label,
        iconUrl: previewIconUrl,
        iconElement: event.currentTarget.querySelector("svg")
      });
    },
    [dragPayload, label, previewIconUrl]
  );

  return (
    <PaletteDraggableCard onDragStart={onDragStart} onDragEnd={clearCanvasDragPayload}>
      <PaletteGlyphTile>{icon}</PaletteGlyphTile>
      <PaletteCardText title={label} subtitle={subtitle} mono={monoSubtitle} />
    </PaletteDraggableCard>
  );
};

const DraggableNetwork: React.FC<{ network: NetworkTypeDefinition }> = ({ network }) => {
  const iconInk = useIconInk();
  return (
    <PaletteSimpleDraggable
      dragPayload={{ type: "network", networkType: network.type }}
      icon={network.icon}
      label={network.label}
      subtitle={network.type}
      monoSubtitle
      previewIconUrl={generateEncodedSVG("cloud", getNetworkNodeTypeColor(network.type), iconInk)}
    />
  );
};

const DraggableAnnotation: React.FC<DraggableAnnotationProps> = ({
  label,
  kind,
  icon,
  payload
}) => (
  <PaletteSimpleDraggable
    dragPayload={{ type: "annotation", ...payload }}
    icon={icon}
    label={label}
    subtitle={kind}
  />
);

const PALETTE_TABS: TabDefinition[] = [
  { id: "info", label: "Info" },
  { id: "edit", label: "Edit" },
  { id: "nodes", label: "Nodes" },
  { id: "annotations", label: "Annotations" },
  { id: "yaml", label: "YAML" },
  { id: "json", label: "JSON" }
];

/* eslint-disable complexity */
export const PaletteSection: React.FC<PaletteSectionProps> = ({
  mode = "edit",
  isLocked = false,
  requestedTab,
  onEditCustomNode,
  onDeleteCustomNode,
  onSetDefaultCustomNode,
  editTabContent,
  showEditTab = false,
  editorRequest = 0,
  editTabTitle,
  onEditDelete,
  onEditTabOpen,
  onEditTabLeave,
  infoTabContent,
  showInfoTab = false,
  infoTabTitle
}) => {
  const sessionClient = useTopologySessionClient();
  const { customPaletteTabs, disabledTabIds, yamlSchema, paletteTabLabels } = useClabUiRuntime();
  const customNodes = useCustomNodes();
  const customIcons = useCustomIcons();
  const defaultNode = useTopoViewerStore((state) => state.defaultNode);
  const yamlFileName = useTopoViewerStore((state) => state.yamlFileName);
  const annotationsFileName = useTopoViewerStore((state) => state.annotationsFileName);
  const yamlContent = useTopoViewerStore((state) => state.yamlContent);
  const annotationsContent = useTopoViewerStore((state) => state.annotationsContent);
  const [filter, setFilter] = useState("");
  const isViewMode = mode === "view";
  const nudgeLock = useTopoViewerStore((state) => state.nudgeLock);
  // The lock wins: unlocking is the one thing that helps. Deployed labs (view
  // mode) take annotations but not new nodes or networks.
  const lockBlock = useMemo<PaletteBlock | null>(
    () => (isLocked ? { reason: "Unlock lab to edit", onAttempt: nudgeLock } : null),
    [isLocked, nudgeLock]
  );
  const nodesBlock = useMemo<PaletteBlock | null>(() => {
    if (lockBlock) return lockBlock;
    return isViewMode ? { reason: "Nodes can't be added while the lab is deployed" } : null;
  }, [lockBlock, isViewMode]);

  const visibleTabs = useMemo(
    () => {
      const base = PALETTE_TABS.filter((t) => {
        if (t.id === "info" && !showInfoTab) return false;
        if (t.id === "edit" && !showEditTab) return false;
        if (disabledTabIds?.includes(t.id)) return false;
        return true;
      }).map((t) => ({
        id: t.id,
        label: paletteTabLabels?.[t.id] ?? t.label,
        // The source tabs name the file they edit.
        title: sourceTabTitle(t.id, yamlFileName, annotationsFileName)
      }));
      const custom = (customPaletteTabs ?? [])
        .map((t) => ({ id: t.id, label: t.label }))
        .filter((t) => !disabledTabIds?.includes(t.id));
      return [...base, ...custom];
    },
    [
      showInfoTab,
      showEditTab,
      customPaletteTabs,
      disabledTabIds,
      paletteTabLabels,
      yamlFileName,
      annotationsFileName
    ]
  );

  const [userTab, setUserTab] = useState("nodes");

  useEffect(() => {
    const requestedTabId = requestedTab?.tabId;
    if (
      requestedTabId !== undefined &&
      requestedTabId.length > 0 &&
      visibleTabs.some((t) => t.id === requestedTabId)
    ) {
      setUserTab(requestedTabId);
    }
  }, [requestedTab, visibleTabs]);

  // Auto-switch when edit/info tab appears (one-time, not forced). Info wins
  // while a selection resolves to an info view (deployed labs, read-only view
  // mode); active editors clear showInfoTab because editing states take
  // priority in useContextPanelContent, so they land on the edit tab.
  useEffect(() => {
    if (showEditTab && !showInfoTab) setUserTab("edit");
  }, [showEditTab, showInfoTab]);

  useEffect(() => {
    if (showInfoTab) setUserTab("info");
  }, [showInfoTab]);

  // Opening an editor (context menu, double-click) also brings its tab forward
  // when the Edit tab was already open behind another tab.
  const handledEditorRequest = useRef(editorRequest);
  useEffect(() => {
    if (editorRequest === handledEditorRequest.current) return;
    handledEditorRequest.current = editorRequest;
    if (showEditTab) setUserTab("edit");
  }, [editorRequest, showEditTab]);

  // Fall back to the first visible tab when current tab is no longer visible.
  useEffect(() => {
    if (visibleTabs.some((t) => t.id === userTab)) return;
    setUserTab(visibleTabs[0]?.id ?? "");
  }, [visibleTabs, userTab]);

  const activeTab = userTab;

  useEffect(() => {
    let idleCallbackId: number | null = null;
    const timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleCallbackId = window.requestIdleCallback(() => {
          void preloadMonacoCodeEditor();
        });
        return;
      }
      void preloadMonacoCodeEditor();
    }, MONACO_PRELOAD_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
      if (idleCallbackId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, []);

  useEffect(() => {
    if (isSourceTab(activeTab)) {
      void preloadMonacoCodeEditor();
    }
  }, [activeTab]);

  const handleSourceTabIntent = useCallback((event: React.SyntheticEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const tabId = target.closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (tabId !== undefined && isSourceTab(tabId)) {
      void preloadMonacoCodeEditor();
    }
  }, []);

  const [yamlError, setYamlError] = useState<string | null>(null);
  const [annotationsError, setAnnotationsError] = useState<string | null>(null);
  // Drafts live in the edit history store, so undo can put them back from anywhere.
  const yamlDraftState = useEditHistoryStore((state) => state.drafts.yaml);
  const annotationsDraftState = useEditHistoryStore((state) => state.drafts.json);
  const selectionRestore = useEditHistoryStore((state) => state.selectionRestore);
  // The host content local edits started from; null while the draft follows the host.
  const yamlDraftBase = yamlDraftState.base;
  const annotationsDraftBase = annotationsDraftState.base;
  const yamlDraft = yamlDraftBase === null ? yamlContent : yamlDraftState.text;
  const annotationsDraft =
    annotationsDraftBase === null ? annotationsContent : annotationsDraftState.text;
  // Edits back to the saved text are no edits, and saving them would add an empty undo step.
  const yamlDirty = yamlDraftBase !== null && yamlDraft !== yamlContent;
  const annotationsDirty = annotationsDraftBase !== null && annotationsDraft !== annotationsContent;
  const isSourceReadOnly = isLocked;
  const fileLinks = useTopologyFileLinks();
  const sourceHistory = useUndoRedoControls();

  useEffect(() => {
    setYamlError(null);
  }, [yamlFileName]);

  useEffect(() => {
    setAnnotationsError(null);
  }, [annotationsFileName]);

  const handleYamlDraftChange = useCallback(
    (next: string, details: MonacoEditDetails) => {
      editSourceDraft("yaml", next, yamlContent, details);
    },
    [yamlContent]
  );

  const handleAnnotationsDraftChange = useCallback(
    (next: string, details: MonacoEditDetails) => {
      editSourceDraft("json", next, annotationsContent, details);
    },
    [annotationsContent]
  );

  const discardYamlDraft = useCallback(() => {
    discardSourceDraft("yaml");
    setYamlError(null);
  }, []);

  const discardAnnotationsDraft = useCallback(() => {
    discardSourceDraft("json");
    setAnnotationsError(null);
  }, []);

  const filteredNodes = useMemo(() => {
    if (!filter) return customNodes;
    const search = filter.toLowerCase();
    return customNodes.filter((node) => {
      const nodeIcon = typeof node.icon === "string" ? node.icon : undefined;
      return (
        node.name.toLowerCase().includes(search) ||
        node.kind.toLowerCase().includes(search) ||
        (nodeIcon !== undefined && nodeIcon.toLowerCase().includes(search))
      );
    });
  }, [customNodes, filter]);
  const customIconMap = useMemo(() => buildCustomIconMap(customIcons), [customIcons]);

  const filteredNetworks = useMemo(() => {
    if (!filter) return NETWORK_TYPE_DEFINITIONS;
    const search = filter.toLowerCase();
    return NETWORK_TYPE_DEFINITIONS.filter(
      (net) => net.label.toLowerCase().includes(search) || net.type.toLowerCase().includes(search)
    );
  }, [filter]);

  const handleAddNewNode = useCallback(() => {
    onEditCustomNode?.("__new__");
  }, [onEditCustomNode]);

  const { topoViewer } = useClabUiHost();

  const handleImportTemplates = useCallback(() => {
    topoViewer.importCustomNodes();
  }, [topoViewer]);

  const handleExportTemplates = useCallback(() => {
    downloadNodeTemplates(customNodes, customIcons);
  }, [customIcons, customNodes]);

  const drawerTitle = useMemo(() => {
    if (activeTab === "info") return infoTabTitle ?? "Properties";
    if (activeTab === "edit") return editTabTitle ?? "Editor";
    if (activeTab === "nodes" || activeTab === "annotations") return "Palette";
    if (activeTab === "yaml") return yamlFileName || "Topology";
    if (activeTab === "json") return annotationsFileName || "Annotations";
    const custom = customPaletteTabs?.find((t) => t.id === activeTab);
    if (custom) return custom.label;
    return "";
  }, [activeTab, yamlFileName, annotationsFileName, editTabTitle, infoTabTitle, customPaletteTabs]);

  const handleSaveYaml = useCallback(async () => {
    try {
      await saveSourceDraft("yaml", sessionClient);
      setYamlError(null);
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionClient]);

  const handleSaveAnnotations = useCallback(async () => {
    try {
      await saveSourceDraft("json", sessionClient);
      setAnnotationsError(null);
    } catch (err) {
      setAnnotationsError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionClient]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          pl: 2,
          pr: 1.5,
          height: 40,
          flexShrink: 0
        }}
      >
        <Typography variant="subtitle1" noWrap>
          {drawerTitle}
        </Typography>
        {activeTab === "edit" && onEditDelete && !isLocked && (
          <IconButton size="small" onClick={onEditDelete} title="Delete" sx={DESTRUCTIVE_HOVER_SX}>
            <DeleteOutlinedIcon fontSize="small" />
          </IconButton>
        )}
        {isSourceTab(activeTab) && isSourceReadOnly && <ReadOnlyLabel />}
        {activeTab === "yaml" && !isSourceReadOnly && (
          <IconButton
            size="small"
            onClick={() => {
              handleSaveYaml().catch(() => undefined);
            }}
            disabled={!yamlDirty}
            title="Save"
          >
            <SaveIcon fontSize="small" />
          </IconButton>
        )}
        {activeTab === "json" && !isSourceReadOnly && (
          <IconButton
            size="small"
            onClick={() => {
              handleSaveAnnotations().catch(() => undefined);
            }}
            disabled={!annotationsDirty}
            title="Save"
          >
            <SaveIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      <Box onPointerOver={handleSourceTabIntent} onFocusCapture={handleSourceTabIntent}>
        <TabNavigation
          tabs={visibleTabs}
          activeTab={activeTab}
          onTabChange={(id) => {
            if (isSourceTab(id)) {
              void preloadMonacoCodeEditor();
            }
            if (activeTab === "edit" && id !== "edit") {
              onEditTabLeave?.();
            }
            if (id === "edit" && activeTab !== "edit") {
              onEditTabOpen?.();
            }
            setUserTab(id);
          }}
        />
      </Box>
      {(activeTab === "nodes" || activeTab === "annotations") && (
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {activeTab === "nodes" && (
            <PaletteBlockContext.Provider value={nodesBlock}>
              <Box sx={{ px: 2, pt: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search nodes..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon sx={ROW_ICON_SX} />
                        </InputAdornment>
                      ),
                      endAdornment: filter ? (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setFilter("")}>
                            <ClearIcon sx={ROW_ICON_SX} />
                          </IconButton>
                        </InputAdornment>
                      ) : undefined
                    }
                  }}
                />
              </Box>

              <PanelSectionHeader
                title="Node Templates"
                action={
                  !filter && !isLocked ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, mr: -0.5 }}>
                      <Tooltip title="Import templates">
                        <IconButton
                          size="small"
                          onClick={handleImportTemplates}
                          data-testid="palette-import-templates"
                        >
                          <FileUploadIcon sx={ROW_ICON_SX} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Export templates">
                        <span>
                          <IconButton
                            size="small"
                            onClick={handleExportTemplates}
                            disabled={customNodes.length === 0}
                            data-testid="palette-export-templates"
                          >
                            <FileDownloadIcon sx={ROW_ICON_SX} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Button
                        variant="text"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={handleAddNewNode}
                        sx={{ minHeight: 24, py: 0 }}
                      >
                        Add
                      </Button>
                    </Box>
                  ) : undefined
                }
              />
              <Box sx={[PALETTE_LIST_SX, PALETTE_SECTION_BODY_SX]}>
                {filteredNodes.length === 0 && (
                  <Typography variant="body2" color={TEXT_SECONDARY} sx={{ py: 0.5 }}>
                    {filter ? "No matching templates" : "No node templates defined"}
                  </Typography>
                )}
                {filteredNodes.map((template) => (
                  <DraggableNode
                    key={template.name}
                    template={template}
                    customIconMap={customIconMap}
                    isDefault={template.name === defaultNode || template.setDefault}
                    onEdit={onEditCustomNode}
                    onDelete={onDeleteCustomNode}
                    onSetDefault={onSetDefaultCustomNode}
                  />
                ))}
              </Box>

              <PanelSectionHeader title="Networks" />
              <Box sx={[PALETTE_GRID_SX, PALETTE_SECTION_BODY_SX]}>
                {filteredNetworks.length === 0 ? (
                  <Typography
                    variant="body2"
                    color={TEXT_SECONDARY}
                    sx={{ gridColumn: "1 / -1", py: 0.5 }}
                  >
                    No matching networks
                  </Typography>
                ) : (
                  filteredNetworks.map((network) => (
                    <DraggableNetwork key={network.type} network={network} />
                  ))
                )}
              </Box>
            </PaletteBlockContext.Provider>
          )}

          {activeTab === "annotations" && (
            <PaletteBlockContext.Provider value={lockBlock}>
              <PanelSectionHeader title="Text" />
              <Box sx={[PALETTE_GRID_SX, PALETTE_SECTION_BODY_SX]}>
                <DraggableAnnotation
                  label="Text"
                  kind="annotation"
                  icon={<TextFieldsIcon fontSize="small" />}
                  payload={{ annotationType: "text" }}
                />
              </Box>

              <PanelSectionHeader title="Shapes" />
              <Box sx={[PALETTE_GRID_SX, PALETTE_SECTION_BODY_SX]}>
                <DraggableAnnotation
                  label="Rectangle"
                  kind="shape"
                  icon={<CropSquareIcon fontSize="small" />}
                  payload={{ annotationType: "shape", shapeType: "rectangle" }}
                />
                <DraggableAnnotation
                  label="Circle"
                  kind="shape"
                  icon={<CircleOutlinedIcon fontSize="small" />}
                  payload={{ annotationType: "shape", shapeType: "circle" }}
                />
                <DraggableAnnotation
                  label="Line"
                  kind="shape"
                  icon={<RemoveIcon fontSize="small" />}
                  payload={{ annotationType: "shape", shapeType: "line" }}
                />
              </Box>

              <PanelSectionHeader title="Groups" />
              <Box sx={[PALETTE_GRID_SX, PALETTE_SECTION_BODY_SX]}>
                <DraggableAnnotation
                  label="Group"
                  kind="annotation"
                  icon={<SelectAllIcon fontSize="small" />}
                  payload={{ annotationType: "group" }}
                />
              </Box>

              <PanelSectionHeader title="Monitoring" />
              <Box sx={[PALETTE_GRID_SX, PALETTE_SECTION_BODY_SX]}>
                <DraggableAnnotation
                  label="Traffic Rate"
                  kind="monitor"
                  icon={<SpeedIcon fontSize="small" />}
                  payload={{ annotationType: "traffic-rate" }}
                />
              </Box>
            </PaletteBlockContext.Provider>
          )}
        </Box>
      )}

      {activeTab === "yaml" && (
        <SourceEditorTab
          readOnly={isSourceReadOnly}
          onReadOnlyEditAttempt={lockBlock?.onAttempt}
          error={yamlError}
          language="yaml"
          value={yamlDraft}
          jsonSchema={yamlSchema ?? containerlabSchema}
          fileLinks={fileLinks}
          onDiscardStale={
            yamlDirty && yamlDraftBase !== yamlContent ? discardYamlDraft : undefined
          }
          onChange={handleYamlDraftChange}
          history={sourceHistory}
          restoreSelection={selectionRestore?.file === "yaml" ? selectionRestore.selection : null}
        />
      )}

      {activeTab === "json" && (
        <SourceEditorTab
          readOnly={isSourceReadOnly}
          onReadOnlyEditAttempt={lockBlock?.onAttempt}
          error={annotationsError}
          language="json"
          value={annotationsDraft}
          onDiscardStale={
            annotationsDirty && annotationsDraftBase !== annotationsContent
              ? discardAnnotationsDraft
              : undefined
          }
          onChange={handleAnnotationsDraftChange}
          history={sourceHistory}
          restoreSelection={selectionRestore?.file === "json" ? selectionRestore.selection : null}
        />
      )}

      {activeTab === "info" && (
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>{infoTabContent}</Box>
      )}

      {activeTab === "edit" && (
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>{editTabContent}</Box>
      )}

      {(() => {
        const custom = customPaletteTabs?.find((t) => t.id === activeTab);
        if (custom) {
          return (
            <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              {custom.render()}
            </Box>
          );
        }
        return null;
      })()}
    </Box>
  );
};
/* eslint-enable complexity */
