import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import React from "react";
import { createRoot } from "react-dom/client";

import { ClabUiRuntimeProvider, useClabUiHost, type ClabUiRuntime } from "../host";
import { useSchema } from "../hooks/editor/useSchema";
import { MuiThemeProvider } from "../theme/index";
import { controlRadius } from "../theme/surfaces";
import { MONO_FONT_FAMILY } from "../theme/typography";
import { buildKindImageCatalog, pullableImagesForEntry } from "./catalog";
import { isPlaceholderImageReference } from "./kindGuidance";
import type {
  ContainerImageSummary,
  ImageManagerEndpointOption,
  ImageManagerInitialData,
  KindImageCatalogEntry,
  KindImageCatalogSnapshot
} from "./types";

type CatalogFilter = "all" | "missing" | "pullable" | "local";
const CATALOG_FILTER_OPTIONS: ReadonlyArray<{ value: CatalogFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "missing", label: "Missing" },
  { value: "pullable", label: "Pullable" },
  { value: "local", label: "Local" }
];
const LOCAL_IMAGE_DISPLAY_LIMIT = 12;
const OTHER_LOCAL_IMAGE_DISPLAY_LIMIT = 80;
const DOC_LINK_SX = {
  display: "inline-flex",
  alignItems: "center",
  gap: 0.25,
  "& .MuiSvgIcon-root": { fontSize: 12 }
} as const;

type RowStatus = "notLocal" | "ok" | "neutral";
type ChipTone = "default" | "success" | "warning" | "info" | "accent";

interface RowStatusInfo {
  status: RowStatus;
  label: string;
  tone: ChipTone;
  icon: React.ReactNode;
}

interface ContainerlabImageManagerProps {
  endpointOptions?: ImageManagerEndpointOption[];
  initialEndpointId?: string;
  onClose?: () => void;
}

interface ContainerlabImageManagerDialogProps extends ContainerlabImageManagerProps {
  open: boolean;
  runtime: ClabUiRuntime;
}

function imageDisplayName(image: ContainerImageSummary): string {
  return image.repoTags[0] ?? image.repoDigests[0] ?? image.shortId ?? image.id;
}

function imageSecondaryText(image: ContainerImageSummary): string {
  const parts = [image.size, image.createdAt].filter(
    (value): value is string | number => value !== undefined && value !== ""
  );
  return parts.map(String).join(" · ");
}

function copyToClipboard(value: string): void {
  void navigator.clipboard?.writeText(value).catch(() => undefined);
}

function looksLikeHtmlMarkup(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^<!doctype\s+html[\s>]/i.test(trimmed) ||
    (/^<[a-z][\s\S]*>\s*$/i.test(trimmed) && /<\/[a-z][^>]*>/i.test(trimmed))
  );
}

function textFromHtmlMarkup(value: string): string {
  if (!looksLikeHtmlMarkup(value)) {
    return value.trim();
  }

  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(value, "text/html");
    const text = parsed.body.textContent?.replace(/\s+/g, " ").trim();
    if (text) {
      return text;
    }
  }

  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNotificationMessage(value: unknown, fallback: string): string {
  let raw = "";
  if (value instanceof Error) {
    raw = value.message;
  } else if (typeof value === "string") {
    raw = value;
  }
  return textFromHtmlMarkup(raw).trim() || fallback;
}

function entryMatchesFilter(entry: KindImageCatalogEntry, filter: CatalogFilter): boolean {
  switch (filter) {
    case "missing":
      return entry.guidance.imageRequired && entry.missingImages.length > 0;
    case "pullable":
      return pullableImagesForEntry(entry).length > 0;
    case "local":
      return entry.localImages.length > 0;
    default:
      return true;
  }
}

function pullCandidatesForEntry(entry: KindImageCatalogEntry): string[] {
  return pullableImagesForEntry(entry);
}

function missingImageStatusLabel(entry: KindImageCatalogEntry): string {
  const count = entry.missingImages.length;
  switch (entry.guidance.preparation.mode) {
    case "direct-pull":
      return `${count} to pull`;
    case "vrnetlab":
      return `${count} to build`;
    case "vendor-import":
      return `${count} to import`;
    default:
      return `${count} missing`;
  }
}

function copyCandidateForEntry(entry: KindImageCatalogEntry): string {
  return (
    entry.references[0]?.image ??
    entry.guidance.recommendedImages.find((image) => !isPlaceholderImageReference(image)) ??
    entry.guidance.recommendedImages[0] ??
    ""
  );
}

function preparationChipTone(
  mode: KindImageCatalogEntry["guidance"]["preparation"]["mode"]
): ChipTone {
  switch (mode) {
    case "direct-pull":
      return "success";
    case "vrnetlab":
      return "warning";
    case "vendor-import":
      return "accent";
    case "none":
      return "default";
    default:
      return "info";
  }
}

/** Palette paths per tone; the theme resolves them to host colors. */
const TONE_COLORS: Record<ChipTone, "success" | "warning" | "info" | "primary" | "text"> = {
  success: "success",
  warning: "warning",
  info: "info",
  accent: "primary",
  default: "text"
};

function toneColor(theme: Theme, tone: ChipTone): string {
  const key = TONE_COLORS[tone];
  return key === "text" ? theme.palette.text.secondary : theme.palette[key].main;
}

function chipToneSx(tone: ChipTone, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    color: "text.primary",
    bgcolor:
      tone === "default"
        ? "transparent"
        : (theme: Theme) => `color-mix(in srgb, ${toneColor(theme, tone)} 10%, transparent)`,
    borderColor:
      tone === "default"
        ? "divider"
        : (theme: Theme) =>
            `color-mix(in srgb, ${toneColor(theme, tone)} 55%, ${theme.palette.divider})`,
    ...extra
  };
}

/** A quiet status line: a tone-colored glyph followed by muted text, no box. */
function StatusText({
  tone,
  icon,
  label
}: {
  tone: ChipTone;
  icon: React.ReactNode;
  label: string;
}): React.JSX.Element {
  return (
    <Typography
      component="span"
      variant="body2"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        color: "text.secondary",
        "& .MuiSvgIcon-root": {
          fontSize: 14,
          color: (theme: Theme) => toneColor(theme, tone)
        }
      }}
    >
      {icon}
      {label}
    </Typography>
  );
}

function imageRefChipTone(color: ImageRefChipProps["color"]): ChipTone {
  if (color === "warning") {
    return "warning";
  }
  if (color === "info") {
    return "info";
  }
  return "default";
}

function rowStatusInfo(entry: KindImageCatalogEntry): RowStatusInfo {
  if (entry.missingImages.length > 0) {
    return {
      status: "notLocal",
      label: missingImageStatusLabel(entry),
      tone: "warning",
      icon: <ErrorOutlineIcon fontSize="inherit" />
    };
  }
  if (entry.localImages.length > 0) {
    return {
      status: "ok",
      label: `${entry.localImages.length} local`,
      tone: "success",
      icon: <CheckCircleOutlineIcon fontSize="inherit" />
    };
  }
  return {
    status: "neutral",
    label: "Not local",
    tone: "default",
    icon: <Inventory2OutlinedIcon fontSize="inherit" />
  };
}

function buildEmptyCatalog(): KindImageCatalogSnapshot {
  return {
    entries: [],
    images: [],
    references: [],
    unreferencedLocalImages: []
  };
}

interface ImageRefChipProps {
  label: string;
  variant?: "filled" | "outlined";
  color?: "default" | "info" | "warning";
  tooltip?: string;
  onCopy?: () => void;
  onDelete?: () => void;
  deleteIcon?: React.ReactElement;
  disabled?: boolean;
}

function ImageRefChip({
  label,
  variant = "outlined",
  color = "default",
  tooltip,
  onCopy,
  onDelete,
  deleteIcon,
  disabled = false
}: ImageRefChipProps): React.JSX.Element {
  const tone = imageRefChipTone(color);
  const chip = (
    <Chip
      size="small"
      label={label}
      variant={variant}
      color="default"
      onClick={onCopy}
      icon={onCopy ? <ContentCopyIcon /> : undefined}
      onDelete={onDelete}
      deleteIcon={deleteIcon}
      disabled={disabled}
      sx={chipToneSx(tone, {
        maxWidth: 320,
        fontFamily: MONO_FONT_FAMILY,
        fontWeight: 400,
        "& .MuiChip-icon": { color: "text.secondary", fontSize: 12, ml: 0.75, mr: -0.25 },
        "& .MuiChip-deleteIcon": { fontSize: 14, "&:hover": { color: "error.main" } },
        "& .MuiChip-label": {
          overflow: "hidden",
          textOverflow: "ellipsis",
          px: 0.75
        }
      })}
    />
  );

  if (!tooltip) return chip;
  return (
    <Tooltip title={tooltip} arrow placement="top">
      {chip}
    </Tooltip>
  );
}

interface KindRowProps {
  entry: KindImageCatalogEntry;
  actionBusy: boolean;
  onPull: (image: string, kind: string) => void;
  onRemove: (reference: string) => void;
}

function KindRow({ entry, actionBusy, onPull, onRemove }: KindRowProps): React.JSX.Element {
  const status = rowStatusInfo(entry);
  const pullCandidates = pullCandidatesForEntry(entry);
  const copyCandidate = copyCandidateForEntry(entry);
  const visibleLocalImages = entry.localImages.slice(0, LOCAL_IMAGE_DISPLAY_LIMIT);
  const remainingLocal = entry.localImages.length - visibleLocalImages.length;
  let pullTooltip = "No registry pull needed";
  if (pullCandidates.length > 0) {
    pullTooltip = `Pull ${pullCandidates[0]}`;
  } else if (entry.missingImages.length > 0) {
    pullTooltip = entry.guidance.preparation.details;
  }

  return (
    <TableRow
      hover
      sx={{
        verticalAlign: "top",
        "& > td": { py: 1.25 }
      }}
    >
      <TableCell sx={{ width: 240 }}>
        <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
          <Typography variant="subtitle2">{entry.guidance.title}</Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              fontFamily: MONO_FONT_FAMILY,
              wordBreak: "break-all"
            }}
          >
            {entry.kind}
          </Typography>
          <StatusText tone={status.tone} icon={status.icon} label={status.label} />
          {entry.types.length > 0 ? (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary"
              }}
            >
              {entry.types.length} type{entry.types.length === 1 ? "" : "s"}
            </Typography>
          ) : null}
        </Stack>
      </TableCell>

      <TableCell sx={{ minWidth: 380 }}>
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1.5}
            useFlexGap
            sx={{
              alignItems: "center",
              flexWrap: "wrap"
            }}
          >
            <Chip
              size="small"
              color="default"
              variant="outlined"
              label={entry.guidance.preparation.label}
              sx={chipToneSx(preparationChipTone(entry.guidance.preparation.mode))}
            />
            <Link href={entry.guidance.docsUrl} target="_blank" rel="noreferrer" sx={DOC_LINK_SX}>
              kind docs
              <OpenInNewIcon />
            </Link>
            {entry.guidance.preparation.docsUrl ? (
              <Link
                href={entry.guidance.preparation.docsUrl}
                target="_blank"
                rel="noreferrer"
                sx={DOC_LINK_SX}
              >
                vrnetlab
                <OpenInNewIcon />
              </Link>
            ) : null}
          </Stack>
          <Typography variant="body2">{entry.guidance.guidance}</Typography>
          {entry.guidance.recommendedImages.length === 0 ? null : (
            <Stack spacing={0.5}>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary"
                }}
              >
                Recommended
              </Typography>
              <Stack
                direction="row"
                sx={{
                  flexWrap: "wrap",
                  gap: 0.75
                }}
              >
                {entry.guidance.recommendedImages.map((image) => {
                  const placeholder = isPlaceholderImageReference(image);
                  return (
                    <ImageRefChip
                      key={`${entry.kind}:rec:${image}`}
                      label={image}
                      variant="outlined"
                      color="default"
                      tooltip={
                        placeholder
                          ? "Replace <version> with the version you have"
                          : "Click to copy reference"
                      }
                      onCopy={placeholder ? undefined : () => copyToClipboard(image)}
                    />
                  );
                })}
              </Stack>
            </Stack>
          )}
          {entry.references.length > 0 ? (
            <Stack spacing={0.5}>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary"
                }}
              >
                Used in topology
              </Typography>
              <Stack
                direction="row"
                sx={{
                  flexWrap: "wrap",
                  gap: 0.75
                }}
              >
                {entry.references.slice(0, 6).map((reference) => (
                  <ImageRefChip
                    key={`${entry.kind}:ref:${reference.label}:${reference.image}`}
                    label={reference.image}
                    variant="outlined"
                    color={
                      isPlaceholderImageReference(reference.image) ||
                      entry.missingImages.includes(reference.image)
                        ? "warning"
                        : "default"
                    }
                    tooltip={`${reference.label} · ${reference.source}`}
                    onCopy={() => copyToClipboard(reference.image)}
                  />
                ))}
                {entry.references.length > 6 ? (
                  <Chip size="small" variant="outlined" label={`+${entry.references.length - 6}`} />
                ) : null}
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </TableCell>

      <TableCell sx={{ minWidth: 280 }}>
        {entry.localImages.length === 0 ? (
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary"
            }}
          >
            None on this endpoint
          </Typography>
        ) : (
          <Stack
            direction="row"
            sx={{
              flexWrap: "wrap",
              gap: 0.75
            }}
          >
            {visibleLocalImages.map((image) => {
              const name = imageDisplayName(image);
              return (
                <ImageRefChip
                  key={image.id}
                  label={name}
                  variant="outlined"
                  color="default"
                  tooltip={imageSecondaryText(image) || image.id}
                  onCopy={() => copyToClipboard(name)}
                  onDelete={actionBusy ? undefined : () => onRemove(name)}
                  deleteIcon={<DeleteOutlineIcon />}
                />
              );
            })}
            {remainingLocal > 0 ? (
              <Chip size="small" variant="outlined" label={`+${remainingLocal}`} />
            ) : null}
          </Stack>
        )}
      </TableCell>

      <TableCell align="right" sx={{ width: 96, whiteSpace: "nowrap" }}>
        <Stack
          direction="row"
          spacing={0.25}
          sx={{
            justifyContent: "flex-end"
          }}
        >
          <Tooltip title={pullTooltip} arrow>
            <span>
              <IconButton
                size="small"
                disabled={actionBusy || pullCandidates.length === 0}
                onClick={() => onPull(pullCandidates[0] ?? "", entry.kind)}
              >
                <DownloadIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={copyCandidate ? `Copy ${copyCandidate}` : "No image reference"} arrow>
            <span>
              <IconButton
                size="small"
                disabled={!copyCandidate}
                onClick={() => copyToClipboard(copyCandidate)}
              >
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </TableCell>
    </TableRow>
  );
}

interface SummaryStatsProps {
  total: number;
  local: number;
  notLocal: number;
}

function SummaryStats({ total, local, notLocal }: SummaryStatsProps): React.JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      useFlexGap
      sx={{
        alignItems: "center",
        flexWrap: "wrap",
        whiteSpace: "nowrap"
      }}
    >
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {total} kinds
      </Typography>
      <StatusText
        tone={local > 0 ? "success" : "default"}
        icon={<CheckCircleOutlineIcon />}
        label={`${local} local`}
      />
      <StatusText
        tone={notLocal > 0 ? "warning" : "default"}
        icon={<ErrorOutlineIcon />}
        label={`${notLocal} missing`}
      />
    </Stack>
  );
}

interface StatusNoticeProps {
  severity: "error" | "success";
  message: string;
  onClose: () => void;
}

function StatusNotice({ severity, message, onClose }: StatusNoticeProps): React.JSX.Element {
  const Icon = severity === "error" ? ErrorOutlineIcon : CheckCircleOutlineIcon;
  return (
    <Box
      role={severity === "error" ? "alert" : "status"}
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        pl: 1.5,
        pr: 0.5,
        py: 0.5,
        borderRadius: controlRadius,
        border: 1,
        borderColor: (theme: Theme) =>
          `color-mix(in srgb, ${theme.palette[severity].main} 55%, ${theme.palette.divider})`,
        bgcolor: (theme: Theme) =>
          `color-mix(in srgb, ${theme.palette[severity].main} 8%, transparent)`,
        color: "text.primary"
      }}
    >
      <Icon sx={{ mt: 0.75, fontSize: 16, flex: "0 0 auto", color: `${severity}.main` }} />
      <Typography
        variant="body2"
        sx={{
          flex: 1,
          minWidth: 0,
          py: 0.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere"
        }}
      >
        {message}
      </Typography>
      <IconButton aria-label="Close" size="small" onClick={onClose}>
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
}

interface CatalogEmptyStateProps {
  icon: React.ReactNode;
  message: string;
  action?: React.ReactNode;
}

function CatalogEmptyState({ icon, message, action }: CatalogEmptyStateProps): React.JSX.Element {
  return (
    <Stack
      spacing={1.5}
      sx={{
        alignItems: "center",
        py: 6,
        color: "text.secondary",
        "& > .MuiSvgIcon-root": { fontSize: 28, opacity: 0.8 }
      }}
    >
      {icon}
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {message}
      </Typography>
      {action}
    </Stack>
  );
}

export function ContainerlabImageManager({
  endpointOptions = [],
  initialEndpointId,
  onClose
}: ContainerlabImageManagerProps): React.JSX.Element {
  const host = useClabUiHost();
  const schema = useSchema();
  const [endpointId, setEndpointId] = React.useState(
    initialEndpointId ?? endpointOptions[0]?.id ?? ""
  );
  const [catalog, setCatalog] = React.useState<KindImageCatalogSnapshot>(buildEmptyCatalog);
  const [searchText, setSearchText] = React.useState("");
  const [filter, setFilter] = React.useState<CatalogFilter>("all");
  const [loading, setLoading] = React.useState(false);
  const [actionBusy, setActionBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const imageHost = host.images;

  const formatError = React.useCallback(
    (err: unknown, fallback: string): string => normalizeNotificationMessage(err, fallback),
    []
  );

  const loadCatalog = React.useCallback(async () => {
    if (!imageHost) {
      setError("Image management is not available in this host.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const target = endpointId ? { endpointId } : {};
      const [images, references] = await Promise.all([
        imageHost.listImages(target),
        imageHost.listImageReferences(target)
      ]);
      setCatalog(
        buildKindImageCatalog(
          {
            kinds: schema.kinds,
            typesByKind: Object.fromEntries(schema.typesByKind.entries()),
            srosComponentTypes: schema.srosComponentTypes
          },
          images,
          references
        )
      );
    } catch (err) {
      setCatalog(buildEmptyCatalog());
      setError(
        formatError(
          err,
          endpointId
            ? "Could not reach the selected endpoint. Connect it to load images."
            : "No endpoint is connected. Connect a runtime to load images."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [
    endpointId,
    formatError,
    imageHost,
    schema.kinds,
    schema.srosComponentTypes,
    schema.typesByKind
  ]);

  React.useEffect(() => {
    if (schema.isLoaded) {
      void loadCatalog();
    }
  }, [loadCatalog, schema.isLoaded]);

  const visibleEntries = React.useMemo(
    () => catalog.entries.filter((entry) => entry.guidance.imageRequired),
    [catalog.entries]
  );

  const filteredEntries = React.useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return visibleEntries.filter((entry) => {
      if (!entryMatchesFilter(entry, filter)) {
        return false;
      }
      return !normalizedSearch || entry.searchText.includes(normalizedSearch);
    });
  }, [visibleEntries, filter, searchText]);

  const filterCounts = React.useMemo(() => {
    const counts = { all: visibleEntries.length, missing: 0, pullable: 0, local: 0 };
    for (const entry of visibleEntries) {
      if (entryMatchesFilter(entry, "missing")) counts.missing += 1;
      if (entryMatchesFilter(entry, "pullable")) counts.pullable += 1;
      if (entryMatchesFilter(entry, "local")) counts.local += 1;
    }
    return counts;
  }, [visibleEntries]);

  const otherLocalImages = React.useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    if (!normalizedSearch) {
      return catalog.unreferencedLocalImages;
    }
    return catalog.unreferencedLocalImages.filter((image) =>
      `${imageDisplayName(image)} ${imageSecondaryText(image)} ${image.id}`
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [catalog.unreferencedLocalImages, searchText]);

  const runAction = React.useCallback(
    async (action: () => Promise<string | undefined>, fallbackNotice: string) => {
      setActionBusy(true);
      setError(null);
      try {
        const message = await action();
        setNotice(normalizeNotificationMessage(message, fallbackNotice));
        await loadCatalog();
      } catch (err) {
        setError(formatError(err, "The image action failed."));
      } finally {
        setActionBusy(false);
      }
    },
    [formatError, loadCatalog]
  );

  const handlePull = React.useCallback(
    async (image: string, kind?: string) => {
      if (!imageHost) return;
      const trimmed = image.trim();
      if (!trimmed) {
        setError("Image reference is required.");
        return;
      }
      await runAction(async () => {
        const result = await imageHost.pullImage({
          endpointId: endpointId || undefined,
          image: trimmed,
          kind: kind || undefined
        });
        return result.message || result.output;
      }, `Pulled ${trimmed}.`);
    },
    [endpointId, imageHost, runAction]
  );

  const handleRemove = React.useCallback(
    async (reference: string) => {
      if (!imageHost) return;
      if (!window.confirm(`Remove local image "${reference}"?`)) {
        return;
      }
      await runAction(async () => {
        const result = await imageHost.removeImage({
          endpointId: endpointId || undefined,
          reference
        });
        return result.message || result.output;
      }, `Removed ${reference}.`);
    },
    [endpointId, imageHost, runAction]
  );

  let tableRows: React.ReactNode;
  if (filteredEntries.length === 0) {
    let emptyState: React.ReactNode;
    if (loading) {
      emptyState = (
        <CatalogEmptyState icon={<CircularProgress size={20} />} message="Loading images…" />
      );
    } else if (visibleEntries.length === 0) {
      emptyState = (
        <CatalogEmptyState
          icon={<Inventory2OutlinedIcon />}
          message={error ? "Images could not be loaded." : "No images to show."}
          action={
            imageHost ? (
              <Button variant="outlined" size="small" onClick={() => void loadCatalog()}>
                Retry
              </Button>
            ) : undefined
          }
        />
      );
    } else {
      emptyState = (
        <CatalogEmptyState
          icon={<SearchIcon />}
          message="No kinds match the current filters."
          action={
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setSearchText("");
                setFilter("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      );
    }
    tableRows = (
      <TableRow>
        <TableCell colSpan={4} sx={{ borderBottom: 0 }}>
          {emptyState}
        </TableCell>
      </TableRow>
    );
  } else {
    tableRows = filteredEntries.map((entry) => (
      <KindRow
        key={entry.kind}
        entry={entry}
        actionBusy={actionBusy}
        onPull={(image, kind) => {
          void handlePull(image, kind);
        }}
        onRemove={(reference) => {
          void handleRemove(reference);
        }}
      />
    ));
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        bgcolor: "background.default",
        color: "text.primary"
      }}
    >
      <AppBar
        position="static"
        color="transparent"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "transparent"
        }}
      >
        <Toolbar
          variant="dense"
          disableGutters
          sx={{ px: 2, gap: 1.5, minHeight: 56, flexWrap: "wrap" }}
        >
          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              alignItems: "center",
              minWidth: 0,
              flex: 1
            }}
          >
            <Inventory2OutlinedIcon
              sx={{ fontSize: 20, color: "var(--vscode-icon-foreground, currentColor)" }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ lineHeight: 1.3 }}>
                Image Manager
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary"
                }}
              >
                Pull, inspect and remove container images for containerlab kinds
              </Typography>
            </Box>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center"
            }}
          >
            {endpointOptions.length > 1 ? (
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel id="image-manager-endpoint-label">Endpoint</InputLabel>
                <Select
                  labelId="image-manager-endpoint-label"
                  value={endpointId}
                  label="Endpoint"
                  onChange={(event) => setEndpointId(event.target.value)}
                >
                  {endpointOptions.map((endpoint) => (
                    <MenuItem key={endpoint.id} value={endpoint.id}>
                      {endpoint.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            <Tooltip title="Refresh" arrow>
              <span>
                <IconButton
                  onClick={() => void loadCatalog()}
                  disabled={loading || actionBusy}
                  size="small"
                >
                  {loading ? <CircularProgress size={16} /> : <RefreshIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
            {onClose ? (
              <Button onClick={onClose} variant="text" size="small">
                Close
              </Button>
            ) : null}
          </Stack>
        </Toolbar>
        {actionBusy ? <LinearProgress /> : null}
      </AppBar>

      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          gap: 1.5,
          alignItems: { xs: "stretch", md: "center" }
        }}
      >
        <TextField
          size="small"
          fullWidth
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search by kind, image or repository"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 16 }} />
                </InputAdornment>
              )
            }
          }}
          sx={{ maxWidth: { md: 360 } }}
        />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          onChange={(_, value: CatalogFilter | null) => {
            if (value) setFilter(value);
          }}
          sx={{ flexShrink: 0, "& .MuiToggleButton-root": { height: 32, px: 1.5 } }}
        >
          {CATALOG_FILTER_OPTIONS.map(({ value, label }) => (
            <ToggleButton key={value} value={value}>
              {label}
              <Typography
                component="span"
                variant="caption"
                sx={{
                  color: "text.secondary"
                }}
              >
                {filterCounts[value]}
              </Typography>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ flex: 1, display: { xs: "none", md: "block" } }} />
        <SummaryStats
          total={visibleEntries.length}
          local={filterCounts.local}
          notLocal={filterCounts.missing}
        />
      </Box>

      {error || notice ? (
        <Stack spacing={1} sx={{ px: 2, pb: 1.5 }}>
          {error ? (
            <StatusNotice severity="error" message={error} onClose={() => setError(null)} />
          ) : null}
          {notice ? (
            <StatusNotice severity="success" message={notice} onClose={() => setNotice(null)} />
          ) : null}
        </Stack>
      ) : null}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          px: 2,
          pb: 2,
          gap: 1.5,
          overflow: "hidden"
        }}
      >
        <TableContainer
          sx={{
            flex: 1,
            minHeight: 0,
            border: 1,
            borderColor: "divider",
            borderRadius: controlRadius,
            "& thead th": { bgcolor: "background.paper" },
            "& tbody tr:last-of-type > td": { borderBottom: 0 }
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 240 }}>Kind</TableCell>
                <TableCell>Image guidance</TableCell>
                <TableCell>Local images</TableCell>
                <TableCell align="right" sx={{ width: 96 }}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{tableRows}</TableBody>
          </Table>
        </TableContainer>

        {filter === "all" && otherLocalImages.length > 0 ? (
          <Accordion sx={{ flexShrink: 0 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "baseline",
                  flex: 1
                }}
              >
                <Typography variant="subtitle2">Other local images</Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {otherLocalImages.length}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary"
                  }}
                >
                  Not associated with any known kind
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {otherLocalImages.length > OTHER_LOCAL_IMAGE_DISPLAY_LIMIT ? (
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    display: "block",
                    mb: 0.5
                  }}
                >
                  Showing the first {OTHER_LOCAL_IMAGE_DISPLAY_LIMIT} of {otherLocalImages.length}.
                </Typography>
              ) : null}
              <List
                dense
                disablePadding
                sx={{
                  maxHeight: 300,
                  overflow: "auto"
                }}
              >
                {otherLocalImages.slice(0, OTHER_LOCAL_IMAGE_DISPLAY_LIMIT).map((image) => {
                  const name = imageDisplayName(image);
                  return (
                    <ListItem
                      key={image.id}
                      disableGutters
                      secondaryAction={
                        <Stack direction="row" spacing={0.25}>
                          <Tooltip title="Copy reference" arrow>
                            <IconButton size="small" onClick={() => copyToClipboard(name)}>
                              <ContentCopyIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Remove image" arrow>
                            <span>
                              <IconButton
                                size="small"
                                edge="end"
                                disabled={actionBusy}
                                onClick={() => void handleRemove(name)}
                              >
                                <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      }
                    >
                      <ListItemText
                        primary={name}
                        secondary={imageSecondaryText(image) || image.id}
                        slotProps={{
                          primary: {
                            noWrap: true,
                            variant: "body2",
                            sx: { fontFamily: MONO_FONT_FAMILY }
                          },
                          secondary: {
                            noWrap: true,
                            variant: "caption"
                          }
                        }}
                      />
                    </ListItem>
                  );
                })}
              </List>
            </AccordionDetails>
          </Accordion>
        ) : null}
      </Box>
    </Box>
  );
}

export function ContainerlabImageManagerDialog({
  open,
  runtime,
  onClose,
  ...props
}: ContainerlabImageManagerDialogProps): React.JSX.Element {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            height: "min(86vh, 880px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
          }
        }
      }}
    >
      <DialogTitle sx={{ display: "none" }}>Containerlab Images</DialogTitle>
      <DialogContent
        sx={{
          p: 0,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "hidden"
        }}
      >
        <ClabUiRuntimeProvider runtime={runtime}>
          <ContainerlabImageManager {...props} onClose={onClose} />
        </ClabUiRuntimeProvider>
      </DialogContent>
    </Dialog>
  );
}

export function ImageManagerApp({
  runtime,
  initialData
}: {
  runtime: ClabUiRuntime;
  initialData?: ImageManagerInitialData;
}): React.JSX.Element {
  return (
    <ClabUiRuntimeProvider runtime={runtime}>
      <MuiThemeProvider>
        <Box sx={{ height: "100vh", boxSizing: "border-box" }}>
          <ContainerlabImageManager
            endpointOptions={initialData?.endpointOptions}
            initialEndpointId={initialData?.selectedEndpointId}
          />
        </Box>
      </MuiThemeProvider>
    </ClabUiRuntimeProvider>
  );
}

export function bootstrapImageManagerWebview(runtime: ClabUiRuntime): void {
  const initialData = (window.__INITIAL_DATA__ ?? {}) as ImageManagerInitialData;

  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Image manager webview root element not found");
  }

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ImageManagerApp runtime={runtime} initialData={initialData} />
    </React.StrictMode>
  );
}
