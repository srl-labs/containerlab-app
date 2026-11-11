/* eslint-disable import-x/max-dependencies -- Keep individual MUI imports tree-shakeable. */
import React from "react";
import AddIcon from "@mui/icons-material/Add";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import CloseIcon from "@mui/icons-material/Close";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { getKindImageGuidance } from "../../image-manager/kindGuidance";
import { builtTag, canBuild, canPull, formatSize, isUnbuildable, linkedTemplate, recordFolder, recordName, recordVendor } from "./imagesModel";
import { Field, MONO_SX, NOT_BUILDABLE_REASON, StatusLabel, recordStatusHint, recordStatusLabel, recordTone } from "./imagesUi";
import { presenceOf } from "./TemplateList";
import type { ImageRecord, ImagesTemplate } from "./types";

const DL_SX = { display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: 2, rowGap: 0.75, m: 0 } as const;

interface FileEntry { filename: string; size?: number; sha1?: string; md5?: string }
interface PatchEntry { name: string; sha256?: string }

function filesOf(record: ImageRecord): FileEntry[] {
  const raw = Array.isArray(record.files) ? record.files : [];
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const file = entry as { filename?: unknown; size?: unknown; checksum?: { sha1?: unknown; md5?: unknown } };
    if (typeof file.filename !== "string") return [];
    return [{
      filename: file.filename,
      ...(typeof file.size === "number" ? { size: file.size } : {}),
      ...(typeof file.checksum?.sha1 === "string" ? { sha1: file.checksum.sha1 } : {}),
      ...(typeof file.checksum?.md5 === "string" ? { md5: file.checksum.md5 } : {})
    }];
  });
}

function patchesOf(record: ImageRecord): PatchEntry[] {
  const raw = Array.isArray(record.patches) ? record.patches : [];
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || typeof (entry as { name?: unknown }).name !== "string") return [];
    const patch = entry as { name: string; sha256?: unknown };
    return [{ name: patch.name, ...(typeof patch.sha256 === "string" ? { sha256: patch.sha256 } : {}) }];
  });
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function PaneHeader({ title, subtitle, onClose }: { title: string; subtitle: React.ReactNode; onClose: () => void }) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, px: 2, pt: 1.5, pb: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography component="h2" variant="subtitle1" sx={{ overflowWrap: "anywhere", lineHeight: 1.3 }}>{title}</Typography>
        <Box sx={{ mt: 0.25 }}>{subtitle}</Box>
      </Box>
      <IconButton size="small" aria-label="Close details" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ px: 2, pt: 1.5 }}>
      <Typography component="h3" variant="overline" sx={{ color: "text.secondary", display: "block", mb: 0.5 }}>{title}</Typography>
      {children}
    </Box>
  );
}

/** A button that explains, in its tooltip, why it is off. */
function ActionButton({ label, icon, testId, disabledReason, variant = "outlined", color, onClick }: {
  label: string;
  icon: React.ReactNode;
  testId: string;
  disabledReason?: string;
  variant?: "contained" | "outlined" | "text";
  color?: "error";
  onClick: () => void;
}) {
  const button = (
    <Button size="small" variant={variant} color={color} startIcon={icon} data-testid={testId} disabled={disabledReason !== undefined} onClick={onClick}>
      {label}
    </Button>
  );
  return disabledReason ? <Tooltip title={disabledReason}><span>{button}</span></Tooltip> : button;
}

/** Says, not only in a tooltip, which host check keeps the actions off. */
function BlockedNote({ reason }: { reason: string | undefined }) {
  if (reason === undefined) return null;
  return (
    <Typography variant="caption" component="p" data-testid="images-blocked-reason" sx={{ px: 2, pt: 0.5, color: "error.main" }}>
      {reason}
    </Typography>
  );
}

export interface RecordActions {
  pullBlocked?: string;
  buildBlocked?: string;
  templatesBlocked?: string;
  onPull: (record: ImageRecord) => void;
  onBuild: (record: ImageRecord) => void;
  onAddTemplate: (record: ImageRecord) => void;
}

/** What `climg show` says about a record, with the actions it allows. */
export function ImageDetails({ record, full, loading, error, templates, actions, onClose }: {
  record: ImageRecord;
  /** The `show` answer, when it has arrived. */
  full?: ImageRecord;
  loading: boolean;
  error?: string;
  templates: ImagesTemplate[];
  actions: RecordActions;
  onClose: () => void;
}): React.JSX.Element {
  const shown = full ?? record;
  const files = filesOf(shown);
  const patches = patchesOf(shown);
  const kindPatches = stringList(shown.kind_patches);
  const template = shown.status === "built" ? linkedTemplate(shown, templates) : undefined;
  const guidance = shown.kind ? getKindImageGuidance(shown.kind) : undefined;
  const tag = builtTag(shown);
  const predicted = typeof shown.predicted_tag === "string" ? shown.predicted_tag : shown.tag;
  return (
    <Box component="section" aria-label={`Details of ${recordName(shown)}`} data-testid="images-details" data-key={shown.key}>
      <PaneHeader
        title={recordName(shown)}
        onClose={onClose}
        subtitle={<StatusLabel tone={recordTone(shown.status)} label={recordStatusLabel(shown.status)} title={recordStatusHint(shown.status)} />}
      />
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", px: 2, pb: 0.5 }}>
        {canPull(shown) ? (
          <ActionButton
            label={shown.status === "built" ? "Pull again" : "Pull and build"}
            icon={<CloudDownloadOutlinedIcon fontSize="small" />}
            testId="images-pull-button"
            variant={shown.status === "built" ? "outlined" : "contained"}
            disabledReason={actions.pullBlocked}
            onClick={() => actions.onPull(shown)}
          />
        ) : null}
        {shown.source === "labhub" && isUnbuildable(shown) ? (
          <ActionButton
            label="Pull and build"
            icon={<CloudDownloadOutlinedIcon fontSize="small" />}
            testId="images-pull-button"
            variant="outlined"
            disabledReason={NOT_BUILDABLE_REASON}
            onClick={() => undefined}
          />
        ) : null}
        {canBuild(shown) ? (
          <ActionButton
            label="Register and build"
            icon={<BuildOutlinedIcon fontSize="small" />}
            testId="images-build-button"
            variant="contained"
            disabledReason={actions.buildBlocked}
            onClick={() => actions.onBuild(shown)}
          />
        ) : null}
        {shown.status === "built" && !template ? (
          <ActionButton
            label="Add Node Template"
            icon={<AddIcon fontSize="small" />}
            testId="images-template-add"
            disabledReason={actions.templatesBlocked}
            onClick={() => actions.onAddTemplate(shown)}
          />
        ) : null}
      </Box>
      <BlockedNote reason={(canPull(shown) ? actions.pullBlocked : undefined) ?? (canBuild(shown) ? actions.buildBlocked : undefined)} />
      <Section title="Image">
        <Box component="dl" sx={DL_SX}>
          <Field label="Key" mono>{shown.key}</Field>
          {typeof shown.id === "number" ? <Field label="LabHub entry" mono>#{shown.id}{typeof shown.section === "string" ? ` · ${shown.section}` : ""}</Field> : null}
          {recordVendor(shown) ? <Field label="Vendor">{recordVendor(shown)}</Field> : null}
          {recordFolder(shown) ? <Field label="Folder" mono>{recordFolder(shown)}</Field> : null}
          <Field label="Kind" mono>{shown.kind ?? "no buildable kind"}</Field>
          <Field label="Version" mono>{shown.version ?? "–"}</Field>
          <Field label="Size">{formatSize(shown.size)}</Field>
          {shown.status === "built" && tag ? <Field label="Docker tag" mono>{tag}</Field> : null}
          {shown.status !== "built" && predicted ? <Field label="Tag after build" mono>{predicted}</Field> : null}
          {typeof shown.path === "string" ? <Field label="File" mono>{shown.path}</Field> : null}
          {shown.status === "built" ? (
            <Field label="Node Template" mono>{template ? template.name : "none yet"}</Field>
          ) : null}
        </Box>
      </Section>
      {loading ? <Typography variant="caption" sx={{ display: "block", px: 2, pt: 1.5, color: "text.secondary" }}>Loading details…</Typography> : null}
      {error ? <Typography variant="body2" role="alert" sx={{ px: 2, pt: 1.5, color: "error.main" }}>{error}</Typography> : null}
      {files.length > 0 ? (
        <Section title={`Files (${files.length})`}>
          <Box component="ul" sx={{ m: 0, p: 0, display: "grid", gap: 0.75 }}>
            {files.map((file) => (
              <Box key={file.filename} component="li" sx={{ listStyle: "none", minWidth: 0 }}>
                <Typography variant="body2" sx={MONO_SX}>{file.filename} <Box component="span" sx={{ color: "text.secondary" }}>· {formatSize(file.size)}</Box></Typography>
                {file.sha1 ? <Typography variant="caption" component="p" sx={{ color: "text.secondary", ...MONO_SX }}>sha1 {file.sha1}</Typography> : null}
                {file.md5 ? <Typography variant="caption" component="p" sx={{ color: "text.secondary", ...MONO_SX }}>md5 {file.md5}</Typography> : null}
              </Box>
            ))}
          </Box>
        </Section>
      ) : null}
      {patches.length > 0 || kindPatches.length > 0 ? (
        <Section title="Patches">
          {patches.map((patch) => (
            <Typography key={patch.name} variant="body2" sx={MONO_SX}>
              {patch.name}{patch.sha256 ? <Box component="span" sx={{ color: "text.secondary" }}> · sha256 {patch.sha256.slice(0, 12)}</Box> : null}
            </Typography>
          ))}
          {patches.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Applied at build: <Box component="span" sx={MONO_SX}>{kindPatches.join(", ")}</Box>
            </Typography>
          ) : null}
        </Section>
      ) : null}
      {guidance ? (
        <Section title={guidance.title}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>{guidance.preparation.details}</Typography>
          <Link href={guidance.docsUrl} target="_blank" rel="noreferrer" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, mt: 0.5, fontSize: 12 }}>
            kind docs <OpenInNewIcon sx={{ fontSize: 12 }} />
          </Link>
        </Section>
      ) : null}
      <Box sx={{ height: 16 }} />
    </Box>
  );
}

/** One Node Template: its image on this host, and removal when climg created it. */
export function TemplateDetails({ template, templatesBlocked, onRemove, onSearchImage, onClose }: {
  template: ImagesTemplate;
  templatesBlocked?: string;
  onRemove: (template: ImagesTemplate) => void;
  onSearchImage: (template: ImagesTemplate) => void;
  onClose: () => void;
}): React.JSX.Element {
  const presence = presenceOf(template);
  return (
    <Box component="section" aria-label={`Node Template ${template.name}`} data-testid="images-details" data-template={template.name}>
      <PaneHeader title={template.name} onClose={onClose} subtitle={<StatusLabel tone={presence.tone} label={presence.label} />} />
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", px: 2, pb: 0.5 }}>
        {template.imagePresent === false ? (
          <Button size="small" variant="contained" startIcon={<SearchIcon fontSize="small" />} data-testid="images-template-find" onClick={() => onSearchImage(template)}>
            Find this image
          </Button>
        ) : null}
        {template.managed ? (
          <ActionButton
            label="Remove template"
            icon={<DeleteOutlineIcon fontSize="small" />}
            testId="images-template-remove"
            color="error"
            disabledReason={templatesBlocked}
            onClick={() => onRemove(template)}
          />
        ) : null}
      </Box>
      <Section title="Template">
        <Box component="dl" sx={DL_SX}>
          <Field label="Kind" mono>{template.kind}</Field>
          <Field label="Image" mono>{template.image ?? "–"}</Field>
          {template.icon ? <Field label="Icon">{template.icon}</Field> : null}
          <Field label="Created by">{template.managed ? "climg (managed here)" : "the Lab Palette or another tool"}</Field>
        </Box>
        {!template.managed ? (
          <Typography variant="caption" component="p" sx={{ mt: 1.5, color: "text.secondary" }}>
            The Images view only changes templates climg created. Edit this one in the Lab Palette.
          </Typography>
        ) : null}
      </Section>
    </Box>
  );
}
