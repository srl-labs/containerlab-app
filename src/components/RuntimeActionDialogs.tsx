import React, { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
  createTopologyFile,
  deleteTopologyFile,
  fetchNetem,
  fetchNodeLogs,
  fetchVersionCheck,
  fetchVersionInfo,
  inspectAllLabs,
  inspectLab,
  netemFieldsFromShowResponse,
  normalizeNetemFields,
  resetNetem,
  saveLabConfigs,
  setNetem,
  type InspectContainerInfo,
  type InspectLabResponse,
  type InspectAllLabsResponse,
  type NetemFields,
  type RuntimeTargetRequest
} from "../runtimeApi";
import { findLabStateForTopology } from "../standaloneHostShared";
import type { ContainerState, LabState } from "../stores/labStore";
import { useLabStore } from "../stores/labStore";
import { runtimeUiActions, useRuntimeUiStore } from "../stores/runtimeUiStore";

interface InspectGroup {
  labName: string;
  containers: InspectContainerInfo[];
}

const EMPTY_NETEM_FIELDS: NetemFields = {
  delay: "",
  jitter: "",
  loss: "",
  rate: "",
  corruption: ""
};

function normalizeInspectGroups(
  requestTitle: string,
  requestMode: "all" | "lab",
  payload: InspectAllLabsResponse | InspectLabResponse
): InspectGroup[] {
  if (requestMode === "all") {
    return Object.entries(payload as InspectAllLabsResponse)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([labName, containers]) => ({ labName, containers }));
  }

  const containers = payload as InspectLabResponse;
  const resolvedLabName = containers[0]?.labName || requestTitle;
  return [{ labName: resolvedLabName, containers }];
}

function filterInspectGroups(groups: InspectGroup[], query: string): InspectGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return groups;
  }

  return groups
    .map((group) => ({
      labName: group.labName,
      containers: group.containers.filter((container) => {
        const haystack = [
          container.name,
          container.kind,
          container.image,
          container.state,
          container.status,
          container.owner,
          container.ipv4Address,
          container.ipv6Address
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    }))
    .filter((group) => group.containers.length > 0);
}

function scoreNodeMatch(labName: string, container: ContainerState, requestedNodeName: string): number {
  const normalizedRequested = requestedNodeName.trim().toLowerCase();
  if (!normalizedRequested) {
    return 0;
  }
  const normalizedContainerName = container.name.trim().toLowerCase();
  if (normalizedContainerName === normalizedRequested) {
    return 100;
  }

  const normalizedNodeName = container.nodeName.trim().toLowerCase();
  if (normalizedNodeName === normalizedRequested) {
    return 90;
  }
  if (normalizedNodeName.startsWith(`${normalizedRequested}-`)) {
    return 80;
  }

  const shortName = normalizedContainerName.startsWith(`clab-${labName.toLowerCase()}-`)
    ? normalizedContainerName.slice(`clab-${labName.toLowerCase()}-`.length)
    : normalizedContainerName;
  if (shortName === normalizedRequested) {
    return 70;
  }
  if (shortName.startsWith(`${normalizedRequested}-`)) {
    return 60;
  }

  return 0;
}

function findRuntimeContainer(
  labs: Map<string, LabState>,
  input: {
    endpointId?: string;
    nodeName: string;
    topologyRef?: RuntimeTargetRequest["topologyRef"];
  }
): ContainerState | undefined {
  const topologyHint = input.topologyRef?.yamlPath
    ? {
        topologyId: input.topologyRef.topologyId,
        yamlPath: input.topologyRef.yamlPath,
        labName: input.topologyRef.labName,
        endpointId: input.endpointId
      }
    : undefined;
  const lab = findLabStateForTopology(topologyHint, labs);
  const candidateLabs = lab ? [lab] : [...labs.values()];

  let bestContainer: ContainerState | undefined;
  let bestScore = 0;
  for (const candidateLab of candidateLabs) {
    for (const container of candidateLab.containers.values()) {
      const score = scoreNodeMatch(candidateLab.name, container, input.nodeName);
      if (score > bestScore) {
        bestContainer = container;
        bestScore = score;
      }
    }
  }

  return bestScore > 0 ? bestContainer : undefined;
}

function sortedInterfaceNames(container: ContainerState | undefined): string[] {
  if (!container) {
    return [];
  }
  return [...container.interfaces.values()]
    .filter((iface) => iface.name !== "lo")
    .map((iface) => iface.alias || iface.name)
    .sort((left, right) => left.localeCompare(right));
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mergeInterfaceFields(
  interfaceNames: string[],
  current: Record<string, NetemFields>
): Record<string, NetemFields> {
  const next: Record<string, NetemFields> = {};
  for (const interfaceName of interfaceNames) {
    next[interfaceName] = normalizeNetemFields(current[interfaceName]);
  }
  return next;
}

export function RuntimeActionDialogs() {
  const labs = useLabStore((state) => state.labs);
  const inspectRequest = useRuntimeUiStore((state) => state.inspectRequest);
  const logsRequest = useRuntimeUiStore((state) => state.logsRequest);
  const netemRequest = useRuntimeUiStore((state) => state.netemRequest);
  const snackbar = useRuntimeUiStore((state) => state.snackbar);
  const versionOpen = useRuntimeUiStore((state) => state.versionOpen);
  const closeInspect = useRuntimeUiStore((state) => state.closeInspect);
  const closeLogs = useRuntimeUiStore((state) => state.closeLogs);
  const closeNetem = useRuntimeUiStore((state) => state.closeNetem);
  const closeSnackbar = useRuntimeUiStore((state) => state.closeSnackbar);

  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectGroups, setInspectGroups] = useState<InspectGroup[]>([]);
  const [inspectFilter, setInspectFilter] = useState("");

  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsTail, setLogsTail] = useState("200");
  const [logsContent, setLogsContent] = useState("");

  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState("");
  const [versionCheck, setVersionCheck] = useState("");

  const [netemLoading, setNetemLoading] = useState(false);
  const [netemError, setNetemError] = useState<string | null>(null);
  const [netemContainerName, setNetemContainerName] = useState("");
  const [netemFieldsByInterface, setNetemFieldsByInterface] = useState<Record<string, NetemFields>>({});
  const [netemPendingInterface, setNetemPendingInterface] = useState<string | null>(null);

  const filteredInspectGroups = useMemo(
    () => filterInspectGroups(inspectGroups, inspectFilter),
    [inspectGroups, inspectFilter]
  );

  const runtimeContainer = useMemo(() => {
    if (!netemRequest) {
      return undefined;
    }
    return findRuntimeContainer(labs, {
      endpointId: netemRequest.endpointId,
      topologyRef: netemRequest.topologyRef,
      nodeName: netemRequest.nodeName
    });
  }, [labs, netemRequest]);

  const availableInterfaces = useMemo(
    () => sortedInterfaceNames(runtimeContainer),
    [runtimeContainer]
  );

  useEffect(() => {
    if (!inspectRequest) {
      setInspectGroups([]);
      setInspectError(null);
      setInspectFilter("");
      return;
    }

    let cancelled = false;
    setInspectLoading(true);
    setInspectError(null);

    const load = async () => {
      try {
        const payload =
          inspectRequest.mode === "all"
            ? await inspectAllLabs()
            : await inspectLab(inspectRequest.target ?? {});
        if (cancelled) {
          return;
        }
        setInspectGroups(
          normalizeInspectGroups(inspectRequest.title, inspectRequest.mode, payload)
        );
      } catch (error) {
        if (!cancelled) {
          setInspectError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setInspectLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [inspectRequest]);

  useEffect(() => {
    if (!logsRequest) {
      setLogsContent("");
      setLogsError(null);
      setLogsTail("200");
      return;
    }

    let cancelled = false;
    const initialTail = "200";
    setLogsTail(initialTail);
    setLogsLoading(true);
    setLogsError(null);

    const load = async () => {
      try {
        const response = await fetchNodeLogs({
          sessionId: logsRequest.sessionId,
          topologyRef: logsRequest.topologyRef,
          nodeName: logsRequest.nodeName,
          tail: initialTail
        });
        if (!cancelled) {
          setLogsContent(response.logs);
        }
      } catch (error) {
        if (!cancelled) {
          setLogsError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setLogsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [logsRequest]);

  const refreshLogs = async (): Promise<void> => {
    if (!logsRequest) {
      return;
    }
    setLogsLoading(true);
    setLogsError(null);
    try {
      const response = await fetchNodeLogs({
        sessionId: logsRequest.sessionId,
        topologyRef: logsRequest.topologyRef,
        nodeName: logsRequest.nodeName,
        tail: logsTail
      });
      setLogsContent(response.logs);
    } catch (error) {
      setLogsError(error instanceof Error ? error.message : String(error));
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (!versionOpen) {
      setVersionError(null);
      setVersionInfo("");
      setVersionCheck("");
      return;
    }

    let cancelled = false;
    setVersionLoading(true);
    setVersionError(null);

    const load = async () => {
      try {
        const [version, check] = await Promise.all([
          fetchVersionInfo(),
          fetchVersionCheck()
        ]);
        if (cancelled) {
          return;
        }
        setVersionInfo(version.versionInfo);
        setVersionCheck(check.checkResult);
      } catch (error) {
        if (!cancelled) {
          setVersionError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setVersionLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [versionOpen]);

  useEffect(() => {
    if (!netemRequest) {
      setNetemFieldsByInterface({});
      setNetemContainerName("");
      setNetemError(null);
      return;
    }

    let cancelled = false;
    setNetemLoading(true);
    setNetemError(null);
    setNetemFieldsByInterface(mergeInterfaceFields(availableInterfaces, {}));

    const load = async () => {
      try {
        const result = await fetchNetem({
          sessionId: netemRequest.sessionId,
          topologyRef: netemRequest.topologyRef,
          nodeName: netemRequest.nodeName
        });
        if (cancelled) {
          return;
        }

        const existingFields = netemFieldsFromShowResponse(
          result.impairments,
          result.containerName
        );
        const interfaceNames = [...new Set([
          ...availableInterfaces,
          ...Object.keys(existingFields)
        ])].sort((left, right) => left.localeCompare(right));

        setNetemContainerName(result.containerName);
        setNetemFieldsByInterface(mergeInterfaceFields(interfaceNames, existingFields));
      } catch (error) {
        if (!cancelled) {
          setNetemError(error instanceof Error ? error.message : String(error));
          setNetemFieldsByInterface(mergeInterfaceFields(availableInterfaces, {}));
        }
      } finally {
        if (!cancelled) {
          setNetemLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [availableInterfaces, netemRequest]);

  const applyNetem = async (interfaceName: string): Promise<void> => {
    if (!netemRequest) {
      return;
    }
    const fields = normalizeNetemFields(netemFieldsByInterface[interfaceName]);
    setNetemPendingInterface(interfaceName);
    setNetemError(null);

    try {
      await setNetem({
        sessionId: netemRequest.sessionId,
        topologyRef: netemRequest.topologyRef,
        nodeName: netemRequest.nodeName,
        interfaceName,
        delay: fields.delay.trim() || undefined,
        jitter: fields.jitter.trim() || undefined,
        loss: parseOptionalNumber(fields.loss),
        rate: parseOptionalNumber(fields.rate),
        corruption: parseOptionalNumber(fields.corruption)
      });
      runtimeUiActions.notify(`Updated impairments for ${interfaceName}.`, "success");
    } catch (error) {
      setNetemError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetemPendingInterface(null);
    }
  };

  const clearNetem = async (interfaceName: string): Promise<void> => {
    if (!netemRequest) {
      return;
    }
    setNetemPendingInterface(interfaceName);
    setNetemError(null);

    try {
      await resetNetem({
        sessionId: netemRequest.sessionId,
        topologyRef: netemRequest.topologyRef,
        nodeName: netemRequest.nodeName,
        interfaceName
      });
      setNetemFieldsByInterface((current) => ({
        ...current,
        [interfaceName]: EMPTY_NETEM_FIELDS
      }));
      runtimeUiActions.notify(`Cleared impairments for ${interfaceName}.`, "success");
    } catch (error) {
      setNetemError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetemPendingInterface(null);
    }
  };

  return (
    <>
      <Dialog open={inspectRequest !== null} onClose={closeInspect} maxWidth="lg" fullWidth>
        <DialogTitle>{inspectRequest?.title ?? "Inspect"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              label="Filter"
              value={inspectFilter}
              onChange={(event) => setInspectFilter(event.target.value)}
              size="small"
              fullWidth
            />
            {inspectLoading ? <Typography>Loading inspect data...</Typography> : null}
            {inspectError ? <Alert severity="error">{inspectError}</Alert> : null}
            {!inspectLoading && !inspectError && filteredInspectGroups.length === 0 ? (
              <Alert severity="info">No matching running lab data.</Alert>
            ) : null}
            {filteredInspectGroups.map((group) => (
              <Box key={group.labName}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {group.labName}
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Kind</TableCell>
                        <TableCell>State</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>IPv4</TableCell>
                        <TableCell>IPv6</TableCell>
                        <TableCell>Owner</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.containers.map((container) => (
                        <TableRow key={`${group.labName}:${container.name}`}>
                          <TableCell>{container.name}</TableCell>
                          <TableCell>{container.kind}</TableCell>
                          <TableCell>{container.state}</TableCell>
                          <TableCell>{container.status}</TableCell>
                          <TableCell>{container.ipv4Address || "-"}</TableCell>
                          <TableCell>{container.ipv6Address || "-"}</TableCell>
                          <TableCell>{container.owner || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeInspect}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={logsRequest !== null} onClose={closeLogs} maxWidth="lg" fullWidth>
        <DialogTitle>{logsRequest?.title ?? "Node Logs"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                label="Tail"
                value={logsTail}
                onChange={(event) => setLogsTail(event.target.value)}
                size="small"
                sx={{ maxWidth: 200 }}
              />
              <Button variant="outlined" onClick={() => void refreshLogs()} disabled={logsLoading}>
                Refresh
              </Button>
            </Stack>
            {logsLoading ? <Typography>Loading logs...</Typography> : null}
            {logsError ? <Alert severity="error">{logsError}</Alert> : null}
            <Paper
              variant="outlined"
              sx={{
                bgcolor: "background.default",
                maxHeight: 480,
                overflow: "auto",
                p: 2
              }}
            >
              <Typography
                component="pre"
                sx={{
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word"
                }}
              >
                {logsContent || "No logs returned."}
              </Typography>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeLogs}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={netemRequest !== null}
        onClose={closeNetem}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>{netemRequest?.title ?? "Manage Impairments"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {netemLoading ? <Typography>Loading impairment state...</Typography> : null}
            {netemError ? <Alert severity="error">{netemError}</Alert> : null}
            {netemContainerName ? (
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                Container: {netemContainerName}
              </Typography>
            ) : null}
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Interface</TableCell>
                    <TableCell>Delay</TableCell>
                    <TableCell>Jitter</TableCell>
                    <TableCell>Loss</TableCell>
                    <TableCell>Rate</TableCell>
                    <TableCell>Corruption</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.keys(netemFieldsByInterface).map((interfaceName) => {
                    const fields = normalizeNetemFields(netemFieldsByInterface[interfaceName]);
                    return (
                      <TableRow key={interfaceName}>
                        <TableCell>{interfaceName}</TableCell>
                        {(["delay", "jitter", "loss", "rate", "corruption"] as Array<keyof NetemFields>).map((fieldKey) => (
                          <TableCell key={`${interfaceName}:${fieldKey}`}>
                            <TextField
                              size="small"
                              value={fields[fieldKey]}
                              onChange={(event) => {
                                const value = event.target.value;
                                setNetemFieldsByInterface((current) => ({
                                  ...current,
                                  [interfaceName]: {
                                    ...normalizeNetemFields(current[interfaceName]),
                                    [fieldKey]: value
                                  }
                                }));
                              }}
                            />
                          </TableCell>
                        ))}
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => void applyNetem(interfaceName)}
                              disabled={netemPendingInterface === interfaceName}
                            >
                              Apply
                            </Button>
                            <Button
                              size="small"
                              color="warning"
                              variant="outlined"
                              onClick={() => void clearNetem(interfaceName)}
                              disabled={netemPendingInterface === interfaceName}
                            >
                              Reset
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            {!netemLoading && Object.keys(netemFieldsByInterface).length === 0 ? (
              <Alert severity="info">No runtime interface data is available for this node.</Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeNetem}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={versionOpen}
        onClose={runtimeUiActions.closeVersion}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Version Information</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {versionLoading ? <Typography>Loading version details...</Typography> : null}
            {versionError ? <Alert severity="error">{versionError}</Alert> : null}
            {versionInfo ? (
              <TextField
                label="Containerlab Version"
                value={versionInfo}
                fullWidth
                multiline
                minRows={6}
                slotProps={{ input: { readOnly: true } }}
              />
            ) : null}
            {versionCheck ? (
              <TextField
                label="Update Check"
                value={versionCheck}
                fullWidth
                multiline
                minRows={3}
                slotProps={{ input: { readOnly: true } }}
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={runtimeUiActions.closeVersion}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={closeSnackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={closeSnackbar} severity={snackbar.severity} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}

export async function createTopologyFileFlow(): Promise<void> {
  const rawFileName = window.prompt("New topology file name", "new-lab.clab.yml");
  if (!rawFileName) {
    return;
  }

  try {
    const created = await createTopologyFile({ fileName: rawFileName });
    runtimeUiActions.notify(`Created topology file "${rawFileName}".`, "success");
    runtimeUiActions.openInspectLab({ topologyRef: created.topologyRef }, `New Topology: ${rawFileName}`);
  } catch (error) {
    runtimeUiActions.notify(
      error instanceof Error ? error.message : String(error),
      "error"
    );
  }
}

export async function deleteTopologyFileFlow(target: RuntimeTargetRequest): Promise<boolean> {
  const fileLabel = target.topologyRef?.yamlPath ?? "this topology file";
  if (!window.confirm(`Delete ${fileLabel}?`)) {
    return false;
  }

  try {
    await deleteTopologyFile(target);
    runtimeUiActions.notify(`Deleted ${fileLabel}.`, "success");
    return true;
  } catch (error) {
    runtimeUiActions.notify(
      error instanceof Error ? error.message : String(error),
      "error"
    );
    return false;
  }
}

export async function saveConfigsFlow(target: {
  endpointId?: string;
  sessionId?: string;
  topologyRef?: RuntimeTargetRequest["topologyRef"];
  nodeName?: string;
}, successLabel: string): Promise<void> {
  try {
    const response = await saveLabConfigs(target);
    runtimeUiActions.notify(response.message || successLabel, "success");
  } catch (error) {
    runtimeUiActions.notify(
      error instanceof Error ? error.message : String(error),
      "error"
    );
  }
}
