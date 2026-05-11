import {
  createTopologyFile,
  deleteTopologyFile,
  saveLabConfigs,
  type RuntimeTargetRequest
} from "./runtimeApi";
import { runtimeUiActions } from "./stores/runtimeUiStore";

export interface TopologyFileNameDialogRequest {
  defaultValue?: string;
  message?: string;
  title?: string;
}

export interface ActiveTopologyFileNameDialogRequest {
  defaultValue: string;
  message: string;
  title: string;
}

export interface EndpointSelectionOption {
  description?: string;
  label: string;
  value: string;
}

export interface EndpointSelectionDialogRequest {
  confirmLabel?: string;
  message?: string;
  options: EndpointSelectionOption[];
  preferredValue?: string;
  title?: string;
}

export interface ActiveEndpointSelectionDialogRequest {
  confirmLabel: string;
  message: string;
  options: EndpointSelectionOption[];
  preferredValue: string;
  title: string;
}

export interface CreateTopologyDialogResult {
  endpointId: string;
  fileName: string;
}

export interface CreateTopologyDialogRequest {
  confirmLabel?: string;
  defaultEndpointId?: string;
  defaultFileName?: string;
  endpointOptions: EndpointSelectionOption[];
  message?: string;
  title?: string;
}

export interface ActiveCreateTopologyDialogRequest {
  confirmLabel: string;
  defaultEndpointId: string;
  defaultFileName: string;
  endpointOptions: EndpointSelectionOption[];
  message: string;
  title: string;
}

export interface CloneRepoDialogResult {
  endpointId: string;
  labNameOverride?: string;
  sourceUrl: string;
  target: CloneRepoDialogTarget;
}

export interface CloneRepoPopularOption {
  description?: string;
  label: string;
  value: string;
}

export type CloneRepoDialogTarget = "deploy" | "undeployed";

export interface CloneRepoDialogRequest {
  confirmLabel?: string;
  defaultEndpointId?: string;
  defaultLabNameOverride?: string;
  defaultMode?: "url" | "popular";
  defaultSourceUrl?: string;
  defaultTarget?: CloneRepoDialogTarget;
  endpointOptions: EndpointSelectionOption[];
  message?: string;
  popularOptions: CloneRepoPopularOption[];
  title?: string;
}

export interface ActiveCloneRepoDialogRequest {
  confirmLabel: string;
  defaultEndpointId: string;
  defaultLabNameOverride: string;
  defaultMode: "url" | "popular";
  defaultSourceUrl: string;
  defaultTarget: CloneRepoDialogTarget;
  endpointOptions: EndpointSelectionOption[];
  message: string;
  popularOptions: CloneRepoPopularOption[];
  title: string;
}

export const DEFAULT_TOPOLOGY_FILE_NAME = "new-lab.clab.yml";

type TopologyFileNameDialogRequester = (
  request: ActiveTopologyFileNameDialogRequest
) => Promise<string | undefined>;
type EndpointSelectionDialogRequester = (
  request: ActiveEndpointSelectionDialogRequest
) => Promise<string | undefined>;
type CreateTopologyDialogRequester = (
  request: ActiveCreateTopologyDialogRequest
) => Promise<CreateTopologyDialogResult | undefined>;
type CloneRepoDialogRequester = (
  request: ActiveCloneRepoDialogRequest
) => Promise<CloneRepoDialogResult | undefined>;

let requestTopologyFileNameFromDialog: TopologyFileNameDialogRequester | null = null;
let requestEndpointSelectionFromDialog: EndpointSelectionDialogRequester | null = null;
let requestCreateTopologyFromDialog: CreateTopologyDialogRequester | null = null;
let requestCloneRepoFromDialog: CloneRepoDialogRequester | null = null;

export function setTopologyFileNameDialogRequester(
  requester: TopologyFileNameDialogRequester
): () => void {
  requestTopologyFileNameFromDialog = requester;
  return () => {
    if (requestTopologyFileNameFromDialog === requester) {
      requestTopologyFileNameFromDialog = null;
    }
  };
}

export function setEndpointSelectionDialogRequester(
  requester: EndpointSelectionDialogRequester
): () => void {
  requestEndpointSelectionFromDialog = requester;
  return () => {
    if (requestEndpointSelectionFromDialog === requester) {
      requestEndpointSelectionFromDialog = null;
    }
  };
}

export function setCreateTopologyDialogRequester(
  requester: CreateTopologyDialogRequester
): () => void {
  requestCreateTopologyFromDialog = requester;
  return () => {
    if (requestCreateTopologyFromDialog === requester) {
      requestCreateTopologyFromDialog = null;
    }
  };
}

export function setCloneRepoDialogRequester(requester: CloneRepoDialogRequester): () => void {
  requestCloneRepoFromDialog = requester;
  return () => {
    if (requestCloneRepoFromDialog === requester) {
      requestCloneRepoFromDialog = null;
    }
  };
}

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
  return {
    title: request.title?.trim() || "Clone Repository",
    message: request.message?.trim() || "Select endpoint and repository source.",
    confirmLabel: request.confirmLabel?.trim() || "Continue",
    endpointOptions,
    popularOptions,
    defaultEndpointId: resolveDefaultEndpointId(request.defaultEndpointId, endpointOptions),
    defaultMode: resolveCloneRepoDefaultMode(request.defaultMode, popularOptions),
    defaultSourceUrl: request.defaultSourceUrl?.trim() || "https://github.com/srl-labs/srl-telemetry-lab",
    defaultLabNameOverride: request.defaultLabNameOverride?.trim() || "",
    defaultTarget: request.defaultTarget ?? "deploy"
  };
}

function resolveDefaultEndpointId(
  requestedEndpointId: string | undefined,
  endpointOptions: EndpointSelectionOption[]
): string {
  if (requestedEndpointId && endpointOptions.some((option) => option.value === requestedEndpointId)) {
    return requestedEndpointId;
  }
  return endpointOptions[0]?.value ?? "";
}

function resolveCloneRepoDefaultMode(
  requestedMode: "url" | "popular" | undefined,
  popularOptions: EndpointSelectionOption[]
): "url" | "popular" {
  return requestedMode === "popular" && popularOptions.length > 0 ? "popular" : "url";
}

async function promptForCloneRepoSourceUrl(
  request: ActiveCloneRepoDialogRequest
): Promise<string | undefined> {
  const mode = window.prompt(
    "Repository source:\n1. Enter Git/HTTP URL\n2. Pick from popular labs\n\nEnter number (1-2).",
    request.defaultMode === "popular" ? "2" : "1"
  );
  if (!mode) {
    return undefined;
  }

  if (mode.trim() === "1") {
    const rawSourceUrl = window.prompt("Repository or topology URL", request.defaultSourceUrl);
    return rawSourceUrl?.trim() || undefined;
  }
  if (mode.trim() !== "2" || request.popularOptions.length === 0) {
    return undefined;
  }

  const optionsText = request.popularOptions
    .map((option, index) => `${index + 1}. ${option.label}${option.description ? ` - ${option.description}` : ""}`)
    .join("\n");
  const rawSelection = window.prompt(
    `Select popular repository:\n${optionsText}\n\nEnter number (1-${request.popularOptions.length}).`,
    "1"
  );
  const selectedIndex = rawSelection ? Number.parseInt(rawSelection, 10) : 0;
  if (!Number.isFinite(selectedIndex) || selectedIndex < 1 || selectedIndex > request.popularOptions.length) {
    return undefined;
  }
  return request.popularOptions[selectedIndex - 1].value;
}

function promptForCloneRepoTarget(
  request: ActiveCloneRepoDialogRequest
): CloneRepoDialogTarget | undefined {
  const modeSelection = window.prompt(
    "Action:\n1. Deploy now\n2. Clone to undeployed labs\n\nEnter number (1-2).",
    request.defaultTarget === "undeployed" ? "2" : "1"
  );
  if (modeSelection?.trim() === "2") {
    return "undeployed";
  }
  if (modeSelection?.trim() === "1") {
    return "deploy";
  }
  return undefined;
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

  const sourceUrl = await promptForCloneRepoSourceUrl(normalizedRequest);
  if (!sourceUrl) {
    return undefined;
  }
  const target = promptForCloneRepoTarget(normalizedRequest);
  if (!target) {
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
  return { endpointId, sourceUrl, labNameOverride, target };
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
    runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
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
    runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
    return false;
  }
}

export async function saveConfigsFlow(
  target: {
    endpointId?: string;
    sessionId?: string;
    topologyRef?: RuntimeTargetRequest["topologyRef"];
    nodeName?: string;
  },
  successLabel: string
): Promise<void> {
  try {
    const response = await saveLabConfigs(target);
    runtimeUiActions.notify(response.message || successLabel, "success");
  } catch (error) {
    runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
