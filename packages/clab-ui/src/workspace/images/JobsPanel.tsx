import React, { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";

import { MONO_FONT_FAMILY } from "../../theme/typography";
import { jobTitle, keptFields, keptText, queueText } from "./imagesModel";
import { PaneTitle, StatusDot, type Tone } from "./imagesUi";
import { isActiveJob } from "./jobsWatcher";
import type { ImagesJob } from "./types";

const STATE_TONES: Record<ImagesJob["state"], Tone> = {
  queued: "default",
  running: "info",
  succeeded: "success",
  failed: "error",
  cancelled: "warning"
};
const STATE_LABELS: Record<ImagesJob["state"], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled"
};
const PHASE_LABELS: Record<string, string> = {
  wait: "waiting for a build slot",
  download: "downloading",
  build: "building",
  verify: "verifying",
  register: "registering",
  done: "done"
};
const LOG_LINES = 4;

function startedLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function phaseText(job: ImagesJob): string {
  if (job.state === "queued") return queueText(job) ?? "waiting for a build slot";
  if (!isActiveJob(job)) return job.error ?? job.message;
  const phase = PHASE_LABELS[job.phase] ?? job.phase;
  return [phase, job.pct === null ? undefined : `${Math.round(job.pct)} %`].filter(Boolean).join(" · ");
}

function templateNote(job: ImagesJob): string | undefined {
  if (job.state !== "succeeded" || !job.nodetpl) return undefined;
  if (job.nodetpl.error) return `Node Template not written: ${job.nodetpl.error}`;
  const kept = keptText(keptFields(job.nodetpl.kept));
  if (!job.nodetpl.written || !job.nodetpl.name) return undefined;
  return `Node Template ${job.nodetpl.name} written${kept ? ` · ${kept}` : ""}`;
}

function JobRow({ job, finishing, onCancel }: { job: ImagesJob; finishing: boolean; onCancel: (job: ImagesJob) => void }) {
  const active = isActiveJob(job);
  const [showAll, setShowAll] = useState(false);
  const lines = showAll ? job.log : job.log.slice(-LOG_LINES);
  const showLog = job.log.length > 0 && (active || job.state === "failed" || showAll);
  const note = templateNote(job);
  let cancelLabel = "Cancel";
  if (finishing) cancelLabel = "Finishing…";
  else if (job.cancelRequested === true) cancelLabel = "Cancelling…";
  return (
    <Box
      component="li"
      data-testid="images-job"
      data-state={job.state}
      data-op={job.op}
      data-queue-position={job.queuePosition}
      aria-label={jobTitle(job)}
      sx={{ listStyle: "none", px: 1.5, py: 1, borderTop: 1, borderColor: "divider", minWidth: 0 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <StatusDot tone={STATE_TONES[job.state]} label={STATE_LABELS[job.state]} />
        <Typography variant="body2" noWrap title={jobTitle(job)} sx={{ fontWeight: 500, minWidth: 0, flex: 1 }}>
          {jobTitle(job)}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", flexShrink: 0 }}>
          {STATE_LABELS[job.state]} · {startedLabel(job.startedAt)}
        </Typography>
        {active ? (
          <Button
            size="small"
            variant="text"
            color="error"
            data-testid="images-job-cancel"
            disabled={job.cancelRequested === true || finishing}
            onClick={() => onCancel(job)}
            sx={{ minWidth: 0, px: 1, flexShrink: 0 }}
          >
            {cancelLabel}
          </Button>
        ) : null}
      </Box>
      {active ? (
        <LinearProgress
          variant={job.pct === null || job.state === "queued" ? "indeterminate" : "determinate"}
          value={job.pct ?? 0}
          aria-label={`${jobTitle(job)} progress`}
          sx={{ mt: 0.75 }}
        />
      ) : null}
      <Typography
        variant="caption"
        component="p"
        sx={{ mt: 0.5, color: job.state === "failed" ? "error.main" : "text.secondary", overflowWrap: "anywhere" }}
      >
        {phaseText(job)}
      </Typography>
      {note ? <Typography variant="caption" component="p" sx={{ color: job.nodetpl?.error ? "warning.main" : "text.secondary" }}>{note}</Typography> : null}
      {showLog ? (
        <Box
          component="pre"
          data-testid="images-job-log"
          sx={{
            m: 0, mt: 0.75, px: 1, py: 0.75, maxHeight: showAll ? 240 : undefined, overflow: "auto",
            fontFamily: MONO_FONT_FAMILY, fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
            color: "text.secondary", bgcolor: "var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.1))", borderRadius: "6px"
          }}
        >
          {lines.join("\n")}
        </Box>
      ) : null}
      {job.log.length > LOG_LINES || (!showLog && job.log.length > 0) ? (
        <Button size="small" variant="text" onClick={() => setShowAll(!showAll)} sx={{ mt: 0.25, px: 0.5, minWidth: 0, fontSize: 12 }}>
          {showAll ? "Show less" : `Show log (${job.log.length} lines)`}
        </Button>
      ) : null}
    </Box>
  );
}

/** Running and recent jobs; they run on the server, so they are here again after a reload. */
export function JobsPanel({ jobs, error, finishing = [], onCancel }: {
  jobs: ImagesJob[];
  error?: string;
  /** Ids of jobs that already exited and are settling; their Cancel is disabled. */
  finishing?: readonly string[];
  onCancel: (job: ImagesJob) => void;
}): React.JSX.Element {
  const active = jobs.filter(isActiveJob).length;
  return (
    <Box component="section" aria-labelledby="images-jobs-title" data-testid="images-jobs" sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PaneTitle
        id="images-jobs-title"
        title="Jobs"
        count={jobs.length}
        actions={active > 0 ? <Typography variant="caption" sx={{ color: "info.main" }}>{active} running</Typography> : null}
      />
      {error ? <Typography variant="caption" sx={{ px: 1.5, color: "warning.main" }}>Could not update jobs: {error}</Typography> : null}
      {jobs.length === 0 ? (
        <Typography variant="body2" sx={{ px: 1.5, pb: 1.5, color: "text.secondary" }}>
          Pulls and builds run here. They keep running when you leave this view.
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, overflowY: "auto", minHeight: 0 }}>
          {jobs.map((job) => <JobRow key={job.id} job={job} finishing={finishing.includes(job.id)} onCancel={onCancel} />)}
        </Box>
      )}
    </Box>
  );
}
