// Dialogs of the lab tools (Clos generator, sharing options and links,
// validation results). Hosts call these; LabToolDialogs renders them.
import type { ClosGeneratorDraft, ClosGeneratorResult } from "../../lab-tools/closGenerator";
import type { ShareOptionsResult, ShareTool } from "../../lab-tools/shareOptions";

import type { EndpointSelectionOption } from "./dialogs";

export { defaultClosDraft } from "../../lab-tools/closGenerator";
export type { ClosTopologyRequest } from "../../lab-tools/closGenerator";
export { generateClosTopologyYaml } from "../../lab-tools/closTopology";
export type { ShareOptionsResult } from "../../lab-tools/shareOptions";

export interface GenerateTopologyDialogRequest {
  endpointOptions: EndpointSelectionOption[];
  defaultEndpointId?: string;
  initialDraft: ClosGeneratorDraft;
}

export interface ShareOptionsDialogRequest {
  tool: ShareTool;
  action: "attach" | "reattach";
  labName: string;
  /** The lab host can make read-only sshx links. */
  readersAvailable: boolean;
  /** The lab host takes GoTTY credentials and a shell. */
  credentialsAvailable: boolean;
  defaultPort?: number;
}

export interface ShareLink {
  label: string;
  url: string;
  description?: string;
}

export interface ShareLinksDialogRequest {
  title: string;
  links: ShareLink[];
  /** E.g. the GoTTY credentials, or why a read-only link is missing. */
  note?: string;
}

export interface ValidationResultDialogRequest {
  labName: string;
  valid: boolean;
  /** containerlab's error, or the counts of a valid topology. */
  details: string;
}

export type ActiveLabToolDialog =
  | { kind: "generate"; request: GenerateTopologyDialogRequest; resolve: (value: ClosGeneratorResult | undefined) => void }
  | { kind: "share-options"; request: ShareOptionsDialogRequest; resolve: (value: ShareOptionsResult | undefined) => void }
  | { kind: "share-links"; request: ShareLinksDialogRequest; resolve: () => void }
  | { kind: "validation"; request: ValidationResultDialogRequest; resolve: () => void };

type LabToolDialogPresenter = (dialog: ActiveLabToolDialog) => void;

let presenter: LabToolDialogPresenter | null = null;

/** Registers the component that renders lab tool dialogs; returns its cleanup. */
export function setLabToolDialogPresenter(next: LabToolDialogPresenter): () => void {
  presenter = next;
  return () => {
    if (presenter === next) presenter = null;
  };
}

/** The Clos wizard; undefined when cancelled or no dialog host is mounted. */
export function promptForGenerateTopology(
  request: GenerateTopologyDialogRequest
): Promise<ClosGeneratorResult | undefined> {
  const show = presenter;
  if (!show) return Promise.resolve(undefined);
  return new Promise((resolve) => show({ kind: "generate", request, resolve }));
}

/** sshx or GoTTY options before a share starts; undefined when cancelled. */
export function promptForShareOptions(
  request: ShareOptionsDialogRequest
): Promise<ShareOptionsResult | undefined> {
  const show = presenter;
  if (!show) return Promise.resolve(undefined);
  return new Promise((resolve) => show({ kind: "share-options", request, resolve }));
}

/** The links of a started share, to copy or open. */
export function showShareLinks(request: ShareLinksDialogRequest): Promise<void> {
  const show = presenter;
  if (!show) return Promise.resolve();
  return new Promise((resolve) => show({ kind: "share-links", request, resolve }));
}

export function showValidationResult(request: ValidationResultDialogRequest): Promise<void> {
  const show = presenter;
  if (!show) return Promise.resolve();
  return new Promise((resolve) => show({ kind: "validation", request, resolve }));
}
