// DTOs of the Images routes (`/api/runtime/images/*`). The app server runs
// `climg` and passes its JSON through after a shape check, so records keep the
// fields `climg` documents (contract version 1) plus an open index signature.

/** 404 body of every Images route that is not available for the endpoint. */
export interface ImagesUnavailable {
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

/** The subset of `climg config --json` the UI needs; credentials are never included. */
export interface ImagesConfigSummary {
  imagesDirs: string[];
  stateDir: string;
  diskFloorBytes: number;
  maxBuilds: number;
  mirrors: string[];
  workspace?: string;
  nodetplFile?: string;
  nodetplWriter?: string;
  credentialsSet: boolean;
}

export interface ImagesStatusResponse {
  configured: true;
  contract: number;
  climgVersion: string;
  config: ImagesConfigSummary;
  doctor: {
    checks: ImagesDoctorCheck[];
    checkedAt: string;
    /** No check reports `FAIL`. */
    ok: boolean;
  };
  /** Upload size cap in bytes. */
  uploadMaxBytes: number;
  /** File extensions an upload may have. */
  uploadExtensions: string[];
  /** Jobs the server runs at once. */
  maxJobs: number;
  /** Pull/build jobs that run at once; further ones wait in the server queue. */
  maxRunning?: number;
  /** Jobs that may wait in the queue. */
  maxQueued?: number;
}

export type ImagesSource = "labhub" | "local" | "all";
export type ImagesRecordStatus = "built" | "cached" | "available";

/** A record of `climg search|show --json`. */
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
  /** Model within the vendor (`vSR`); null when unknown. */
  model?: string | null;
  [field: string]: unknown;
}

/** An entry of `climg scan --json`: one image file in an images folder. */
export interface ImagesScanFile {
  path: string;
  size: number;
  kind: string | null;
  version: string | null;
  tag: string | null;
  status: string;
}

/** An entry of `climg images --json`. */
export interface BuiltImage {
  tag: string;
  kind?: string | null;
  built?: boolean;
  dangling?: boolean;
  [field: string]: unknown;
}

/** `climg index --json`. */
export interface ImagesIndexInfo {
  release?: string;
  age?: string;
  counts?: Record<string, number>;
  buildable?: number;
  /** Entries per vendor; absent for an older `climg`. */
  vendors?: ImagesVendorCount[];
  [field: string]: unknown;
}

export interface ImagesVendorCount {
  vendor: string;
  entries: number;
  buildable: number;
}

export interface ImagesSearchQuery {
  /** Keywords, separated by blanks. */
  q?: string;
  kind?: string;
  vendor?: string;
  source?: ImagesSource;
  status?: ImagesRecordStatus;
  /** Include entries without a buildable kind (`--all`). */
  all?: boolean;
}

export interface ImagesTemplate {
  name: string;
  kind: string;
  image?: string;
  icon?: string;
  /** Created by `climg`; only these can be removed from the Images view. */
  managed: boolean;
  /** Managed and edited by the user; `climg` keeps the edited fields when it regenerates the template. Absent for an older `climg`. */
  customized?: boolean;
  /** Whether the image is on the host; null when `climg` does not track it. */
  imagePresent: boolean | null;
}

export interface ImagesTemplatesResponse {
  templates: ImagesTemplate[];
}

/** Result of `climg nodetpl add|remove|sync --json`. */
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
  /** `pull`: the record; `build`: a record such as `local:<key>` (or `file`). */
  ref?: string;
  /** `build` and `add`: the name of a file in the images folder. */
  file?: string;
  kind?: string;
  version?: string;
  tag?: string;
  /** `pull` only. */
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
  /** Percent of the current phase; null when unknown. */
  pct: number | null;
  message: string;
  /** Last log lines, credentials removed. */
  log: string[];
  /** The result `climg --json` printed. */
  result?: unknown;
  error?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  /** The Node Template step that follows a successful job. */
  nodetpl?: { name?: string; written: boolean; error?: string; kept?: string[] };
  cancelRequested?: boolean;
  /** Place in the server queue (1 = next) while the job waits for a slot; absent otherwise. */
  queuePosition?: number;
}

export interface ImagesJobsResponse {
  jobs: ImagesJob[];
  /** Jobs that have not ended. */
  active: number;
}

export interface ImagesUploadResponse {
  name: string;
  path: string;
  size: number;
  /** Free bytes of the images folder after the upload. */
  freeBytes: number;
}
