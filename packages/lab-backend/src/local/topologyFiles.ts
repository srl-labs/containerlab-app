import { watch as watchFiles } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import type { TopologyFileSystem, TopologyFilesOptions } from "../contract/backend.ts";
import type { TopologyEntry } from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import { createAsyncQueue } from "../asyncQueue.ts";
import type { WorkspacePaths } from "./workspace.ts";

const LAB_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOPOLOGY_FILE_PATTERN = /\.clab\.ya?ml$/i;
const ANNOTATIONS_SUFFIX = ".annotations.json";
const SKIPPED_DIRECTORIES = new Set(["node_modules", "__pycache__"]);
const RUNTIME_DIRECTORY_MARKERS = [".state.clab.yaml", "topology-data.json"];
const TOPOLOGY_EVENT_DEDUPE_MS = 250;
const DIRECTORY_MODE = 0o750;
const FILE_MODE = 0o640;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export function isValidLabName(name: string): boolean {
  return name.length > 0 && name.length <= 128 && LAB_NAME_PATTERN.test(name);
}

function sanitizeLabName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
}

function topologyStem(fileName: string): string {
  const index = fileName.toLowerCase().indexOf(".clab.");
  return index >= 0 ? fileName.slice(0, index) : fileName;
}

async function isRuntimeDirectory(directory: string): Promise<boolean> {
  for (const marker of RUNTIME_DIRECTORY_MARKERS) {
    try {
      if ((await fs.lstat(path.join(directory, marker))).isFile()) return true;
    } catch {
      // Not there.
    }
  }
  return false;
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.lstat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function readTopologyName(filePath: string): Promise<string | undefined> {
  try {
    const parsed = YAML.parse(await fs.readFile(filePath, "utf8")) as unknown;
    const name = (parsed as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Finds topology files in the workspace, named the way clab-api-server names them. */
export async function discoverTopologies(paths: WorkspacePaths): Promise<TopologyEntry[]> {
  const found: string[] = [];
  const walk = async (relativeDir: string): Promise<void> => {
    const directory = paths.absolute(relativeDir);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (await isRuntimeDirectory(path.join(directory, entry.name))) continue;
        await walk(entryPath);
      } else if (entry.isFile() && TOPOLOGY_FILE_PATTERN.test(entry.name)) {
        found.push(entryPath);
      }
    }
  };
  await walk("");

  const topologiesPerTopDirectory = new Map<string, number>();
  for (const filePath of found) {
    const segments = filePath.split("/");
    if (segments.length === 2) {
      topologiesPerTopDirectory.set(segments[0], (topologiesPerTopDirectory.get(segments[0]) ?? 0) + 1);
    }
  }

  const entries: TopologyEntry[] = [];
  for (const yamlFileName of found) {
    const segments = yamlFileName.split("/");
    const stem = topologyStem(segments[segments.length - 1]);
    let labName: string | undefined;
    if (segments.length === 1) {
      labName = stem;
    } else if (
      segments.length === 2 &&
      isValidLabName(segments[0]) &&
      (topologiesPerTopDirectory.get(segments[0]) === 1 || stem === segments[0])
    ) {
      labName = segments[0];
    }
    if (!labName || !isValidLabName(labName)) {
      const declared = await readTopologyName(paths.absolute(yamlFileName));
      labName = declared && isValidLabName(declared) ? declared : sanitizeLabName(stem);
    }
    if (!isValidLabName(labName)) continue;
    const annotationsFileName = `${yamlFileName}${ANNOTATIONS_SUFFIX}`;
    entries.push({
      labName,
      absolutePath: paths.absolute(yamlFileName),
      yamlFileName,
      annotationsFileName,
      hasAnnotations: await isRegularFile(paths.absolute(annotationsFileName)),
      deploymentState: "undeployed"
    });
  }
  return entries.sort(
    (left, right) =>
      left.labName.localeCompare(right.labName) || left.yamlFileName.localeCompare(right.yamlFileName)
  );
}

/**
 * Resolves a topology file path of a lab: a workspace path such as
 * `lab1/lab1.clab.yml`, or a legacy path relative to the lab folder.
 */
export async function resolveTopologyPath(
  paths: WorkspacePaths,
  labName: string,
  rawPath: string
): Promise<string> {
  const cleaned = paths.clean(rawPath);
  const segments = cleaned.split("/");
  if (segments.length >= 2) {
    try {
      const first = await fs.lstat(paths.absolute(segments[0]));
      if (first.isDirectory()) {
        await assertNoSymlinks(paths, segments);
        return paths.absolute(cleaned);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  if (segments.length === 1 && isCanonicalTopologyName(labName, cleaned)) {
    const rootLevel = paths.absolute(cleaned);
    const rootYaml = paths.absolute(cleaned.replace(/\.annotations\.json$/, ""));
    if ((await isRegularFile(rootLevel)) || (cleaned.endsWith(ANNOTATIONS_SUFFIX) && (await isRegularFile(rootYaml)))) {
      return rootLevel;
    }
  }
  if (!isValidLabName(labName)) {
    throw new LabBackendError(`Invalid lab name '${labName}'`, 400);
  }
  const labDirectory = paths.absolute(labName);
  const legacy = path.join(labDirectory, ...segments);
  if (legacy !== labDirectory && !legacy.startsWith(labDirectory + path.sep)) {
    throw new LabBackendError("invalid file path", 400);
  }
  return legacy;
}

function isCanonicalTopologyName(labName: string, fileName: string): boolean {
  return [".clab.yml", ".clab.yaml"].some(
    (suffix) => fileName === `${labName}${suffix}` || fileName === `${labName}${suffix}${ANNOTATIONS_SUFFIX}`
  );
}

async function assertNoSymlinks(paths: WorkspacePaths, segments: string[]): Promise<void> {
  let current = paths.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new LabBackendError("topology paths must not contain symbolic links", 400);
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

/** `yaml=<size>-<mtimeNs>;annotations=<size>-<mtimeNs>`, as clab-api-server reports it. */
async function topologyRevision(yamlFile: string): Promise<string> {
  const describe = async (filePath: string): Promise<string> => {
    try {
      const stat = await fs.stat(filePath, { bigint: true });
      return `${stat.size}-${stat.mtimeNs}`;
    } catch (error) {
      return isMissing(error) ? "missing" : "error";
    }
  };
  const yamlPath = yamlFile.replace(/\.annotations\.json$/, "");
  return `yaml=${await describe(yamlPath)};annotations=${await describe(`${yamlPath}${ANNOTATIONS_SUFFIX}`)}`;
}

function createNotFoundError(filePath: string): Error {
  return Object.assign(new Error(`ENOENT: no such file ${filePath}`), { code: "ENOENT" });
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

/**
 * Topology file access on the local disk. Paths are workspace paths; with
 * `running-lab-doc`, the topology and its annotations are the files the
 * running lab was deployed from, wherever they are.
 */
export function createLocalTopologyFiles(
  paths: WorkspacePaths,
  options: TopologyFilesOptions,
  runningTopologyFile: (labName: string) => Promise<string | undefined>
): TopologyFileSystem {
  const yamlPath = options.yamlPath ? normalizePath(options.yamlPath) : undefined;
  let annotationsPath = options.annotationsPath ? normalizePath(options.annotationsPath) : undefined;
  if (!annotationsPath && yamlPath) annotationsPath = `${yamlPath}${ANNOTATIONS_SUFFIX}`;
  let runningDocument: Promise<string | undefined> | undefined;

  const runningDoc = async (): Promise<string | undefined> => {
    if (options.sourcePreference !== "running-lab-doc") return undefined;
    runningDocument ??= (async () => {
      const running = await runningTopologyFile(options.labName);
      if (running) return running;
      return resolveTopologyPath(paths, options.labName, `${options.labName}.clab.yml`);
    })();
    return runningDocument;
  };

  const resolve = async (rawPath: string): Promise<string> => {
    const filePath = normalizePath(rawPath);
    const document = await runningDoc();
    if (document && yamlPath) {
      const yamlDirectory = path.posix.dirname(yamlPath);
      const base = path.posix.basename(filePath);
      if (filePath === yamlPath || filePath === path.posix.basename(yamlPath)) return document;
      if (annotationsPath && (filePath === annotationsPath || filePath === path.posix.basename(annotationsPath))) {
        return `${document}${ANNOTATIONS_SUFFIX}`;
      }
      if (path.posix.dirname(filePath) === yamlDirectory || !filePath.includes("/")) {
        // Temporary and backup files of the topology core live next to the document.
        return path.join(path.dirname(document), base);
      }
    }
    return resolveTopologyPath(paths, options.labName, filePath);
  };

  return {
    async readFile(filePath) {
      try {
        return await fs.readFile(await resolve(filePath), "utf8");
      } catch (error) {
        if (isMissing(error)) throw createNotFoundError(filePath);
        throw error;
      }
    },
    async writeFile(filePath, content) {
      const target = await resolve(filePath);
      if (!options.sourcePreference || options.sourcePreference === "api-file") {
        await fs.mkdir(paths.absolute(options.labName), { recursive: true, mode: DIRECTORY_MODE }).catch(() => {});
      }
      await fs.mkdir(path.dirname(target), { recursive: true, mode: DIRECTORY_MODE });
      await fs.writeFile(target, content, { mode: FILE_MODE });
    },
    async unlink(filePath) {
      try {
        await fs.unlink(await resolve(filePath));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
    async rename(oldPath, newPath) {
      const source = await resolve(oldPath);
      const target = await resolve(newPath);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: DIRECTORY_MODE });
      try {
        await fs.rename(source, target);
      } catch (error) {
        if (isMissing(error) && (await isRegularFile(target))) return;
        if (isMissing(error)) throw new LabBackendError("Source file not found", 404);
        throw error;
      }
    },
    async exists(filePath) {
      try {
        await fs.access(await resolve(filePath));
        return true;
      } catch {
        return false;
      }
    },
    dirname(filePath) {
      const normalized = normalizePath(filePath);
      const index = normalized.lastIndexOf("/");
      return index <= 0 ? "." : normalized.slice(0, index);
    },
    basename(filePath) {
      const normalized = normalizePath(filePath);
      return normalized.slice(normalized.lastIndexOf("/") + 1);
    },
    join(...segments) {
      return normalizePath(segments.filter((segment) => segment.length > 0).join("/"));
    },
    async revision(filePath) {
      try {
        return await topologyRevision(await resolve(filePath));
      } catch {
        return undefined;
      }
    }
  };
}

/**
 * Watches one topology document and its annotations. Yields
 * `{"type":"topology-doc",...}` NDJSON lines like clab-api-server.
 */
export async function watchTopologyDocument(
  paths: WorkspacePaths,
  labName: string,
  rawPath: string,
  signal: AbortSignal
): Promise<AsyncIterable<string>> {
  const requestedPath = paths.clean(rawPath);
  const yamlRequestPath = requestedPath.replace(/\.annotations\.json$/, "");
  const yamlFile = await resolveTopologyPath(paths, labName, yamlRequestPath);
  const directory = path.dirname(yamlFile);
  await fs.mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  const yamlBase = path.basename(yamlFile);
  const annotationsBase = `${yamlBase}${ANNOTATIONS_SUFFIX}`;
  const existing = new Map<string, boolean>();
  for (const base of [yamlBase, annotationsBase]) {
    existing.set(base, await isRegularFile(path.join(directory, base)));
  }
  let lastRevision = "";
  let lastAt = 0;
  let watcher: ReturnType<typeof watchFiles> | undefined;
  const queue = createAsyncQueue<string>(signal, () => watcher?.close());
  watcher = watchFiles(directory, { signal }, (_eventType, fileName) => {
    const base = fileName ? String(fileName) : "";
    if (base !== yamlBase && base !== annotationsBase) return;
    void (async () => {
      const exists = await isRegularFile(path.join(directory, base));
      const existed = existing.get(base) ?? false;
      existing.set(base, exists);
      let action = "delete";
      if (exists) action = existed ? "change" : "create";
      const revision = await topologyRevision(yamlFile);
      const now = Date.now();
      if (revision === lastRevision && now - lastAt < TOPOLOGY_EVENT_DEDUPE_MS) return;
      lastRevision = revision;
      lastAt = now;
      const isAnnotations = base === annotationsBase;
      queue.push(
        JSON.stringify({
          type: "topology-doc",
          labName,
          path: isAnnotations ? `${yamlRequestPath}${ANNOTATIONS_SUFFIX}` : yamlRequestPath,
          documentKind: isAnnotations ? "annotations" : "yaml",
          action,
          revision
        })
      );
    })();
  });
  watcher.on("error", (error) => queue.push(JSON.stringify({ type: "error", error: String(error) })));
  return queue.iterable;
}
