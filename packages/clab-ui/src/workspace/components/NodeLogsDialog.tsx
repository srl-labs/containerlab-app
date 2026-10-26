// Node logs: follows a node's container log live, or shows the topology's last lifecycle log.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

import { formatRuntimeTimestamp, parseLogLine, type LogSegmentKind, type ParsedLogLine } from "../logHighlight";
import { useLifecycleLogHistory, type LifecycleLogRecord } from "../state/lifecycleLogHistory";
import { findRuntimeContainer } from "../state/runtimeContainerLookup";
import { useRuntimeUiStore, type RuntimeNodeRequest } from "../state/runtimeUiStore";
import type { LabState, NodeLogLine } from "../types";
import { useWorkspaceHost, useWorkspaceLabs } from "../WorkspaceHost";
import { MONO_FONT_FAMILY } from "../../theme/typography";

/** Older lines are dropped from the view. */
const MAX_LOG_LINES = 5000;
const DEFAULT_TAIL = "200";
const POLL_INTERVAL_MS = 2000;
const FLUSH_INTERVAL_MS = 50;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
/** Distance from the bottom, in pixels, that still counts as following the end. */
const BOTTOM_SLACK_PX = 24;
const LIFECYCLE_SOURCE = "lifecycle";

interface LogEntry {
  id: number;
  line: string;
  stream?: "stdout" | "stderr";
  parsed: ParsedLogLine;
}

type StreamStatus = "loading" | "live" | "polling" | "reconnecting" | "ended" | "idle";

const SEGMENT_COLORS: Record<LogSegmentKind, string | undefined> = {
  text: undefined,
  timestamp: "text.secondary",
  error: "error.main",
  warn: "warning.main",
  info: "info.main",
  debug: "text.disabled",
  key: "primary.main",
  value: undefined
};

const STATUS_LABELS: Record<StreamStatus, string> = {
  loading: "Loading…",
  live: "Live",
  polling: "Refreshing every 2 s",
  reconnecting: "Reconnecting…",
  ended: "Stream ended",
  idle: ""
};

let nextEntryId = 1;

function toEntry(line: NodeLogLine): LogEntry {
  return { id: nextEntryId++, line: line.line, stream: line.stream, parsed: parseLogLine(line.line) };
}

function splitLogText(text: string): LogEntry[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => toEntry({ line }));
}

function keepNewest(entries: LogEntry[]): LogEntry[] {
  return entries.length > MAX_LOG_LINES ? entries.slice(entries.length - MAX_LOG_LINES) : entries;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** The running lab a logs request belongs to, for its list of nodes. */
function findRequestLab(labs: Map<string, LabState>, request: RuntimeNodeRequest): LabState | undefined {
  const container = findRuntimeContainer(labs, {
    endpointId: request.endpointId,
    topologyRef: request.topologyRef,
    nodeName: request.nodeName
  });
  if (!container) return undefined;
  return [...labs.values()].find(
    (lab) => lab.endpointId === container.endpointId && lab.containers.has(container.name)
  );
}

function lifecycleSourceLabel(record: LifecycleLogRecord): string {
  const action = record.action.charAt(0).toUpperCase() + record.action.slice(1);
  const time = new Date(record.finishedAt ?? record.startedAt).toLocaleTimeString();
  if (record.status === "running") return `${action} log (running)`;
  return `${action} log (${record.status === "success" ? "finished" : "failed"} ${time})`;
}

const LogLineRow = memo(function LogLineRow(props: { entry: LogEntry; showTimestamps: boolean }) {
  const { entry, showTimestamps } = props;
  const timestamp = entry.parsed.runtimeTimestamp;
  return (
    <Box
      data-testid="node-logs-line"
      data-stream={entry.stream}
      sx={{
        borderLeft: 2,
        borderColor: entry.stream === "stderr" ? "warning.main" : "transparent",
        pl: 0.75
      }}
    >
      {showTimestamps && timestamp ? (
        <Box component="span" title={timestamp} sx={{ color: "text.secondary", mr: 1 }}>
          {formatRuntimeTimestamp(timestamp)}
        </Box>
      ) : null}
      {entry.parsed.segments.map((segment, index) => {
        const color = SEGMENT_COLORS[segment.kind];
        return color ? (
          <Box key={index} component="span" sx={{ color }}>
            {segment.text}
          </Box>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        );
      })}
    </Box>
  );
});

const LOG_PAPER_SX: SxProps<Theme> = {
  bgcolor: "background.default",
  height: 480,
  overflow: "auto",
  px: 1.25,
  py: 1
};

const LOG_TEXT_SX: SxProps<Theme> = {
  fontFamily: MONO_FONT_FAMILY,
  fontSize: 12,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word"
};

export function NodeLogsDialog() {
  const logsRequest = useRuntimeUiStore((state) => state.logsRequest);
  const closeLogs = useRuntimeUiStore((state) => state.closeLogs);
  if (!logsRequest) return null;
  // A new request starts over: source, tail, filter and buffer.
  return <NodeLogsDialogView key={`${logsRequest.endpointId ?? ""}:${logsRequest.nodeName}`} request={logsRequest} onClose={closeLogs} />;
}

function NodeLogsDialogView(props: { request: RuntimeNodeRequest; onClose: () => void }) {
  const { request, onClose } = props;
  const { fetchNodeLogs, streamNodeLogs } = useWorkspaceHost().api;
  const labs = useWorkspaceLabs();
  const topologyId = request.topologyRef?.topologyId;
  const lifecycleRecord = useLifecycleLogHistory((state) =>
    topologyId ? state.records[topologyId] : undefined
  );

  const [source, setSource] = useState(request.nodeName);
  const [tailInput, setTailInput] = useState(DEFAULT_TAIL);
  const [tail, setTail] = useState(DEFAULT_TAIL);
  const [follow, setFollow] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [filter, setFilter] = useState("");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);

  const lab = useMemo(() => findRequestLab(labs, request), [labs, request]);
  const nodeOptions = useMemo(() => {
    const names = new Set<string>([request.nodeName]);
    for (const container of lab?.containers.values() ?? []) {
      names.add(container.nodeName || container.name);
    }
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [lab, request.nodeName]);
  const showsLifecycle = source === LIFECYCLE_SOURCE;

  // Node logs: stream while following, else poll or fetch once.
  useEffect(() => {
    if (showsLifecycle) return;
    const controller = new AbortController();
    const { signal } = controller;
    const target = {
      endpointId: request.endpointId,
      sessionId: request.sessionId,
      topologyRef: request.topologyRef,
      nodeName: source,
      tail
    };
    setEntries([]);
    setError(null);

    const fetchOnce = async (): Promise<boolean> => {
      try {
        const response = await fetchNodeLogs(target);
        if (signal.aborted) return false;
        setEntries(keepNewest(splitLogText(response.logs)));
        setError(null);
        return true;
      } catch (fetchError) {
        if (!signal.aborted) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
        return false;
      }
    };

    const stream = async (): Promise<void> => {
      let pending: LogEntry[] = [];
      let flushTimer: number | undefined;
      const flush = () => {
        flushTimer = undefined;
        const batch = pending;
        pending = [];
        if (batch.length > 0 && !signal.aborted) setEntries((current) => keepNewest([...current, ...batch]));
      };
      for (let attempt = 0; !signal.aborted; attempt += 1) {
        setStatus(attempt === 0 ? "loading" : "reconnecting");
        let received = false;
        try {
          // A reconnect starts over from the tail, so the view has no gaps or repeats.
          const lines = streamNodeLogs?.({ ...target, signal });
          if (!lines) return;
          if (attempt > 0) setEntries([]);
          for await (const line of lines) {
            if (!received) {
              received = true;
              attempt = 0;
              setStatus("live");
              setError(null);
            }
            pending.push(toEntry(line));
            flushTimer ??= window.setTimeout(flush, FLUSH_INTERVAL_MS);
          }
          if (signal.aborted) return;
          flush();
          // The node stopped or the lab host closed the stream.
          setStatus("ended");
        } catch (streamError) {
          if (signal.aborted) return;
          flush();
          setError(streamError instanceof Error ? streamError.message : String(streamError));
        }
        await sleep(RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)], signal);
      }
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    };

    if (follow && streamNodeLogs) {
      void stream();
    } else if (follow) {
      setStatus("polling");
      void fetchOnce();
      const timer = window.setInterval(() => void fetchOnce(), POLL_INTERVAL_MS);
      signal.addEventListener("abort", () => window.clearInterval(timer), { once: true });
    } else {
      setStatus("loading");
      void fetchOnce().then(() => {
        if (!signal.aborted) setStatus("idle");
      });
    }
    return () => controller.abort();
  }, [fetchNodeLogs, follow, reloadToken, request, showsLifecycle, source, streamNodeLogs, tail]);

  const lifecycleEntries = useMemo(
    () => (showsLifecycle ? (lifecycleRecord?.lines ?? []).map((line) => toEntry(line)) : []),
    [lifecycleRecord, showsLifecycle]
  );
  const shownEntries = showsLifecycle ? lifecycleEntries : entries;
  const filteredEntries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? shownEntries.filter((entry) => entry.line.toLowerCase().includes(needle)) : shownEntries;
  }, [filter, shownEntries]);

  // Keep the end in view while following, unless the user scrolled up to read.
  useEffect(() => {
    const paper = paperRef.current;
    if (paper && atBottomRef.current) paper.scrollTop = paper.scrollHeight;
  }, [filteredEntries]);

  const handleScroll = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    atBottomRef.current = paper.scrollHeight - paper.scrollTop - paper.clientHeight <= BOTTOM_SLACK_PX;
  }, []);

  const applyTail = useCallback(() => {
    const value = tailInput.trim() || DEFAULT_TAIL;
    atBottomRef.current = true;
    setTail(value);
    setReloadToken((token) => token + 1);
  }, [tailInput]);

  const exportLogs = useCallback(() => {
    if (filteredEntries.length === 0) return;
    const name = showsLifecycle ? `${lifecycleRecord?.labName ?? "lab"}-${lifecycleRecord?.action ?? "lifecycle"}` : source;
    const safeName = name.trim().replace(/[^A-Za-z0-9._-]/g, "-") || "node";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const text = filteredEntries.map((entry) => entry.line).join("\n");
    const url = window.URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName}-logs-${stamp}.log`;
    link.click();
    window.URL.revokeObjectURL(url);
  }, [filteredEntries, lifecycleRecord, showsLifecycle, source]);

  const total = shownEntries.length;
  const summary = filter.trim() ? `Showing ${filteredEntries.length}/${total} lines` : `${total} lines`;
  const statusLabel = showsLifecycle ? "" : STATUS_LABELS[status];
  const title = showsLifecycle && lifecycleRecord ? `Logs: ${lifecycleRecord.labName}` : `Logs: ${source}`;
  let emptyMessage = "No logs yet.";
  if (filter.trim()) emptyMessage = "No matching log lines.";
  else if (status === "loading") emptyMessage = "Loading logs…";

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth data-testid="node-logs-dialog">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ pt: 1, alignItems: { sm: "center" }, flexWrap: "wrap" }}>
            <TextField
              select
              label="Source"
              value={source}
              onChange={(event) => {
                atBottomRef.current = true;
                setSource(event.target.value);
              }}
              size="small"
              sx={{ minWidth: 200 }}
              data-testid="node-logs-source"
            >
              {nodeOptions.map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
              {lifecycleRecord ? (
                <MenuItem value={LIFECYCLE_SOURCE}>{lifecycleSourceLabel(lifecycleRecord)}</MenuItem>
              ) : null}
            </TextField>
            {showsLifecycle ? null : (
              <TextField
                label="Tail"
                value={tailInput}
                onChange={(event) => setTailInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyTail();
                }}
                onBlur={() => {
                  if ((tailInput.trim() || DEFAULT_TAIL) !== tail) applyTail();
                }}
                size="small"
                sx={{ width: 110 }}
              />
            )}
            <TextField
              label="Find"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              size="small"
              sx={{ minWidth: 200 }}
            />
            {showsLifecycle ? null : (
              <Button variant="outlined" onClick={applyTail}>
                Refresh
              </Button>
            )}
            <Button variant="outlined" onClick={exportLogs} disabled={filteredEntries.length === 0}>
              Export
            </Button>
            {showsLifecycle ? null : (
              <FormControlLabel
                control={<Switch size="small" checked={follow} onChange={(event) => setFollow(event.target.checked)} />}
                label="Follow"
              />
            )}
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showTimestamps}
                  onChange={(event) => setShowTimestamps(event.target.checked)}
                />
              }
              label="Timestamps"
            />
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {summary}
            </Typography>
            {statusLabel ? (
              <Typography
                variant="body2"
                data-testid="node-logs-status"
                sx={{ color: status === "live" ? "success.main" : "text.secondary" }}
              >
                {status === "live" ? "● " : ""}
                {statusLabel}
              </Typography>
            ) : null}
          </Stack>
          <Paper ref={paperRef} variant="outlined" onScroll={handleScroll} sx={LOG_PAPER_SX}>
            <Box sx={LOG_TEXT_SX} data-testid="node-logs-content">
              {filteredEntries.length > 0 ? (
                filteredEntries.map((entry) => (
                  <LogLineRow key={entry.id} entry={entry} showTimestamps={showTimestamps} />
                ))
              ) : (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {emptyMessage}
                </Typography>
              )}
            </Box>
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
