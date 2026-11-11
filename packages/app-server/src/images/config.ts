import path from "node:path";

const DEFAULT_UPLOAD_MAX_BYTES = 20 * 1024 ** 3;
const DEFAULT_MAX_JOBS = 4;
const DEFAULT_MAX_RUNNING = 1;
const DEFAULT_MAX_QUEUED = 20;
/** Image file extensions `climg scan` recognises; an upload must end in one. */
export const IMAGE_EXTENSIONS = [".qcow2", ".vmdk", ".tgz", ".tar.gz", ".bin", ".iol"] as const;

/** The user `climg` runs as; unset means the server's own user. */
export interface ImagesRunAs {
  uid: number;
  gid: number;
}

export interface ImagesConfig {
  /** Absolute path of the `climg` executable; the only program the server runs for images. */
  climgPath: string;
  /** Passed as CLIMG_CONFIG. */
  configPath?: string;
  /** Passed as CLIMG_STATE; else the state dir of the `climg` config. */
  statePath?: string;
  runAs?: ImagesRunAs;
  /** Passed as HOME; wins over the home of the run-as user in `/etc/passwd`, which differs between host and container. */
  home?: string;
  uploadMaxBytes: number;
  /** Hard cap on jobs running at once, whatever `maxRunning` says. */
  maxJobs: number;
  /** Pull/build jobs that run at once (`WEB_LOCAL_IMAGES_MAX_RUNNING`); the others wait in the server queue. */
  maxRunning: number;
  /** Jobs that may wait in the queue (`WEB_LOCAL_IMAGES_MAX_QUEUED`); a start beyond it is refused with 429. */
  maxQueued: number;
  /** Extra environment for `climg` (tests); never taken from the server's own environment. */
  extraEnv?: Record<string, string>;
}

export interface ImagesConfigResolution {
  /** Undefined when `climg` is not configured or its settings are unusable. */
  config?: ImagesConfig;
  problems: string[];
}

/** Keys that turn the feature on, shown by the UI when `climg` is not configured. */
export const IMAGES_CONFIG_KEYS = [
  "WEB_LOCAL_CLIMG_PATH",
  "WEB_LOCAL_CLIMG_CONFIG",
  "WEB_LOCAL_CLIMG_STATE",
  "WEB_LOCAL_CLIMG_USER",
  "WEB_LOCAL_CLIMG_HOME",
  "WEB_LOCAL_IMAGES_UPLOAD_MAX",
  "WEB_LOCAL_IMAGES_MAX_RUNNING",
  "WEB_LOCAL_IMAGES_MAX_QUEUED"
];

const SIZE_UNITS: Record<string, number> = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

/** `1073741824`, `512M`, `20G`, `20GiB`: bytes, with 1024-based units. */
export function parseByteSize(value: string): number | undefined {
  const match = /^(\d+)\s*([kmgt]?)(?:i?b)?$/i.exec(value.trim());
  if (!match) return undefined;
  const bytes = Number(match[1]) * SIZE_UNITS[match[2].toLowerCase()];
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
}

/** A whole number of at least `min`; undefined when the text is anything else. */
function parseCount(value: string, min: number): number | undefined {
  if (!/^\d{1,6}$/.test(value.trim())) return undefined;
  const count = Number(value);
  return count >= min ? count : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

/** `WEB_LOCAL_CLIMG_*` and `WEB_LOCAL_IMAGES_*` of one environment. */
export function resolveImagesConfig(
  env: NodeJS.ProcessEnv,
  prefix = "WEB_LOCAL_",
  currentUid: number | undefined = process.getuid?.()
): ImagesConfigResolution {
  const problems: string[] = [];
  const climgPath = nonEmpty(env[`${prefix}CLIMG_PATH`]);
  if (climgPath === undefined) return { problems };
  if (!path.isAbsolute(climgPath)) {
    return { problems: [`${prefix}CLIMG_PATH must be an absolute path, got "${climgPath}".`] };
  }

  const configPath = nonEmpty(env[`${prefix}CLIMG_CONFIG`]);
  const statePath = nonEmpty(env[`${prefix}CLIMG_STATE`]);
  for (const [key, value] of [["CLIMG_CONFIG", configPath], ["CLIMG_STATE", statePath]] as const) {
    if (value !== undefined && !path.isAbsolute(value)) {
      return { problems: [`${prefix}${key} must be an absolute path, got "${value}".`] };
    }
  }

  const home = nonEmpty(env[`${prefix}CLIMG_HOME`]);
  if (home !== undefined && !path.isAbsolute(home)) {
    return { problems: [`${prefix}CLIMG_HOME must be an absolute path, got "${home}".`] };
  }

  let runAs: ImagesRunAs | undefined;
  const user = nonEmpty(env[`${prefix}CLIMG_USER`]);
  if (user !== undefined) {
    const match = /^(\d+):(\d+)$/.exec(user);
    if (!match) return { problems: [`${prefix}CLIMG_USER must be "uid:gid" with numbers, got "${user}".`] };
    runAs = { uid: Number(match[1]), gid: Number(match[2]) };
    if (runAs.uid === 0) {
      return { problems: [`${prefix}CLIMG_USER must not be root (uid 0): climg runs as the owner of its state.`] };
    }
  } else if (currentUid === 0) {
    return { problems: [`${prefix}CLIMG_USER ("uid:gid") is required when the server runs as root.`] };
  }

  let uploadMaxBytes = DEFAULT_UPLOAD_MAX_BYTES;
  const max = nonEmpty(env[`${prefix}IMAGES_UPLOAD_MAX`]);
  if (max !== undefined) {
    const parsed = parseByteSize(max);
    if (parsed === undefined) problems.push(`${prefix}IMAGES_UPLOAD_MAX "${max}" is not a size such as 20G; using 20 GiB.`);
    else uploadMaxBytes = parsed;
  }

  const counts = { maxRunning: DEFAULT_MAX_RUNNING, maxQueued: DEFAULT_MAX_QUEUED };
  for (const [key, field, min, fallback] of [
    ["IMAGES_MAX_RUNNING", "maxRunning", 1, DEFAULT_MAX_RUNNING],
    ["IMAGES_MAX_QUEUED", "maxQueued", 0, DEFAULT_MAX_QUEUED]
  ] as const) {
    const text = nonEmpty(env[`${prefix}${key}`]);
    if (text === undefined) continue;
    const parsed = parseCount(text, min);
    if (parsed === undefined) problems.push(`${prefix}${key} "${text}" is not a whole number of at least ${min}; using ${fallback}.`);
    else counts[field] = parsed;
  }

  return {
    config: {
      climgPath,
      ...(configPath !== undefined ? { configPath } : {}),
      ...(statePath !== undefined ? { statePath } : {}),
      ...(runAs ? { runAs } : {}),
      ...(home !== undefined ? { home } : {}),
      uploadMaxBytes,
      maxJobs: DEFAULT_MAX_JOBS,
      ...counts
    },
    problems
  };
}
