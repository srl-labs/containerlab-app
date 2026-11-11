// The Images view talks to the app server's `/api/runtime/images/*` routes through
// an `ImagesClient` the host supplies. These types mirror the route DTOs
// (`@srl-labs/containerlab-lab-backend` contract/images.ts) structurally, so the
// shared UI stays free of the backend package; the standalone binding type-checks
// one against the other.
import type { ImagesJobsWatcher } from "./jobsWatcher";

/** 404 body of an Images route that is off for the endpoint. */
export interface ImagesUnavailableInfo {
  reason: "unavailable";
  detail: string;
  /** Settings that turn the feature on, when it is not configured. */
  configKeys?: string[];
}

export interface ImagesDoctorCheck {
  check: string;
  /** `ok`, `warn` or `FAIL`, as `climg doctor` prints it. */
  status: string;
  detail: string;
}

export interface ImagesStatus {
  configured: true;
  contract: number;
  climgVersion: string;
  config: {
    imagesDirs: string[];
    stateDir: string;
    diskFloorBytes: number;
    maxBuilds: number;
    mirrors: string[];
    workspace?: string;
    nodetplFile?: string;
    nodetplWriter?: string;
    credentialsSet: boolean;
  };
  doctor: { checks: ImagesDoctorCheck[]; checkedAt: string; ok: boolean };
  uploadMaxBytes: number;
  uploadExtensions: string[];
  maxJobs: number;
}

export type ImagesSource = "labhub" | "local" | "all";
export type ImagesRecordStatus = "built" | "cached" | "available";

/** A record of `climg search|show --json`; `show` adds files, tags and patches. */
export interface ImageRecord {
  key: string;
  source: string;
  status: string;
  kind?: string | null;
  version?: string | null;
  name?: string;
  size?: number;
  tag?: string;
  detail?: string;
  /** Display vendor (`Cisco`, `H3C`); absent for an older `climg`. */
  vendor?: string | null;
  /** LabHub folder (`H3C/vSR`); null for local files, absent for an older `climg`. */
  folder?: string | null;
  model?: string | null;
  [field: string]: unknown;
}

export interface ImagesVendorCount {
  vendor: string;
  entries: number;
  buildable: number;
}

export interface ImagesIndexInfo {
  release?: string;
  age?: string;
  counts?: Record<string, number>;
  buildable?: number;
  /** Entries per vendor; absent for an older `climg`. */
  vendors?: ImagesVendorCount[];
  [field: string]: unknown;
}

export interface ImagesScanFile {
  path: string;
  size: number;
  kind: string | null;
  version: string | null;
  tag: string | null;
  status: string;
}

export interface ImagesSearchQuery {
  q?: string;
  kind?: string;
  vendor?: string;
  source?: ImagesSource;
  status?: ImagesRecordStatus;
  all?: boolean;
}

export interface ImagesTemplate {
  name: string;
  kind: string;
  image?: string;
  icon?: string;
  /** Created by `climg`; only these can be removed here. */
  managed: boolean;
  /** Managed and edited by the user; `climg` keeps the edited fields when it regenerates the template. */
  customized?: boolean;
  /** Whether the image is on the host; null when `climg` does not track it. */
  imagePresent: boolean | null;
}

export interface ImagesTemplateResult {
  action: string;
  dry_run: boolean;
  writer?: string;
  changes: unknown[];
  skipped: unknown[];
  added: unknown[];
  updated: unknown[];
  removed: unknown[];
  [field: string]: unknown;
}

export type ImagesJobOp = "pull" | "build" | "add";
export type ImagesJobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ImagesJobRequest {
  op: ImagesJobOp;
  ref?: string;
  file?: string;
  kind?: string;
  version?: string;
  tag?: string;
  force?: boolean;
}

export interface ImagesJob {
  id: string;
  op: ImagesJobOp;
  ref?: string;
  file?: string;
  kind?: string;
  version?: string;
  tag?: string;
  force?: boolean;
  state: ImagesJobState;
  phase: string;
  pct: number | null;
  message: string;
  log: string[];
  result?: unknown;
  error?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  nodetpl?: { name?: string; written: boolean; error?: string; kept?: string[] };
  cancelRequested?: boolean;
  /** Place in the server queue (1 = next) while the job waits for a slot. */
  queuePosition?: number;
}

export interface ImagesUploadResult {
  name: string;
  path: string;
  size: number;
  /** Free bytes of the images folder after the upload. */
  freeBytes: number;
}

export interface ImagesViewProps {
  /** The Images routes of the endpoint the view manages; absent when no endpoint can have them. */
  client?: ImagesClient;
  /** Jobs of that endpoint; kept by the host so polling outlives the view. */
  jobs?: ImagesJobsWatcher;
  /** The lab host the view manages, shown in the title bar. */
  endpointLabel?: string;
  /** Why the view is off, when the host knows without asking (no local lab host). */
  unavailable?: ImagesUnavailableInfo;
  /** Node Templates changed: the host reloads the Lab Palette's templates. */
  onTemplatesChanged?: () => void;
  onClose?: () => void;
}

/**
 * The Images routes for one endpoint. Every call rejects with an error; an error
 * whose `unavailable` field holds an {@link ImagesUnavailableInfo} means the
 * feature is off for the endpoint.
 */
export interface ImagesClient {
  status: () => Promise<ImagesStatus>;
  index: () => Promise<ImagesIndexInfo>;
  refreshIndex: () => Promise<ImagesIndexInfo>;
  search: (query: ImagesSearchQuery, signal?: AbortSignal) => Promise<ImageRecord[]>;
  show: (ref: string) => Promise<ImageRecord>;
  scan: () => Promise<ImagesScanFile[]>;
  templates: () => Promise<{ templates: ImagesTemplate[] }>;
  addTemplate: (ref: string) => Promise<ImagesTemplateResult>;
  removeTemplate: (name: string) => Promise<ImagesTemplateResult>;
  syncTemplates: (dryRun: boolean) => Promise<ImagesTemplateResult>;
  startJob: (job: ImagesJobRequest) => Promise<ImagesJob>;
  jobs: () => Promise<{ jobs: ImagesJob[]; active: number }>;
  cancelJob: (id: string) => Promise<ImagesJob>;
  upload: (
    file: File,
    options: { onProgress: (sent: number, total: number) => void; signal: AbortSignal }
  ) => Promise<ImagesUploadResult>;
}
