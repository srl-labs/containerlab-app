/* eslint-disable import-x/max-dependencies -- The view composes its panes and dialogs. */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { headerBarHeight } from "../../theme/surfaces";
import { HealthCard } from "./HealthCard";
import { ImageDetails, TemplateDetails } from "./ImageDetails";
import { BuildDialog, PullDialog, SyncDialog, UploadDialog } from "./ImagesDialogs";
import { NO_FILTERS, SearchBar, SearchResults, type SearchFilters } from "./ImageSearch";
import {
  blockedReason,
  errorMessage,
  freeDiskBytes,
  localFileName,
  recordRef,
  sortRecords,
  unavailableOf,
  vendorOptions
} from "./imagesModel";
import { UnavailablePanel } from "./imagesUi";
import { JobsPanel } from "./JobsPanel";
import { isActiveJob, type ImagesJobsSnapshot, type ImagesJobsWatcher } from "./jobsWatcher";
import { TemplateList } from "./TemplateList";
import type {
  ImageRecord,
  ImagesClient,
  ImagesIndexInfo,
  ImagesStatus,
  ImagesTemplate,
  ImagesUnavailableInfo,
  ImagesViewProps
} from "./types";

const SEARCH_DELAY_MS = 250;
const NO_JOBS: ImagesJobsSnapshot = { jobs: [], loaded: false, finishing: [] };
const noSubscribe = () => () => undefined;

type Selection = { type: "record"; record: ImageRecord } | { type: "template"; template: ImagesTemplate } | undefined;
type DialogState =
  | { type: "pull"; record: ImageRecord }
  | { type: "upload" }
  | { type: "build"; fileName: string; kind?: string; version?: string }
  | { type: "sync" }
  | { type: "remove"; template: ImagesTemplate }
  | undefined;
type Notice = { severity: "success" | "error"; message: string } | undefined;

function useJobs(watcher: ImagesJobsWatcher | undefined): ImagesJobsSnapshot {
  const getSnapshot = watcher?.getSnapshot ?? (() => NO_JOBS);
  return useSyncExternalStore(watcher?.subscribe ?? noSubscribe, getSnapshot, getSnapshot);
}

function searchQuery(filters: SearchFilters) {
  return {
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.vendor ? { vendor: filters.vendor } : {}),
    ...(filters.source !== "all" ? { source: filters.source } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.includeUnbuildable ? { all: true } : {})
  };
}

/** Status, index and templates of the endpoint; `unavailable` when its routes say the feature is off. */
function useImagesBasics(client: ImagesClient | undefined) {
  const [status, setStatus] = useState<ImagesStatus>();
  const [unavailable, setUnavailable] = useState<ImagesUnavailableInfo>();
  const [statusError, setStatusError] = useState<string>();
  const [index, setIndex] = useState<ImagesIndexInfo>();
  const [templates, setTemplates] = useState<ImagesTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string>();

  const loadTemplates = useCallback(async () => {
    if (!client) return;
    setTemplatesLoading(true);
    try {
      setTemplates((await client.templates()).templates);
      setTemplatesError(undefined);
    } catch (error) {
      setTemplatesError(errorMessage(error));
    } finally {
      setTemplatesLoading(false);
    }
  }, [client]);

  const loadStatus = useCallback(async () => {
    if (!client) return;
    setStatusError(undefined);
    try {
      setStatus(await client.status());
    } catch (error) {
      const info = unavailableOf(error);
      if (info) setUnavailable(info);
      else setStatusError(errorMessage(error));
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void loadStatus();
    void loadTemplates();
    client.index().then(setIndex).catch(() => setIndex(undefined));
  }, [client, loadStatus, loadTemplates]);

  return { status, unavailable, statusError, index, setIndex, templates, templatesLoading, templatesError, loadTemplates, loadStatus };
}

/** Debounced search that follows the filters; a newer search aborts an older one. */
function useImageSearch(client: ImagesClient | undefined, filters: SearchFilters, enabled: boolean) {
  const [records, setRecords] = useState<ImageRecord[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [kinds, setKinds] = useState<string[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const query = useMemo(() => searchQuery(filters), [filters]);

  useEffect(() => {
    if (!client || !enabled) return undefined;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      client.search(query, controller.signal)
        .then((next) => {
          setRecords(sortRecords(next));
          setError(undefined);
          setVendors((known) => {
            const merged = new Set(known);
            for (const record of next) if (record.vendor) merged.add(record.vendor);
            return merged.size === known.length ? known : [...merged].sort();
          });
          setKinds((known) => {
            const merged = new Set(known);
            for (const record of next) if (record.kind) merged.add(record.kind);
            return merged.size === known.length ? known : [...merged].sort();
          });
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(errorMessage(reason));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, records === undefined ? 0 : SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `records` only picks the first delay; it must not search again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, enabled, query, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { records, loading, error, kinds, vendors, reload };
}

/** `climg show` for the selected record. */
function useRecordDetails(client: ImagesClient | undefined, record: ImageRecord | undefined, revision: number) {
  const [full, setFull] = useState<ImageRecord>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const ref = record ? recordRef(record) : undefined;
  useEffect(() => {
    setFull(undefined);
    setError(undefined);
    if (!client || !record) return undefined;
    if (!ref) {
      setError("This record has no name the server accepts; use the CLI for it.");
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    client.show(ref)
      .then((value) => { if (!cancelled) setFull(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // A record is identified by its key; a new object for the same key needs no new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, record?.key, ref, revision]);
  return { full, loading, error };
}

function NoticeLine({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;
  return (
    <Box
      role={notice.severity === "error" ? "alert" : "status"}
      data-testid="images-notice"
      sx={{
        display: "flex", alignItems: "flex-start", gap: 1, mx: 2, mb: 1, pl: 1.5, pr: 0.5, py: 0.25, borderRadius: "6px", border: 1,
        borderColor: `color-mix(in srgb, var(--vscode-${notice.severity === "error" ? "editorError-foreground" : "testing-iconPassed"}) 55%, transparent)`,
        bgcolor: `color-mix(in srgb, var(--vscode-${notice.severity === "error" ? "editorError-foreground" : "testing-iconPassed"}) 8%, transparent)`
      }}
    >
      <Typography variant="body2" sx={{ flex: 1, py: 0.5, overflowWrap: "anywhere" }}>{notice.message}</Typography>
      <IconButton size="small" aria-label="Dismiss" onClick={onClose}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
    </Box>
  );
}

function RemoveDialog({ template, onCancel, onConfirm }: { template: ImagesTemplate; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth data-testid="images-remove-dialog">
      <DialogTitle>Remove {template.name}?</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          The template leaves the Lab Palette. The image stays on this host, and labs that already use it keep working.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onCancel}>Cancel</Button>
        <Button variant="contained" color="error" data-testid="images-remove-confirm" onClick={onConfirm}>Remove</Button>
      </DialogActions>
    </Dialog>
  );
}

function Header({ endpointLabel, uploadBlocked, canUpload, onUpload, onClose }: {
  endpointLabel?: string;
  uploadBlocked?: string;
  canUpload: boolean;
  onUpload: () => void;
  onClose?: () => void;
}) {
  const upload = (
    <Button
      size="small"
      variant="text"
      startIcon={<UploadFileOutlinedIcon fontSize="small" />}
      data-testid="images-upload-button"
      disabled={uploadBlocked !== undefined}
      onClick={onUpload}
    >
      Upload image
    </Button>
  );
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: headerBarHeight, flexShrink: 0, pl: 1.5, pr: 1, borderBottom: 1, borderColor: "divider" }}>
      <Typography component="h1" variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
        Images
        {endpointLabel ? <Typography component="span" variant="caption" sx={{ color: "text.secondary", ml: 1 }}>{endpointLabel}</Typography> : null}
      </Typography>
      {canUpload && uploadBlocked !== undefined ? <Tooltip title={uploadBlocked}><span>{upload}</span></Tooltip> : null}
      {canUpload && uploadBlocked === undefined ? upload : null}
      {onClose ? <IconButton size="small" aria-label="Close images" onClick={onClose}><CloseIcon fontSize="small" /></IconButton> : null}
    </Box>
  );
}

/**
 * Network-OS images of the local lab host through climg: Node Templates on the left;
 * LabHub and local image files on the right, with pull, upload, build and jobs.
 */
export function ImagesView({ client, jobs: watcher, endpointLabel, unavailable: given, onTemplatesChanged, onClose }: ImagesViewProps): React.JSX.Element {
  const active = given ? undefined : client;
  const basics = useImagesBasics(active);
  const unavailable = given ?? basics.unavailable;
  const ready = active !== undefined && unavailable === undefined;
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS);
  const search = useImageSearch(active, filters, ready);
  const [selection, setSelection] = useState<Selection>();
  const [detailsRevision, setDetailsRevision] = useState(0);
  const selectedRecord = selection?.type === "record" ? selection.record : undefined;
  const details = useRecordDetails(ready ? active : undefined, selectedRecord, detailsRevision);
  const [dialog, setDialog] = useState<DialogState>();
  const [notice, setNotice] = useState<Notice>();
  const [indexBusy, setIndexBusy] = useState(false);
  const jobs = useJobs(ready ? watcher : undefined);
  const checks = basics.status?.doctor.checks;

  useEffect(() => {
    if (ready) void watcher?.refresh();
  }, [ready, watcher]);

  const { loadTemplates } = basics;
  const { reload: reloadSearch } = search;
  const templatesChanged = useCallback(() => {
    void loadTemplates();
    onTemplatesChanged?.();
  }, [loadTemplates, onTemplatesChanged]);

  // A job that ends changes records and templates: show them as they are now.
  const activeIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set(jobs.jobs.filter(isActiveJob).map((job) => job.id));
    const ended = [...activeIds.current].filter((id) => !now.has(id));
    activeIds.current = now;
    if (ended.length === 0) return;
    void loadTemplates();
    reloadSearch();
    setDetailsRevision((value) => value + 1);
  }, [jobs.jobs, loadTemplates, reloadSearch]);

  const kinds = useMemo(() => {
    const all = new Set(search.kinds);
    for (const template of basics.templates) if (template.kind) all.add(template.kind);
    return [...all].sort();
  }, [search.kinds, basics.templates]);
  const vendors = useMemo(() => vendorOptions(basics.index, search.vendors, search.kinds), [basics.index, search.vendors, search.kinds]);

  const pullBlocked = blockedReason(checks, "pull");
  const buildBlocked = blockedReason(checks, "build");
  const uploadBlocked = blockedReason(checks, "upload");
  const templatesBlocked = blockedReason(checks, "templates");

  if (!ready) {
    return (
      <ViewFrame>
        <Header endpointLabel={endpointLabel} canUpload={false} onUpload={() => undefined} onClose={onClose} />
        {unavailable ? <UnavailablePanel info={unavailable} /> : (
          <Typography variant="body2" sx={{ p: 2, color: "text.secondary" }}>Connecting…</Typography>
        )}
      </ViewFrame>
    );
  }

  const run = (label: string, action: () => Promise<unknown>) => {
    action()
      .then(() => setNotice({ severity: "success", message: label }))
      .catch((error: unknown) => setNotice({ severity: "error", message: errorMessage(error) }));
  };
  const startJob = (request: Parameters<ImagesClient["startJob"]>[0]) =>
    watcher ? watcher.start(request) : active.startJob(request);

  const onPullConfirmed = (record: ImageRecord, force: boolean) => {
    setDialog(undefined);
    const ref = recordRef(record);
    if (!ref) return;
    run(`Pull of ${ref} started. It runs on the server; you can leave this view.`, () => startJob({ op: "pull", ref, ...(force ? { force } : {}) }));
  };
  const openBuild = (record: ImageRecord) => {
    const fileName = localFileName(record);
    if (fileName) setDialog({ type: "build", fileName, ...(record.kind ? { kind: record.kind } : {}), ...(record.version ? { version: record.version } : {}) });
  };
  const openBuildForUpload = (fileName: string) => {
    setDialog({ type: "build", fileName });
    active.scan()
      .then((files) => {
        const match = files.find((file) => file.path.split("/").pop() === fileName);
        if (!match) return;
        setDialog((current) => current?.type === "build" && current.fileName === fileName
          ? { ...current, ...(match.kind ? { kind: match.kind } : {}), ...(match.version ? { version: match.version } : {}) }
          : current);
      })
      .catch(() => undefined);
  };
  const addTemplate = (record: ImageRecord) => {
    const ref = recordRef(record);
    if (!ref) return;
    run("Node Template added. The Lab Palette shows it after its next refresh.", async () => {
      await active.addTemplate(ref);
      templatesChanged();
    });
  };
  const removeTemplate = (template: ImagesTemplate) => {
    setDialog(undefined);
    run(`Node Template ${template.name} removed.`, async () => {
      await active.removeTemplate(template.name);
      setSelection(undefined);
      templatesChanged();
    });
  };
  const refreshIndex = () => {
    setIndexBusy(true);
    active.refreshIndex()
      .then((next) => {
        basics.setIndex(next);
        reloadSearch();
      })
      .catch((error: unknown) => setNotice({ severity: "error", message: `Index refresh failed: ${errorMessage(error)}` }))
      .finally(() => setIndexBusy(false));
  };

  return (
    <ViewFrame>
      <Header
        endpointLabel={endpointLabel}
        canUpload
        uploadBlocked={uploadBlocked}
        onUpload={() => setDialog({ type: "upload" })}
        onClose={onClose}
      />
      <Box sx={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(260px, 300px) minmax(0, 1fr)" }}>
        <Box component="aside" aria-label="Host and Node Templates" sx={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          {basics.status ? <HealthCard status={basics.status} /> : null}
          {basics.statusError ? (
            <Box sx={{ mx: 1.5, mt: 1.5 }}>
              <Typography variant="body2" role="alert" sx={{ color: "error.main" }}>Host check failed: {basics.statusError}</Typography>
              <Button size="small" variant="text" onClick={() => void basics.loadStatus()}>Try again</Button>
            </Box>
          ) : null}
          <Box sx={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column", pt: 1 }}>
            <TemplateList
              templates={basics.templates}
              loading={basics.templatesLoading}
              error={basics.templatesError}
              selectedName={selection?.type === "template" ? selection.template.name : undefined}
              syncDisabledReason={templatesBlocked}
              onSelect={(template) => setSelection({ type: "template", template })}
              onSync={() => setDialog({ type: "sync" })}
            />
          </Box>
          <Box sx={{ maxHeight: "45%", display: "flex", flexDirection: "column", minHeight: 0, borderTop: 1, borderColor: "divider", pt: 0.5 }}>
            <JobsPanel
              jobs={jobs.jobs}
              error={jobs.error}
              finishing={jobs.finishing}
              onCancel={(job) => {
                if (watcher) watcher.cancel(job.id).catch((error: unknown) => setNotice({ severity: "error", message: errorMessage(error) }));
              }}
            />
          </Box>
        </Box>
        <Box component="main" aria-label="Image search" sx={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
          <SearchBar
            filters={filters}
            kinds={kinds}
            vendors={vendors}
            index={basics.index}
            indexBusy={indexBusy}
            onChange={setFilters}
            onRefreshIndex={refreshIndex}
          />
          <NoticeLine notice={notice} onClose={() => setNotice(undefined)} />
          <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
            <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <SearchResults
                records={search.records}
                loading={search.loading}
                error={search.error}
                filters={filters}
                selectedKey={selectedRecord?.key}
                onSelect={(record) => setSelection({ type: "record", record })}
                onClearFilters={() => setFilters(NO_FILTERS)}
              />
            </Box>
            {selection ? (
              <Box sx={{ width: 380, flexShrink: 0, minHeight: 0, overflowY: "auto", borderLeft: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                {selection.type === "record" ? (
                  <ImageDetails
                    record={selection.record}
                    full={details.full}
                    loading={details.loading}
                    error={details.error}
                    templates={basics.templates}
                    actions={{
                      pullBlocked,
                      buildBlocked,
                      templatesBlocked,
                      onPull: (record) => setDialog({ type: "pull", record }),
                      onBuild: openBuild,
                      onAddTemplate: addTemplate
                    }}
                    onClose={() => setSelection(undefined)}
                  />
                ) : (
                  <TemplateDetails
                    template={selection.template}
                    templatesBlocked={templatesBlocked}
                    onRemove={(template) => setDialog({ type: "remove", template })}
                    onSearchImage={(template) => setFilters({ ...NO_FILTERS, q: template.image ?? template.kind })}
                    onClose={() => setSelection(undefined)}
                  />
                )}
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>
      {dialog?.type === "pull" ? (
        <PullDialog
          record={dialog.record}
          freeBytes={freeDiskBytes(checks)}
          floorBytes={basics.status?.config.diskFloorBytes ?? 0}
          onCancel={() => setDialog(undefined)}
          onConfirm={(force) => onPullConfirmed(dialog.record, force)}
        />
      ) : null}
      {dialog?.type === "upload" ? (
        <UploadDialog
          client={active}
          extensions={basics.status?.uploadExtensions ?? []}
          maxBytes={basics.status?.uploadMaxBytes ?? 0}
          onClose={() => setDialog(undefined)}
          onUploaded={() => reloadSearch()}
          onBuild={openBuildForUpload}
        />
      ) : null}
      {dialog?.type === "build" ? (
        <BuildDialog
          key={`${dialog.fileName}:${dialog.kind ?? ""}:${dialog.version ?? ""}`}
          fileName={dialog.fileName}
          initialKind={dialog.kind}
          initialVersion={dialog.version}
          kinds={kinds}
          onCancel={() => setDialog(undefined)}
          onStart={async ({ kind, version, tag }) => {
            await startJob({ op: "build", file: dialog.fileName, kind, version, ...(tag ? { tag } : {}) });
            setDialog(undefined);
            setNotice({ severity: "success", message: `Build of ${dialog.fileName} started. It runs on the server; you can leave this view.` });
          }}
        />
      ) : null}
      {dialog?.type === "sync" ? (
        <SyncDialog
          client={active}
          onClose={() => setDialog(undefined)}
          onApplied={(result) => {
            setDialog(undefined);
            templatesChanged();
            setNotice({ severity: "success", message: `Node Templates synced: ${result.changes.length} ${result.changes.length === 1 ? "change" : "changes"}.` });
          }}
        />
      ) : null}
      {dialog?.type === "remove" ? (
        <RemoveDialog template={dialog.template} onCancel={() => setDialog(undefined)} onConfirm={() => removeTemplate(dialog.template)} />
      ) : null}
    </ViewFrame>
  );
}

function ViewFrame({ children }: { children: React.ReactNode }) {
  return (
    <Box
      id="images-view"
      data-testid="images-view"
      sx={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column", minHeight: 0,
        bgcolor: "background.default", color: "text.primary", pointerEvents: "auto"
      }}
    >
      {children}
    </Box>
  );
}
