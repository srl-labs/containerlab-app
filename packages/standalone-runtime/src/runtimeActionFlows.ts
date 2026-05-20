import {
  createTopologyFile,
  deleteTopologyFile,
  saveLabConfigs,
  type RuntimeTargetRequest
} from "./runtimeApi";
import { runtimeUiActions } from "./stores/runtimeUiStore";

export type RuntimeDialogSeverity = "default" | "warning" | "error";

export interface RuntimeConfirmDialogRequest {
  cancelLabel?: string;
  confirmLabel?: string;
  message: string;
  severity?: RuntimeDialogSeverity;
  title?: string;
}

export interface ActiveRuntimeConfirmDialogRequest {
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  severity: RuntimeDialogSeverity;
  title: string;
}

export interface RuntimeTextInputDialogRequest {
  allowEmpty?: boolean;
  cancelLabel?: string;
  confirmLabel?: string;
  defaultValue?: string;
  helperText?: string;
  label?: string;
  message?: string;
  multiline?: boolean;
  title?: string;
}

export interface ActiveRuntimeTextInputDialogRequest {
  allowEmpty: boolean;
  cancelLabel: string;
  confirmLabel: string;
  defaultValue: string;
  helperText: string;
  label: string;
  message: string;
  multiline: boolean;
  title: string;
}

export interface RuntimeOptionSelectionDialogRequest {
  cancelLabel?: string;
  confirmLabel?: string;
  label?: string;
  message?: string;
  options: EndpointSelectionOption[];
  preferredValue?: string;
  title?: string;
}

export interface ActiveRuntimeOptionSelectionDialogRequest {
  cancelLabel: string;
  confirmLabel: string;
  label: string;
  message: string;
  options: EndpointSelectionOption[];
  preferredValue: string;
  title: string;
}

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
type RuntimeConfirmDialogRequester = (
  request: ActiveRuntimeConfirmDialogRequest
) => Promise<boolean>;
type RuntimeTextInputDialogRequester = (
  request: ActiveRuntimeTextInputDialogRequest
) => Promise<string | undefined>;
type RuntimeOptionSelectionDialogRequester = (
  request: ActiveRuntimeOptionSelectionDialogRequest
) => Promise<string | undefined>;

let requestTopologyFileNameFromDialog: TopologyFileNameDialogRequester | null = null;
let requestEndpointSelectionFromDialog: EndpointSelectionDialogRequester | null = null;
let requestCreateTopologyFromDialog: CreateTopologyDialogRequester | null = null;
let requestCloneRepoFromDialog: CloneRepoDialogRequester | null = null;
let requestRuntimeConfirmFromDialog: RuntimeConfirmDialogRequester | null = null;
let requestRuntimeTextInputFromDialog: RuntimeTextInputDialogRequester | null = null;
let requestRuntimeOptionSelectionFromDialog: RuntimeOptionSelectionDialogRequester | null = null;

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

export function setRuntimeConfirmDialogRequester(
  requester: RuntimeConfirmDialogRequester
): () => void {
  requestRuntimeConfirmFromDialog = requester;
  return () => {
    if (requestRuntimeConfirmFromDialog === requester) {
      requestRuntimeConfirmFromDialog = null;
    }
  };
}

export function setRuntimeTextInputDialogRequester(
  requester: RuntimeTextInputDialogRequester
): () => void {
  requestRuntimeTextInputFromDialog = requester;
  return () => {
    if (requestRuntimeTextInputFromDialog === requester) {
      requestRuntimeTextInputFromDialog = null;
    }
  };
}

export function setRuntimeOptionSelectionDialogRequester(
  requester: RuntimeOptionSelectionDialogRequester
): () => void {
  requestRuntimeOptionSelectionFromDialog = requester;
  return () => {
    if (requestRuntimeOptionSelectionFromDialog === requester) {
      requestRuntimeOptionSelectionFromDialog = null;
    }
  };
}

function normalizeRuntimeConfirmDialogRequest(
  request: RuntimeConfirmDialogRequest
): ActiveRuntimeConfirmDialogRequest {
  return {
    title: request.title?.trim() || "Confirm Action",
    message: request.message.trim(),
    confirmLabel: request.confirmLabel?.trim() || "Continue",
    cancelLabel: request.cancelLabel?.trim() || "Cancel",
    severity: request.severity ?? "default"
  };
}

export function confirmRuntimeAction(request: RuntimeConfirmDialogRequest): Promise<boolean> {
  const normalizedRequest = normalizeRuntimeConfirmDialogRequest(request);
  if (!normalizedRequest.message) {
    return Promise.resolve(false);
  }
  if (requestRuntimeConfirmFromDialog) {
    return requestRuntimeConfirmFromDialog(normalizedRequest);
  }
  return Promise.resolve(false);
}

function normalizeRuntimeTextInputDialogRequest(
  request: RuntimeTextInputDialogRequest
): ActiveRuntimeTextInputDialogRequest {
  return {
    title: request.title?.trim() || "Enter Value",
    message: request.message?.trim() || "",
    label: request.label?.trim() || "Value",
    defaultValue: request.defaultValue ?? "",
    helperText: request.helperText?.trim() || "",
    confirmLabel: request.confirmLabel?.trim() || "Continue",
    cancelLabel: request.cancelLabel?.trim() || "Cancel",
    allowEmpty: Boolean(request.allowEmpty),
    multiline: Boolean(request.multiline)
  };
}

export function promptForTextInput(
  request: RuntimeTextInputDialogRequest
): Promise<string | undefined> {
  const normalizedRequest = normalizeRuntimeTextInputDialogRequest(request);
  if (requestRuntimeTextInputFromDialog) {
    return requestRuntimeTextInputFromDialog(normalizedRequest);
  }
  return Promise.resolve(undefined);
}

function normalizeRuntimeOptionSelectionDialogRequest(
  request: RuntimeOptionSelectionDialogRequest
): ActiveRuntimeOptionSelectionDialogRequest {
  const options = request.options.filter((option) => option.value.trim().length > 0);
  const preferredValue =
    request.preferredValue && options.some((option) => option.value === request.preferredValue)
      ? request.preferredValue
      : options[0]?.value ?? "";
  return {
    title: request.title?.trim() || "Select Option",
    message: request.message?.trim() || "Choose an option to continue.",
    label: request.label?.trim() || "Option",
    confirmLabel: request.confirmLabel?.trim() || "Continue",
    cancelLabel: request.cancelLabel?.trim() || "Cancel",
    options,
    preferredValue
  };
}

export function promptForOptionSelection(
  request: RuntimeOptionSelectionDialogRequest
): Promise<string | undefined> {
  const normalizedRequest = normalizeRuntimeOptionSelectionDialogRequest(request);
  if (normalizedRequest.options.length === 0 || !normalizedRequest.preferredValue) {
    return Promise.resolve(undefined);
  }
  if (requestRuntimeOptionSelectionFromDialog) {
    return requestRuntimeOptionSelectionFromDialog(normalizedRequest);
  }
  return Promise.resolve(undefined);
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
  return promptForTextInput({
    title: normalizedRequest.title,
    message: normalizedRequest.message,
    label: "Topology file name",
    defaultValue: normalizedRequest.defaultValue,
    confirmLabel: "Create",
    helperText: `Example: ${DEFAULT_TOPOLOGY_FILE_NAME}`
  });
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

  return promptForOptionSelection({
    title: normalizedRequest.title,
    message: normalizedRequest.message,
    label: "Endpoint",
    confirmLabel: normalizedRequest.confirmLabel,
    options: normalizedRequest.options,
    preferredValue: normalizedRequest.preferredValue
  });
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
  const sourceOptions: EndpointSelectionOption[] = [
    { label: "Repository URL", value: "url" },
    { label: "Popular Lab", value: "popular" }
  ].filter((option) => option.value !== "popular" || request.popularOptions.length > 0);
  const mode = await promptForOptionSelection({
    title: "Repository Source",
    message: "Choose how to select the repository source.",
    label: "Source",
    confirmLabel: "Continue",
    options: sourceOptions,
    preferredValue: request.defaultMode
  });
  if (mode === "url") {
    return promptForTextInput({
      title: "Repository Source",
      message: "Enter a repository or topology URL.",
      label: "Repository or topology URL",
      defaultValue: request.defaultSourceUrl,
      confirmLabel: "Continue"
    });
  }
  if (mode !== "popular" || request.popularOptions.length === 0) {
    return undefined;
  }

  return promptForOptionSelection({
    title: "Popular Lab",
    message: "Choose a popular lab repository.",
    label: "Popular lab",
    confirmLabel: "Use Repository",
    options: request.popularOptions,
    preferredValue: request.popularOptions[0]?.value
  });
}

function promptForCloneRepoTarget(
  request: ActiveCloneRepoDialogRequest
): Promise<CloneRepoDialogTarget | undefined> {
  return promptForOptionSelection({
    title: "Clone Action",
    message: "Choose what to do with the cloned repository.",
    label: "Action",
    confirmLabel: "Continue",
    options: [
      { label: "Deploy now", value: "deploy" },
      { label: "Clone to undeployed labs", value: "undeployed" }
    ],
    preferredValue: request.defaultTarget
  }).then((value) => {
    if (value === "deploy" || value === "undeployed") {
      return value;
    }
    return undefined;
  });
}

async function promptForOptionalLabNameOverride(
  defaultValue: string
): Promise<string | undefined> {
  const rawLabNameOverride = await promptForTextInput({
    title: "Lab Name Override",
    message: "Leave empty to use the default lab name.",
    label: "Lab name override",
    defaultValue,
    confirmLabel: "Continue",
    allowEmpty: true
  });
  if (rawLabNameOverride === undefined) {
    return undefined;
  }
  return rawLabNameOverride.trim() || "";
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
  const target = await promptForCloneRepoTarget(normalizedRequest);
  if (!target) {
    return undefined;
  }

  const rawLabNameOverride = await promptForOptionalLabNameOverride(
    normalizedRequest.defaultLabNameOverride
  );
  if (rawLabNameOverride === undefined) {
    return undefined;
  }
  const labNameOverride = rawLabNameOverride || undefined;
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
  const confirmed = await confirmRuntimeAction({
    title: "Delete Topology File",
    message: `Delete ${fileLabel}?`,
    confirmLabel: "Delete",
    severity: "error"
  });
  if (!confirmed) {
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
