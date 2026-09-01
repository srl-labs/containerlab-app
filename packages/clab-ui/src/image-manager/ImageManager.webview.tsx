import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChevronDown,
  IconCircleCheck,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconPackages,
  IconRefresh,
  IconSearch,
  IconTrash
} from "@tabler/icons-react";
import React from "react";
import { createRoot } from "react-dom/client";

import {
  ClabUiRuntimeProvider,
  useClabUiHost,
  type ClabUiRuntime
} from "../host";
import { useSchema } from "../hooks/editor/useSchema";
import { AppThemeProvider } from "../theme/index";
import {
  buildKindImageCatalog,
  pullableImagesForEntry
} from "./catalog";
import { isPlaceholderImageReference } from "./kindGuidance";
import type {
  ContainerImageSummary,
  ImageManagerEndpointOption,
  ImageManagerInitialData,
  KindImageCatalogEntry,
  KindImageCatalogSnapshot
} from "./types";

const CLR_TEXT_PRIMARY = "var(--clab-ui-editor-foreground, var(--vscode-foreground))";
const CLR_TEXT_SECONDARY = "var(--vscode-descriptionForeground)";
const CLR_DIVIDER = "var(--clab-ui-panel-border, var(--vscode-panel-border))";
const CLR_BG_PAPER = "var(--clab-ui-panel-background, var(--vscode-sideBar-background))";
const CLR_BG_DEFAULT = "var(--clab-ui-editor-background, var(--vscode-editor-background))";
const CLR_PRIMARY = "var(--clab-ui-button-background, var(--vscode-button-background))";
const CLR_ERROR = "var(--vscode-editorError-foreground)";
const CLR_SUCCESS = "var(--vscode-testing-iconPassed, var(--vscode-charts-green))";
const MONO_FONT = "var(--clab-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

const TH_STYLE: React.CSSProperties = {
  backgroundColor: `color-mix(in srgb, ${CLR_BG_PAPER} 95%, transparent)`,
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: CLR_TEXT_SECONDARY
};

type CatalogFilter = "all" | "missing" | "pullable" | "local";
const CATALOG_FILTER_OPTIONS: ReadonlyArray<{ value: CatalogFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "missing", label: "Missing" },
  { value: "pullable", label: "Pullable" },
  { value: "local", label: "Local" }
];
const LOCAL_IMAGE_DISPLAY_LIMIT = 12;
const OTHER_LOCAL_IMAGE_DISPLAY_LIMIT = 80;

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

  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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

function chipToneColor(tone: ChipTone): string {
  switch (tone) {
    case "success":
      return "var(--vscode-testing-iconPassed, var(--vscode-charts-green, #2e7d32))";
    case "warning":
      return "var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, #ed6c02))";
    case "info":
      return "var(--vscode-editorInfo-foreground, #0288d1)";
    case "accent":
      return "var(--clab-ui-button-background, var(--vscode-button-background, #1976d2))";
    default:
      return "var(--clab-ui-panel-border, var(--vscode-panel-border, rgba(128,128,128,0.45)))";
  }
}

interface TonePillProps {
  tone?: ChipTone;
  children: React.ReactNode;
  leftSection?: React.ReactNode;
  rightSection?: React.ReactNode;
  onClick?: () => void;
  title?: string;
  maxWidth?: number;
  labelStyle?: React.CSSProperties;
}

function TonePill({
  tone = "default",
  children,
  leftSection,
  rightSection,
  onClick,
  title,
  maxWidth,
  labelStyle
}: TonePillProps): React.JSX.Element {
  const color = chipToneColor(tone);
  const backgroundColor =
    tone === "default" ? "transparent" : `color-mix(in srgb, ${color} 16%, transparent)`;
  const borderColor =
    tone === "default"
      ? CLR_DIVIDER
      : `color-mix(in srgb, ${color} 70%, var(--clab-ui-panel-border, var(--vscode-panel-border, transparent)))`;
  return (
    <Badge
      variant="outline"
      radius="sm"
      size="sm"
      title={title}
      onClick={onClick}
      leftSection={
        leftSection ? (
          <span style={{ display: "inline-flex", alignItems: "center", color }}>{leftSection}</span>
        ) : undefined
      }
      rightSection={rightSection}
      style={{ maxWidth, cursor: onClick ? "pointer" : undefined }}
      styles={{
        root: { backgroundColor, borderColor },
        label: {
          textTransform: "none",
          color: CLR_TEXT_PRIMARY,
          fontWeight: 500,
          ...labelStyle
        }
      }}
    >
      {children}
    </Badge>
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
      icon: <IconAlertCircle size={14} />
    };
  }
  if (entry.localImages.length > 0) {
    return {
      status: "ok",
      label: `${entry.localImages.length} local`,
      tone: "success",
      icon: <IconCircleCheck size={14} />
    };
  }
  return {
    status: "neutral",
    label: "Not local",
    tone: "info",
    icon: <IconPackages size={14} />
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
  color?: "default" | "info" | "warning";
  tooltip?: string;
  onCopy?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
}

function ImageRefChip({
  label,
  color = "default",
  tooltip,
  onCopy,
  onDelete,
  disabled = false
}: ImageRefChipProps): React.JSX.Element {
  const tone = imageRefChipTone(color);
  const chip = (
    <TonePill
      tone={tone}
      onClick={disabled ? undefined : onCopy}
      leftSection={onCopy ? <IconCopy size={14} /> : undefined}
      rightSection={
        onDelete ? (
          <ActionIcon
            variant="subtle"
            size={16}
            color="gray"
            disabled={disabled}
            aria-label="Remove image"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <IconTrash size={14} />
          </ActionIcon>
        ) : undefined
      }
      maxWidth={320}
      labelStyle={{
        fontFamily: MONO_FONT,
        fontSize: 12,
        overflow: "hidden",
        textOverflow: "ellipsis"
      }}
    >
      {label}
    </TonePill>
  );

  if (!tooltip) return chip;
  return (
    <Tooltip label={tooltip} position="top" withArrow>
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
    <Table.Tr style={{ verticalAlign: "top" }}>
      <Table.Td style={{ width: 240, paddingTop: 10, paddingBottom: 10 }}>
        <Stack gap={4}>
          <Text size="sm" fw={600} style={{ lineHeight: 1.25 }}>
            {entry.guidance.title}
          </Text>
          <Text size="xs" c="dimmed" style={{ fontFamily: MONO_FONT, wordBreak: "break-all" }}>
            {entry.kind}
          </Text>
          <Box style={{ paddingTop: 2 }}>
            <TonePill tone={status.tone} leftSection={status.icon}>
              {status.label}
            </TonePill>
          </Box>
          {entry.types.length > 0 ? (
            <Text size="xs" c="dimmed">
              {entry.types.length} type{entry.types.length === 1 ? "" : "s"}
            </Text>
          ) : null}
        </Stack>
      </Table.Td>

      <Table.Td style={{ minWidth: 380, paddingTop: 10, paddingBottom: 10 }}>
        <Stack gap={8}>
          <Group gap={6} align="center" wrap="wrap">
            <TonePill tone={preparationChipTone(entry.guidance.preparation.mode)}>
              {entry.guidance.preparation.label}
            </TonePill>
            <Anchor
              href={entry.guidance.docsUrl}
              target="_blank"
              rel="noreferrer"
              size="sm"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                fontWeight: 500,
                textDecoration: "underline",
                color: CLR_PRIMARY
              }}
            >
              kind docs
              <IconExternalLink size={13} />
            </Anchor>
            {entry.guidance.preparation.docsUrl ? (
              <Anchor
                href={entry.guidance.preparation.docsUrl}
                target="_blank"
                rel="noreferrer"
                size="sm"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  fontWeight: 500,
                  textDecoration: "underline",
                  color: CLR_PRIMARY
                }}
              >
                vrnetlab
                <IconExternalLink size={13} />
              </Anchor>
            ) : null}
          </Group>
          <Text size="sm">
            {entry.guidance.guidance}
          </Text>
          {entry.guidance.recommendedImages.length === 0 ? null : (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" fw={600}>
                Recommended
              </Text>
              <Group gap={6} wrap="wrap">
                {entry.guidance.recommendedImages.map((image) => {
                  const placeholder = isPlaceholderImageReference(image);
                  return (
                    <ImageRefChip
                      key={`${entry.kind}:rec:${image}`}
                      label={image}
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
              </Group>
            </Stack>
          )}
          {entry.references.length > 0 ? (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" fw={600}>
                Used in topology
              </Text>
              <Group gap={6} wrap="wrap">
                {entry.references.slice(0, 6).map((reference) => (
                  <ImageRefChip
                    key={`${entry.kind}:ref:${reference.label}:${reference.image}`}
                    label={reference.image}
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
                  <TonePill>{`+${entry.references.length - 6}`}</TonePill>
                ) : null}
              </Group>
            </Stack>
          ) : null}
        </Stack>
      </Table.Td>

      <Table.Td style={{ minWidth: 280, paddingTop: 10, paddingBottom: 10 }}>
        {entry.localImages.length === 0 ? (
          <Text size="xs" c="dimmed">
            None on this endpoint
          </Text>
        ) : (
          <Group gap={6} wrap="wrap">
            {visibleLocalImages.map((image) => {
              const name = imageDisplayName(image);
              return (
                <ImageRefChip
                  key={image.id}
                  label={name}
                  color="default"
                  tooltip={imageSecondaryText(image) || image.id}
                  onCopy={() => copyToClipboard(name)}
                  onDelete={actionBusy ? undefined : () => onRemove(name)}
                />
              );
            })}
            {remainingLocal > 0 ? <TonePill>{`+${remainingLocal}`}</TonePill> : null}
          </Group>
        )}
      </Table.Td>

      <Table.Td
        style={{ width: 132, whiteSpace: "nowrap", textAlign: "right", paddingTop: 10, paddingBottom: 10 }}
      >
        <Group gap={4} justify="flex-end" wrap="nowrap">
          <Tooltip label={pullTooltip} withArrow>
            <span>
              <ActionIcon
                variant="subtle"
                size="sm"
                style={{ color: CLR_PRIMARY }}
                disabled={actionBusy || pullCandidates.length === 0}
                onClick={() => onPull(pullCandidates[0] ?? "", entry.kind)}
              >
                <IconDownload size={18} />
              </ActionIcon>
            </span>
          </Tooltip>
          <Tooltip label={copyCandidate ? `Copy ${copyCandidate}` : "No image reference"} withArrow>
            <span>
              <ActionIcon
                variant="subtle"
                size="sm"
                style={{ color: CLR_TEXT_PRIMARY }}
                disabled={!copyCandidate}
                onClick={() => copyToClipboard(copyCandidate)}
              >
                <IconCopy size={18} />
              </ActionIcon>
            </span>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

interface SummaryStatsProps {
  total: number;
  local: number;
  notLocal: number;
}

function SummaryStats({ total, local, notLocal }: SummaryStatsProps): React.JSX.Element {
  return (
    <Group gap={8} align="center" wrap="wrap">
      <TonePill>{`${total} kinds`}</TonePill>
      <TonePill
        tone={local > 0 ? "success" : "default"}
        leftSection={<IconCircleCheck size={14} />}
      >
        {`${local} local`}
      </TonePill>
      <TonePill
        tone={notLocal > 0 ? "warning" : "default"}
        leftSection={<IconAlertCircle size={14} />}
      >
        {`${notLocal} missing`}
      </TonePill>
    </Group>
  );
}

interface StatusNoticeProps {
  severity: "error" | "success";
  message: string;
  onClose: () => void;
}

function StatusNotice({ severity, message, onClose }: StatusNoticeProps): React.JSX.Element {
  const Icon = severity === "error" ? IconAlertCircle : IconCircleCheck;
  const toneColor = severity === "error" ? CLR_ERROR : CLR_SUCCESS;
  return (
    <Alert
      variant="outline"
      color={severity === "error" ? "red" : "green"}
      role={severity === "error" ? "alert" : "status"}
      icon={<Icon size={18} style={{ color: toneColor }} />}
      withCloseButton
      closeButtonLabel="Close"
      onClose={onClose}
      style={{
        borderColor: toneColor,
        backgroundColor: CLR_BG_PAPER,
        color: CLR_TEXT_PRIMARY
      }}
      styles={{
        message: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: CLR_TEXT_PRIMARY }
      }}
    >
      {message}
    </Alert>
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
  }, [endpointId, formatError, imageHost, schema.kinds, schema.srosComponentTypes, schema.typesByKind]);

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
  if (loading && filteredEntries.length === 0) {
    tableRows = (
      <Table.Tr>
        <Table.Td colSpan={4} style={{ textAlign: "center", paddingTop: 48, paddingBottom: 48 }}>
          <Loader size={20} style={{ display: "inline-block", verticalAlign: "middle" }} />
          <Text span size="xs" c="dimmed" style={{ marginLeft: 8 }}>
            Loading images…
          </Text>
        </Table.Td>
      </Table.Tr>
    );
  } else if (filteredEntries.length === 0) {
    tableRows = (
      <Table.Tr>
        <Table.Td colSpan={4} style={{ textAlign: "center", paddingTop: 48, paddingBottom: 48 }}>
          <Text size="sm" c="dimmed">
            No image entries match the current filters.
          </Text>
        </Table.Td>
      </Table.Tr>
    );
  } else {
    tableRows = filteredEntries.map((entry) => (
      <KindRow
        key={entry.kind}
        entry={entry}
        actionBusy={actionBusy}
        onPull={handlePull}
        onRemove={handleRemove}
      />
    ));
  }

  return (
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        backgroundColor: CLR_BG_DEFAULT,
        color: CLR_TEXT_PRIMARY
      }}
    >
      <Box
        component="header"
        style={{
          borderBottom: `1px solid ${CLR_DIVIDER}`,
          backgroundColor: `color-mix(in srgb, ${CLR_BG_PAPER} 60%, transparent)`,
          backdropFilter: "blur(6px)"
        }}
      >
        <Box
          style={{
            display: "flex",
            alignItems: "center",
            paddingLeft: 16,
            paddingRight: 16,
            gap: 10,
            minHeight: 56,
            flexWrap: "wrap"
          }}
        >
          <Group gap={10} align="center" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <IconPackages size={20} style={{ color: CLR_PRIMARY }} />
            <Box style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} style={{ lineHeight: 1.2 }}>
                Image Manager
              </Text>
              <Text size="xs" c="dimmed">
                Pull, inspect and remove container images for containerlab kinds
              </Text>
            </Box>
          </Group>
          <Group gap={8} align="center" wrap="nowrap">
            {endpointOptions.length > 1 ? (
              <Select
                aria-label="Endpoint"
                data={endpointOptions.map((endpoint) => ({
                  value: endpoint.id,
                  label: endpoint.label
                }))}
                value={endpointId}
                onChange={(value) => setEndpointId(value ?? "")}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
                style={{ minWidth: 200 }}
              />
            ) : null}
            <Tooltip label="Refresh" withArrow>
              <span>
                <ActionIcon
                  variant="subtle"
                  onClick={() => void loadCatalog()}
                  disabled={loading || actionBusy}
                  style={{ color: CLR_TEXT_PRIMARY }}
                >
                  {loading ? <Loader size={18} /> : <IconRefresh size={20} />}
                </ActionIcon>
              </span>
            </Tooltip>
            {onClose ? (
              <Button onClick={onClose} variant="subtle" size="xs">
                Close
              </Button>
            ) : null}
          </Group>
        </Box>
        {actionBusy ? <Progress value={100} animated /> : null}
      </Box>

      <Box
        style={{
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 10,
          paddingBottom: 10,
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          borderBottom: `1px solid ${CLR_DIVIDER}`
        }}
      >
        <TextInput
          size="sm"
          value={searchText}
          onChange={(event) => setSearchText(event.currentTarget.value)}
          placeholder="Search by kind, image or repository"
          leftSection={<IconSearch size={18} />}
          style={{ flex: "1 1 240px", maxWidth: 420 }}
        />
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={(value) => setFilter(value as CatalogFilter)}
          data={CATALOG_FILTER_OPTIONS.map(({ value, label }) => ({
            value,
            label: (
              <Group gap={6} align="center" wrap="nowrap" style={{ fontWeight: 500 }}>
                <span>{label}</span>
                <Text span size="xs" c="dimmed">
                  {filterCounts[value]}
                </Text>
              </Group>
            )
          }))}
        />
        <Box style={{ flex: 1 }} />
        <SummaryStats
          total={visibleEntries.length}
          local={filterCounts.local}
          notLocal={filterCounts.missing}
        />
      </Box>

      <Stack gap={8} style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8 }}>
        {error ? (
          <StatusNotice severity="error" message={error} onClose={() => setError(null)} />
        ) : null}
        {notice ? (
          <StatusNotice severity="success" message={notice} onClose={() => setNotice(null)} />
        ) : null}
      </Stack>

      <Box
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 8,
          paddingBottom: 16,
          gap: 12,
          overflow: "hidden"
        }}
      >
        <Paper
          withBorder
          radius="md"
          style={{ flex: 1, minHeight: 0, overflow: "auto", backgroundColor: CLR_BG_PAPER }}
        >
          <Table stickyHeader highlightOnHover styles={{ th: TH_STYLE }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 240 }}>Kind</Table.Th>
                <Table.Th>Image guidance</Table.Th>
                <Table.Th>Local images</Table.Th>
                <Table.Th style={{ width: 132, textAlign: "right" }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{tableRows}</Table.Tbody>
          </Table>
        </Paper>

        {filter === "all" && otherLocalImages.length > 0 ? (
          <Accordion
            chevronPosition="right"
            variant="contained"
            chevron={<IconChevronDown size={18} />}
            style={{ borderRadius: 8 }}
          >
            <Accordion.Item value="other-local-images">
              <Accordion.Control>
                <Group gap={8} align="center">
                  <Text size="sm" fw={600}>
                    Other local images
                  </Text>
                  <TonePill>{otherLocalImages.length}</TonePill>
                  <Text size="xs" c="dimmed">
                    Not associated with any known kind
                  </Text>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                {otherLocalImages.length > OTHER_LOCAL_IMAGE_DISPLAY_LIMIT ? (
                  <Text size="xs" c="dimmed" style={{ display: "block", marginBottom: 4 }}>
                    Showing the first {OTHER_LOCAL_IMAGE_DISPLAY_LIMIT} of {otherLocalImages.length}.
                  </Text>
                ) : null}
                <Box
                  style={{
                    border: `1px solid ${CLR_DIVIDER}`,
                    borderRadius: 6,
                    maxHeight: 300,
                    overflow: "auto"
                  }}
                >
                  <Stack gap={0}>
                    {otherLocalImages
                      .slice(0, OTHER_LOCAL_IMAGE_DISPLAY_LIMIT)
                      .map((image, index, arr) => {
                        const name = imageDisplayName(image);
                        return (
                          <React.Fragment key={image.id}>
                            <Group
                              justify="space-between"
                              align="center"
                              wrap="nowrap"
                              gap={8}
                              style={{ padding: "6px 10px" }}
                            >
                              <Box style={{ minWidth: 0 }}>
                                <Text size="sm" truncate style={{ fontFamily: MONO_FONT }}>
                                  {name}
                                </Text>
                                <Text size="xs" c="dimmed" truncate>
                                  {imageSecondaryText(image) || image.id}
                                </Text>
                              </Box>
                              <Group gap={2} wrap="nowrap">
                                <Tooltip label="Copy reference" withArrow>
                                  <ActionIcon
                                    variant="subtle"
                                    size="sm"
                                    style={{ color: CLR_TEXT_PRIMARY }}
                                    onClick={() => copyToClipboard(name)}
                                  >
                                    <IconCopy size={18} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Remove image" withArrow>
                                  <span>
                                    <ActionIcon
                                      variant="subtle"
                                      size="sm"
                                      style={{ color: CLR_TEXT_PRIMARY }}
                                      disabled={actionBusy}
                                      onClick={() => void handleRemove(name)}
                                    >
                                      <IconTrash size={18} />
                                    </ActionIcon>
                                  </span>
                                </Tooltip>
                              </Group>
                            </Group>
                            {index < arr.length - 1 ? <Divider color={CLR_DIVIDER} /> : null}
                          </React.Fragment>
                        );
                      })}
                  </Stack>
                </Box>
              </Accordion.Panel>
            </Accordion.Item>
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
    <Modal
      opened={open}
      onClose={onClose ?? (() => undefined)}
      size="90%"
      centered
      withCloseButton={false}
      padding={0}
      aria-label="Containerlab Images"
      styles={{
        content: {
          height: "min(86vh, 880px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        },
        body: {
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }
      }}
    >
      <ClabUiRuntimeProvider runtime={runtime}>
        <ContainerlabImageManager {...props} onClose={onClose} />
      </ClabUiRuntimeProvider>
    </Modal>
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
      <AppThemeProvider>
        <Box style={{ height: "100vh", boxSizing: "border-box" }}>
          <ContainerlabImageManager
            endpointOptions={initialData?.endpointOptions}
            initialEndpointId={initialData?.selectedEndpointId}
          />
        </Box>
      </AppThemeProvider>
    </ClabUiRuntimeProvider>
  );
}

export function bootstrapImageManagerWebview(runtime: ClabUiRuntime): void {
  const initialData = (window.__INITIAL_DATA__ ?? {}) as ImageManagerInitialData;
  if (initialData.schemaData) {
    window.__SCHEMA_DATA__ = initialData.schemaData as typeof window.__SCHEMA_DATA__;
  }

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
