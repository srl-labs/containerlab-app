import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
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

interface TopologyFileNameDialogRequest {
  defaultValue?: string;
  message?: string;
  title?: string;
}

interface ActiveTopologyFileNameDialogRequest {
  defaultValue: string;
  message: string;
  title: string;
}

interface TopologyFileNameDialogState {
  request: ActiveTopologyFileNameDialogRequest;
  resolve: (value: string | undefined) => void;
}

export interface EndpointSelectionOption {
  description?: string;
  label: string;
  value: string;
}

interface EndpointSelectionDialogRequest {
  confirmLabel?: string;
  message?: string;
  options: EndpointSelectionOption[];
  preferredValue?: string;
  title?: string;
}

interface ActiveEndpointSelectionDialogRequest {
  confirmLabel: string;
  message: string;
  options: EndpointSelectionOption[];
  preferredValue: string;
  title: string;
}

interface EndpointSelectionDialogState {
  request: ActiveEndpointSelectionDialogRequest;
  resolve: (value: string | undefined) => void;
}

export interface CreateTopologyDialogResult {
  endpointId: string;
  fileName: string;
}

interface CreateTopologyDialogRequest {
  confirmLabel?: string;
  defaultEndpointId?: string;
  defaultFileName?: string;
  endpointOptions: EndpointSelectionOption[];
  message?: string;
  title?: string;
}

interface ActiveCreateTopologyDialogRequest {
  confirmLabel: string;
  defaultEndpointId: string;
  defaultFileName: string;
  endpointOptions: EndpointSelectionOption[];
  message: string;
  title: string;
}

interface CreateTopologyDialogState {
  request: ActiveCreateTopologyDialogRequest;
  resolve: (value: CreateTopologyDialogResult | undefined) => void;
}

export interface CloneRepoDialogResult {
  endpointId: string;
  labNameOverride?: string;
  sourceUrl: string;
}

export interface CloneRepoPopularOption {
  description?: string;
  label: string;
  value: string;
}

interface CloneRepoDialogRequest {
  confirmLabel?: string;
  defaultEndpointId?: string;
  defaultLabNameOverride?: string;
  defaultMode?: "url" | "popular";
  defaultSourceUrl?: string;
  endpointOptions: EndpointSelectionOption[];
  message?: string;
  popularOptions: CloneRepoPopularOption[];
  title?: string;
}

interface ActiveCloneRepoDialogRequest {
  confirmLabel: string;
  defaultEndpointId: string;
  defaultLabNameOverride: string;
  defaultMode: "url" | "popular";
  defaultSourceUrl: string;
  endpointOptions: EndpointSelectionOption[];
  message: string;
  popularOptions: CloneRepoPopularOption[];
  title: string;
}

interface CloneRepoDialogState {
  request: ActiveCloneRepoDialogRequest;
  resolve: (value: CloneRepoDialogResult | undefined) => void;
}

const EMPTY_NETEM_FIELDS: NetemFields = {
  delay: "",
  jitter: "",
  loss: "",
  rate: "",
  corruption: ""
};
const DEFAULT_TOPOLOGY_FILE_NAME = "new-lab.clab.yml";
let requestTopologyFileNameFromDialog:
  | ((request: ActiveTopologyFileNameDialogRequest) => Promise<string | undefined>)
  | null = null;
let requestEndpointSelectionFromDialog:
  | ((request: ActiveEndpointSelectionDialogRequest) => Promise<string | undefined>)
  | null = null;
let requestCreateTopologyFromDialog:
  | ((request: ActiveCreateTopologyDialogRequest) => Promise<CreateTopologyDialogResult | undefined>)
  | null = null;
let requestCloneRepoFromDialog:
  | ((request: ActiveCloneRepoDialogRequest) => Promise<CloneRepoDialogResult | undefined>)
  | null = null;

function normalizeTopologyFileNameDialogRequest(
  request?: TopologyFileNameDialogRequest
): ActiveTopologyFileNameDialogRequest {
  return {
    title: request?.title?.trim() || "Create Topology File",
    message: request?.message?.trim() || "Enter a file name for the new topology file.",
    defaultValue: request?.defaultValue ?? DEFAULT_TOPOLOGY_FILE_NAME
  };
}

export function promptForTopologyFileName(
  request?: TopologyFileNameDialogRequest
): Promise<string | undefined> {
  const normalizedRequest = normalizeTopologyFileNameDialogRequest(request);
  if (requestTopologyFileNameFromDialog) {
    return requestTopologyFileNameFromDialog(normalizedRequest);
  }
  const fallbackValue = window.prompt("New topology file name", normalizedRequest.defaultValue);
  const trimmedValue = fallbackValue?.trim();
  return Promise.resolve(trimmedValue && trimmedValue.length > 0 ? trimmedValue : undefined);
}

function normalizeEndpointSelectionDialogRequest(
  request: EndpointSelectionDialogRequest
): ActiveEndpointSelectionDialogRequest {
  const options = request.options.filter((option) => option.value.trim().length > 0);
  const preferredValue =
    request.preferredValue && options.some((option) => option.value === request.preferredValue)
      ? request.preferredValue
      : options[0]?.value ?? "";
  return {
    title: request.title?.trim() || "Select Endpoint",
    message: request.message?.trim() || "Choose an endpoint to continue.",
    confirmLabel: request.confirmLabel?.trim() || "Continue",
    options,
    preferredValue
  };
}

export function promptForEndpointSelection(
  request: EndpointSelectionDialogRequest
): Promise<string | undefined> {
  const normalizedRequest = normalizeEndpointSelectionDialogRequest(request);
  if (normalizedRequest.options.length === 0 || !normalizedRequest.preferredValue) {
    return Promise.resolve(undefined);
  }
  if (requestEndpointSelectionFromDialog) {
    return requestEndpointSelectionFromDialog(normalizedRequest);
  }

  const optionsText = normalizedRequest.options
    .map(
      (option, index) =>
        `${index + 1}. ${option.label}${option.description ? ` (${option.description})` : ""}`
    )
    .join("\n");
  const defaultIndex = Math.max(
    1,
    normalizedRequest.options.findIndex((option) => option.value === normalizedRequest.preferredValue) + 1
  );
  const fallbackValue = window.prompt(
    `${normalizedRequest.message}\n${optionsText}\n\nEnter number (1-${normalizedRequest.options.length}).`,
    String(defaultIndex)
  );
  if (!fallbackValue) {
    return Promise.resolve(undefined);
  }
  const selectedIndex = Number.parseInt(fallbackValue, 10);
  if (
    !Number.isFinite(selectedIndex) ||
    selectedIndex < 1 ||
    selectedIndex > normalizedRequest.options.length
  ) {
    return Promise.resolve(undefined);
  }
  return Promise.resolve(normalizedRequest.options[selectedIndex - 1].value);
}

function normalizeCreateTopologyDialogRequest(
  request: CreateTopologyDialogRequest
): ActiveCreateTopologyDialogRequest {
  const endpointOptions = request.endpointOptions.filter((option) => option.value.trim().length > 0);
  const defaultEndpointId =
    request.defaultEndpointId &&
    endpointOptions.some((option) => option.value === request.defaultEndpointId)
      ? request.defaultEndpointId
      : endpointOptions[0]?.value ?? "";
  return {
    title: request.title?.trim() || "Create Topology File",
    message: request.message?.trim() || "Choose endpoint and file name for the new topology file.",
    confirmLabel: request.confirmLabel?.trim() || "Create",
    endpointOptions,
    defaultEndpointId,
    defaultFileName: request.defaultFileName ?? DEFAULT_TOPOLOGY_FILE_NAME
  };
}

export async function promptForCreateTopology(
  request: CreateTopologyDialogRequest
): Promise<CreateTopologyDialogResult | undefined> {
  const normalizedRequest = normalizeCreateTopologyDialogRequest(request);
  if (normalizedRequest.endpointOptions.length === 0 || !normalizedRequest.defaultEndpointId) {
    return undefined;
  }
  if (requestCreateTopologyFromDialog) {
    return requestCreateTopologyFromDialog(normalizedRequest);
  }

  const endpointId = await promptForEndpointSelection({
    title: "Select Endpoint",
    message: normalizedRequest.message,
    confirmLabel: "Use Endpoint",
    options: normalizedRequest.endpointOptions,
    preferredValue: normalizedRequest.defaultEndpointId
  });
  if (!endpointId) {
    return undefined;
  }
  const fileName = await promptForTopologyFileName({
    defaultValue: normalizedRequest.defaultFileName,
    title: normalizedRequest.title,
    message: "Enter a file name for the new topology file."
  });
  if (!fileName) {
    return undefined;
  }
  return { endpointId, fileName };
}

function normalizeCloneRepoDialogRequest(request: CloneRepoDialogRequest): ActiveCloneRepoDialogRequest {
  const endpointOptions = request.endpointOptions.filter((option) => option.value.trim().length > 0);
  const popularOptions = request.popularOptions.filter((option) => option.value.trim().length > 0);
  const defaultEndpointId =
    request.defaultEndpointId &&
    endpointOptions.some((option) => option.value === request.defaultEndpointId)
      ? request.defaultEndpointId
      : endpointOptions[0]?.value ?? "";
  const defaultMode = request.defaultMode === "popular" && popularOptions.length > 0 ? "popular" : "url";
  return {
    title: request.title?.trim() || "Clone Repository",
    message: request.message?.trim() || "Select endpoint and repository source.",
    confirmLabel: request.confirmLabel?.trim() || "Deploy",
    endpointOptions,
    popularOptions,
    defaultEndpointId,
    defaultMode,
    defaultSourceUrl: request.defaultSourceUrl?.trim() || "https://github.com/srl-labs/srl-telemetry-lab",
    defaultLabNameOverride: request.defaultLabNameOverride?.trim() || ""
  };
}

export async function promptForCloneRepo(
  request: CloneRepoDialogRequest
): Promise<CloneRepoDialogResult | undefined> {
  const normalizedRequest = normalizeCloneRepoDialogRequest(request);
  if (normalizedRequest.endpointOptions.length === 0 || !normalizedRequest.defaultEndpointId) {
    return undefined;
  }
  if (requestCloneRepoFromDialog) {
    return requestCloneRepoFromDialog(normalizedRequest);
  }

  const endpointId = await promptForEndpointSelection({
    title: "Select Endpoint",
    message: normalizedRequest.message,
    confirmLabel: "Use Endpoint",
    options: normalizedRequest.endpointOptions,
    preferredValue: normalizedRequest.defaultEndpointId
  });
  if (!endpointId) {
    return undefined;
  }

  const mode = window.prompt(
    "Repository source:\n1. Enter Git/HTTP URL\n2. Pick from popular labs\n\nEnter number (1-2).",
    normalizedRequest.defaultMode === "popular" ? "2" : "1"
  );
  if (!mode) {
    return undefined;
  }

  let sourceUrl = "";
  if (mode.trim() === "2") {
    if (normalizedRequest.popularOptions.length === 0) {
      return undefined;
    }
    const optionsText = normalizedRequest.popularOptions
      .map((option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`)
      .join("\n");
    const rawSelection = window.prompt(
      `Select popular repository:\n${optionsText}\n\nEnter number (1-${normalizedRequest.popularOptions.length}).`,
      "1"
    );
    if (!rawSelection) {
      return undefined;
    }
    const selectedIndex = Number.parseInt(rawSelection, 10);
    if (
      !Number.isFinite(selectedIndex) ||
      selectedIndex < 1 ||
      selectedIndex > normalizedRequest.popularOptions.length
    ) {
      return undefined;
    }
    sourceUrl = normalizedRequest.popularOptions[selectedIndex - 1].value;
  } else if (mode.trim() === "1") {
    const rawSourceUrl = window.prompt("Repository or topology URL", normalizedRequest.defaultSourceUrl);
    if (!rawSourceUrl) {
      return undefined;
    }
    sourceUrl = rawSourceUrl.trim();
  } else {
    return undefined;
  }

  if (!sourceUrl) {
    return undefined;
  }
  const rawLabNameOverride = window.prompt(
    "Optional lab name override (leave empty to use default)",
    normalizedRequest.defaultLabNameOverride
  );
  if (rawLabNameOverride === null) {
    return undefined;
  }
  const labNameOverride = rawLabNameOverride.trim() || undefined;
  return { endpointId, sourceUrl, labNameOverride };
}

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

function inspectStateColor(state: string): "default" | "error" | "success" | "warning" {
  const normalized = state.trim().toLowerCase();
  if (!normalized) {
    return "default";
  }
  if (
    normalized.includes("exit") ||
    normalized.includes("stop") ||
    normalized.includes("dead") ||
    normalized.includes("fail") ||
    normalized.includes("down")
  ) {
    return "error";
  }
  if (normalized.includes("pause") || normalized.includes("restart")) {
    return "warning";
  }
  if (normalized.includes("run") || normalized.includes("up") || normalized.includes("healthy")) {
    return "success";
  }
  return "default";
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

function countLogLines(content: string): number {
  if (!content) {
    return 0;
  }
  return content.split(/\r?\n/).length;
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
  const [logsFollow, setLogsFollow] = useState(true);
  const [logsFilter, setLogsFilter] = useState("");
  const [logsContent, setLogsContent] = useState("");
  const logsFetchRequestIdRef = useRef(0);
  const logsPaperRef = useRef<HTMLDivElement | null>(null);

  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState("");
  const [versionCheck, setVersionCheck] = useState("");

  const [netemLoading, setNetemLoading] = useState(false);
  const [netemError, setNetemError] = useState<string | null>(null);
  const [netemContainerName, setNetemContainerName] = useState("");
  const [netemFieldsByInterface, setNetemFieldsByInterface] = useState<Record<string, NetemFields>>({});
  const [netemPendingInterface, setNetemPendingInterface] = useState<string | null>(null);
  const [topologyFileNameDialog, setTopologyFileNameDialog] = useState<TopologyFileNameDialogState | null>(null);
  const [topologyFileNameInput, setTopologyFileNameInput] = useState(DEFAULT_TOPOLOGY_FILE_NAME);
  const [endpointSelectionDialog, setEndpointSelectionDialog] = useState<EndpointSelectionDialogState | null>(null);
  const [endpointSelectionValue, setEndpointSelectionValue] = useState("");
  const [createTopologyDialog, setCreateTopologyDialog] = useState<CreateTopologyDialogState | null>(null);
  const [createTopologyEndpointValue, setCreateTopologyEndpointValue] = useState("");
  const [createTopologyFileNameInput, setCreateTopologyFileNameInput] = useState(DEFAULT_TOPOLOGY_FILE_NAME);
  const [cloneRepoDialog, setCloneRepoDialog] = useState<CloneRepoDialogState | null>(null);
  const [cloneRepoEndpointValue, setCloneRepoEndpointValue] = useState("");
  const [cloneRepoMode, setCloneRepoMode] = useState<"url" | "popular">("url");
  const [cloneRepoSourceUrlInput, setCloneRepoSourceUrlInput] = useState(
    "https://github.com/srl-labs/srl-telemetry-lab"
  );
  const [cloneRepoPopularValue, setCloneRepoPopularValue] = useState("");
  const [cloneRepoLabNameOverrideInput, setCloneRepoLabNameOverrideInput] = useState("");
  const topologyFileNameDialogRef = useRef<TopologyFileNameDialogState | null>(null);
  const endpointSelectionDialogRef = useRef<EndpointSelectionDialogState | null>(null);
  const createTopologyDialogRef = useRef<CreateTopologyDialogState | null>(null);
  const cloneRepoDialogRef = useRef<CloneRepoDialogState | null>(null);

  const filteredInspectGroups = useMemo(
    () => filterInspectGroups(inspectGroups, inspectFilter),
    [inspectGroups, inspectFilter]
  );

  const filteredLogsContent = useMemo(() => {
    const normalizedFilter = logsFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return logsContent;
    }
    return logsContent
      .split(/\r?\n/)
      .filter((line) => line.toLowerCase().includes(normalizedFilter))
      .join("\n");
  }, [logsContent, logsFilter]);

  const totalLogLines = useMemo(() => countLogLines(logsContent), [logsContent]);
  const visibleLogLines = useMemo(() => countLogLines(filteredLogsContent), [filteredLogsContent]);

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
  const trimmedTopologyFileNameInput = topologyFileNameInput.trim();
  const trimmedCreateTopologyFileNameInput = createTopologyFileNameInput.trim();
  const trimmedCloneRepoSourceUrlInput = cloneRepoSourceUrlInput.trim();
  const trimmedCloneRepoLabNameOverrideInput = cloneRepoLabNameOverrideInput.trim();
  const endpointSelectionIsValid = useMemo(
    () =>
      endpointSelectionDialog
        ? endpointSelectionDialog.request.options.some((option) => option.value === endpointSelectionValue)
        : false,
    [endpointSelectionDialog, endpointSelectionValue]
  );
  const createTopologyEndpointIsValid = useMemo(
    () =>
      createTopologyDialog
        ? createTopologyDialog.request.endpointOptions.some(
            (option) => option.value === createTopologyEndpointValue
          )
        : false,
    [createTopologyDialog, createTopologyEndpointValue]
  );
  const cloneRepoEndpointIsValid = useMemo(
    () =>
      cloneRepoDialog
        ? cloneRepoDialog.request.endpointOptions.some((option) => option.value === cloneRepoEndpointValue)
        : false,
    [cloneRepoDialog, cloneRepoEndpointValue]
  );
  const cloneRepoPopularIsValid = useMemo(
    () =>
      cloneRepoDialog
        ? cloneRepoDialog.request.popularOptions.some((option) => option.value === cloneRepoPopularValue)
        : false,
    [cloneRepoDialog, cloneRepoPopularValue]
  );
  const cloneRepoResolvedSourceUrl =
    cloneRepoMode === "popular"
      ? cloneRepoPopularIsValid
        ? cloneRepoPopularValue
        : ""
      : trimmedCloneRepoSourceUrlInput;
  const cloneRepoCanSubmit = cloneRepoEndpointIsValid && cloneRepoResolvedSourceUrl.length > 0;

  useEffect(() => {
    topologyFileNameDialogRef.current = topologyFileNameDialog;
  }, [topologyFileNameDialog]);

  useEffect(() => {
    endpointSelectionDialogRef.current = endpointSelectionDialog;
  }, [endpointSelectionDialog]);

  useEffect(() => {
    createTopologyDialogRef.current = createTopologyDialog;
  }, [createTopologyDialog]);

  useEffect(() => {
    cloneRepoDialogRef.current = cloneRepoDialog;
  }, [cloneRepoDialog]);

  useEffect(() => {
    requestTopologyFileNameFromDialog = (request) =>
      new Promise((resolve) => {
        setTopologyFileNameDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      });
    return () => {
      requestTopologyFileNameFromDialog = null;
      topologyFileNameDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    requestEndpointSelectionFromDialog = (request) =>
      new Promise((resolve) => {
        setEndpointSelectionDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      });
    return () => {
      requestEndpointSelectionFromDialog = null;
      endpointSelectionDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    requestCreateTopologyFromDialog = (request) =>
      new Promise((resolve) => {
        setCreateTopologyDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      });
    return () => {
      requestCreateTopologyFromDialog = null;
      createTopologyDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    requestCloneRepoFromDialog = (request) =>
      new Promise((resolve) => {
        setCloneRepoDialog((current) => {
          current?.resolve(undefined);
          return { request, resolve };
        });
      });
    return () => {
      requestCloneRepoFromDialog = null;
      cloneRepoDialogRef.current?.resolve(undefined);
    };
  }, []);

  useEffect(() => {
    if (!topologyFileNameDialog) {
      return;
    }
    setTopologyFileNameInput(topologyFileNameDialog.request.defaultValue);
  }, [topologyFileNameDialog]);

  useEffect(() => {
    if (!endpointSelectionDialog) {
      return;
    }
    setEndpointSelectionValue(endpointSelectionDialog.request.preferredValue);
  }, [endpointSelectionDialog]);

  useEffect(() => {
    if (!createTopologyDialog) {
      return;
    }
    setCreateTopologyEndpointValue(createTopologyDialog.request.defaultEndpointId);
    setCreateTopologyFileNameInput(createTopologyDialog.request.defaultFileName);
  }, [createTopologyDialog]);

  useEffect(() => {
    if (!cloneRepoDialog) {
      return;
    }
    const matchingPopular = cloneRepoDialog.request.popularOptions.find(
      (option) => option.value === cloneRepoDialog.request.defaultSourceUrl
    );
    setCloneRepoEndpointValue(cloneRepoDialog.request.defaultEndpointId);
    setCloneRepoMode(cloneRepoDialog.request.defaultMode);
    setCloneRepoSourceUrlInput(cloneRepoDialog.request.defaultSourceUrl);
    setCloneRepoPopularValue(
      matchingPopular?.value ?? cloneRepoDialog.request.popularOptions[0]?.value ?? ""
    );
    setCloneRepoLabNameOverrideInput(cloneRepoDialog.request.defaultLabNameOverride);
  }, [cloneRepoDialog]);

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

  const fetchLogs = useCallback(async (tailValue: string, showLoading: boolean): Promise<void> => {
    if (!logsRequest) {
      return;
    }
    const requestId = ++logsFetchRequestIdRef.current;
    if (showLoading) {
      setLogsLoading(true);
    }
    setLogsError(null);
    try {
      const response = await fetchNodeLogs({
        sessionId: logsRequest.sessionId,
        topologyRef: logsRequest.topologyRef,
        nodeName: logsRequest.nodeName,
        tail: tailValue
      });
      if (requestId !== logsFetchRequestIdRef.current) {
        return;
      }
      setLogsContent(response.logs);
    } catch (error) {
      if (requestId !== logsFetchRequestIdRef.current) {
        return;
      }
      setLogsError(error instanceof Error ? error.message : String(error));
    } finally {
      if (showLoading && requestId === logsFetchRequestIdRef.current) {
        setLogsLoading(false);
      }
    }
  }, [logsRequest]);

  useEffect(() => {
    if (!logsRequest) {
      logsFetchRequestIdRef.current += 1;
      setLogsContent("");
      setLogsError(null);
      setLogsTail("200");
      setLogsFollow(true);
      setLogsFilter("");
      setLogsLoading(false);
      return;
    }

    const initialTail = "200";
    setLogsTail(initialTail);
    setLogsFollow(true);
    setLogsFilter("");
    void fetchLogs(initialTail, true);
    return () => {
      logsFetchRequestIdRef.current += 1;
    };
  }, [fetchLogs, logsRequest]);

  useEffect(() => {
    if (!logsRequest || !logsFollow) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void fetchLogs(logsTail, false);
    }, 2000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchLogs, logsFollow, logsRequest, logsTail]);

  useEffect(() => {
    if (!logsFollow) {
      return;
    }
    const paperNode = logsPaperRef.current;
    if (!paperNode) {
      return;
    }
    paperNode.scrollTop = paperNode.scrollHeight;
  }, [filteredLogsContent, logsFollow]);

  const exportLogs = useCallback((): void => {
    if (!logsRequest || !filteredLogsContent) {
      return;
    }
    const safeNodeName = logsRequest.nodeName.trim().replace(/[^A-Za-z0-9._-]/g, "-") || "node";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([filteredLogsContent], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeNodeName}-logs-${stamp}.log`;
    link.click();
    window.URL.revokeObjectURL(url);
  }, [filteredLogsContent, logsRequest]);

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

  const closeTopologyFileNameDialog = useCallback((value: string | undefined): void => {
    setTopologyFileNameDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitTopologyFileNameDialog = useCallback((): void => {
    const value = trimmedTopologyFileNameInput;
    if (!value) {
      return;
    }
    closeTopologyFileNameDialog(value);
  }, [closeTopologyFileNameDialog, trimmedTopologyFileNameInput]);

  const closeEndpointSelectionDialog = useCallback((value: string | undefined): void => {
    setEndpointSelectionDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitEndpointSelectionDialog = useCallback((): void => {
    if (!endpointSelectionIsValid) {
      return;
    }
    closeEndpointSelectionDialog(endpointSelectionValue);
  }, [closeEndpointSelectionDialog, endpointSelectionIsValid, endpointSelectionValue]);

  const closeCreateTopologyDialog = useCallback((value: CreateTopologyDialogResult | undefined): void => {
    setCreateTopologyDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitCreateTopologyDialog = useCallback((): void => {
    if (!createTopologyEndpointIsValid || !trimmedCreateTopologyFileNameInput) {
      return;
    }
    closeCreateTopologyDialog({
      endpointId: createTopologyEndpointValue,
      fileName: trimmedCreateTopologyFileNameInput
    });
  }, [
    closeCreateTopologyDialog,
    createTopologyEndpointIsValid,
    createTopologyEndpointValue,
    trimmedCreateTopologyFileNameInput
  ]);

  const closeCloneRepoDialog = useCallback((value: CloneRepoDialogResult | undefined): void => {
    setCloneRepoDialog((current) => {
      if (!current) {
        return current;
      }
      current.resolve(value);
      return null;
    });
  }, []);

  const submitCloneRepoDialog = useCallback((): void => {
    if (!cloneRepoCanSubmit) {
      return;
    }
    closeCloneRepoDialog({
      endpointId: cloneRepoEndpointValue,
      sourceUrl: cloneRepoResolvedSourceUrl,
      labNameOverride: trimmedCloneRepoLabNameOverrideInput || undefined
    });
  }, [
    cloneRepoCanSubmit,
    cloneRepoEndpointValue,
    cloneRepoResolvedSourceUrl,
    closeCloneRepoDialog,
    trimmedCloneRepoLabNameOverrideInput
  ]);

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
                          <TableCell>
                            <Chip
                              size="small"
                              label={container.state || "unknown"}
                              color={inspectStateColor(container.state)}
                              variant={container.state ? "filled" : "outlined"}
                            />
                          </TableCell>
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
              <TextField
                label="Find"
                value={logsFilter}
                onChange={(event) => setLogsFilter(event.target.value)}
                size="small"
                sx={{ minWidth: 240 }}
              />
              <Button variant="outlined" onClick={() => void fetchLogs(logsTail, true)} disabled={logsLoading}>
                Refresh
              </Button>
              <Button variant="outlined" onClick={exportLogs} disabled={!filteredLogsContent}>
                Export
              </Button>
              <FormControlLabel
                control={
                  <Switch
                    checked={logsFollow}
                    onChange={(event) => setLogsFollow(event.target.checked)}
                  />
                }
                label="Follow"
              />
            </Stack>
            {logsLoading ? <Typography>Loading logs...</Typography> : null}
            {logsError ? <Alert severity="error">{logsError}</Alert> : null}
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              {logsFilter.trim()
                ? `Showing ${visibleLogLines}/${totalLogLines} lines`
                : `${totalLogLines} lines`}
            </Typography>
            <Paper
              ref={logsPaperRef}
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
                {filteredLogsContent || (logsFilter.trim() ? "No matching log lines." : "No logs returned.")}
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

      <Dialog
        open={cloneRepoDialog !== null}
        onClose={() => closeCloneRepoDialog(undefined)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{cloneRepoDialog?.request.title ?? "Clone Repository"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {cloneRepoDialog?.request.message}
            </Typography>
            {(cloneRepoDialog?.request.endpointOptions.length ?? 0) > 1 ? (
              <FormControl fullWidth size="small">
                <InputLabel id="clone-repo-endpoint-label">Endpoint</InputLabel>
                <Select
                  labelId="clone-repo-endpoint-label"
                  label="Endpoint"
                  value={cloneRepoEndpointValue}
                  onChange={(event) => setCloneRepoEndpointValue(String(event.target.value))}
                >
                  {(cloneRepoDialog?.request.endpointOptions ?? []).map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {option.label}
                        </Typography>
                        {option.description ? (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {option.description}
                          </Typography>
                        ) : null}
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Typography variant="body2">
                Endpoint: {cloneRepoDialog?.request.endpointOptions[0]?.label ?? ""}
              </Typography>
            )}
            <FormControl fullWidth size="small">
              <InputLabel id="clone-repo-source-mode-label">Source</InputLabel>
              <Select
                labelId="clone-repo-source-mode-label"
                label="Source"
                value={cloneRepoMode}
                onChange={(event) => setCloneRepoMode(event.target.value as "url" | "popular")}
              >
                <MenuItem value="url">Repository URL</MenuItem>
                <MenuItem
                  value="popular"
                  disabled={(cloneRepoDialog?.request.popularOptions.length ?? 0) === 0}
                >
                  Popular Lab
                </MenuItem>
              </Select>
            </FormControl>
            {cloneRepoMode === "popular" ? (
              <FormControl fullWidth size="small">
                <InputLabel id="clone-repo-popular-label">Popular Lab</InputLabel>
                <Select
                  labelId="clone-repo-popular-label"
                  label="Popular Lab"
                  value={cloneRepoPopularValue}
                  onChange={(event) => setCloneRepoPopularValue(String(event.target.value))}
                >
                  {(cloneRepoDialog?.request.popularOptions ?? []).map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {option.label}
                        </Typography>
                        {option.description ? (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {option.description}
                          </Typography>
                        ) : null}
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <TextField
                autoFocus
                fullWidth
                label="Repository or topology URL"
                value={cloneRepoSourceUrlInput}
                onChange={(event) => setCloneRepoSourceUrlInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitCloneRepoDialog();
                  }
                }}
              />
            )}
            <TextField
              fullWidth
              label="Lab name override (optional)"
              value={cloneRepoLabNameOverrideInput}
              onChange={(event) => setCloneRepoLabNameOverrideInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitCloneRepoDialog();
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeCloneRepoDialog(undefined)}>Cancel</Button>
          <Button variant="contained" onClick={submitCloneRepoDialog} disabled={!cloneRepoCanSubmit}>
            {cloneRepoDialog?.request.confirmLabel ?? "Deploy"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={createTopologyDialog !== null}
        onClose={() => closeCreateTopologyDialog(undefined)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{createTopologyDialog?.request.title ?? "Create Topology File"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {createTopologyDialog?.request.message}
            </Typography>
            {(createTopologyDialog?.request.endpointOptions.length ?? 0) > 1 ? (
              <FormControl fullWidth size="small">
                <InputLabel id="create-topology-endpoint-label">Endpoint</InputLabel>
                <Select
                  labelId="create-topology-endpoint-label"
                  label="Endpoint"
                  value={createTopologyEndpointValue}
                  onChange={(event) => setCreateTopologyEndpointValue(String(event.target.value))}
                >
                  {(createTopologyDialog?.request.endpointOptions ?? []).map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {option.label}
                        </Typography>
                        {option.description ? (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {option.description}
                          </Typography>
                        ) : null}
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Typography variant="body2">
                Endpoint: {createTopologyDialog?.request.endpointOptions[0]?.label ?? ""}
              </Typography>
            )}
            <TextField
              autoFocus
              fullWidth
              label="Topology file name"
              value={createTopologyFileNameInput}
              onChange={(event) => setCreateTopologyFileNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitCreateTopologyDialog();
                }
              }}
              helperText={`Example: ${DEFAULT_TOPOLOGY_FILE_NAME}`}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeCreateTopologyDialog(undefined)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitCreateTopologyDialog}
            disabled={!createTopologyEndpointIsValid || !trimmedCreateTopologyFileNameInput}
          >
            {createTopologyDialog?.request.confirmLabel ?? "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={topologyFileNameDialog !== null}
        onClose={() => closeTopologyFileNameDialog(undefined)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{topologyFileNameDialog?.request.title ?? "Create Topology File"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {topologyFileNameDialog?.request.message}
            </Typography>
            <TextField
              autoFocus
              fullWidth
              label="Topology file name"
              value={topologyFileNameInput}
              onChange={(event) => setTopologyFileNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitTopologyFileNameDialog();
                }
              }}
              helperText={`Example: ${DEFAULT_TOPOLOGY_FILE_NAME}`}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeTopologyFileNameDialog(undefined)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitTopologyFileNameDialog}
            disabled={!trimmedTopologyFileNameInput}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={endpointSelectionDialog !== null}
        onClose={() => closeEndpointSelectionDialog(undefined)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{endpointSelectionDialog?.request.title ?? "Select Endpoint"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {endpointSelectionDialog?.request.message}
            </Typography>
            <FormControl fullWidth size="small">
              <InputLabel id="endpoint-selection-label">Endpoint</InputLabel>
              <Select
                labelId="endpoint-selection-label"
                label="Endpoint"
                value={endpointSelectionValue}
                onChange={(event) => setEndpointSelectionValue(String(event.target.value))}
              >
                {(endpointSelectionDialog?.request.options ?? []).map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {option.label}
                      </Typography>
                      {option.description ? (
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {option.description}
                        </Typography>
                      ) : null}
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeEndpointSelectionDialog(undefined)}>Cancel</Button>
          <Button variant="contained" onClick={submitEndpointSelectionDialog} disabled={!endpointSelectionIsValid}>
            {endpointSelectionDialog?.request.confirmLabel ?? "Continue"}
          </Button>
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
  const rawFileName = await promptForTopologyFileName();
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
