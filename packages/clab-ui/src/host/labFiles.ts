/**
 * Files a topology refers to on the lab host, such as bind sources, startup
 * configs and licenses, as pure helpers that hosts and the editor share.
 */
import {
  hasEnvReferences,
  hasMagicVariables,
  resolveEnvReferences,
  resolveMagicVariables,
  type TopologyVariables
} from "./topologyVariables";

/** A lab file to open in the host's editor. */
export interface LabFileRequest {
  /** Relative to the directory of the topology file, or absolute on the lab host. */
  path: string;
  /** Create the file empty first when it does not exist. */
  create?: boolean;
}

/** What a topology value refers to: a bind (`src:dst[:opts]`) or a file path. */
export type LabFileReferenceKind = "bind" | "file";

export interface LabFileScope {
  /** The name containerlab runs the lab under. */
  labName: string;
  /** The node the value belongs to, for `__clabNodeName__` and `__clabNodeDir__`. */
  nodeName?: string;
  variables?: TopologyVariables;
}

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/** The host side of a bind, `src` in `src:dst[:opts]`; undefined for anything else. */
export function bindSourcePath(bind: string): string | undefined {
  // Colons inside `${VAR:=default}` belong to the variable.
  let index = -1;
  let braces = 0;
  for (let position = 0; position < bind.length && index < 0; position += 1) {
    const char = bind[position];
    if (char === "{" && bind[position - 1] === "$") braces += 1;
    else if (char === "}" && braces > 0) braces -= 1;
    else if (char === ":" && braces === 0) index = position;
  }
  if (index <= 0) return undefined;
  const source = bind.slice(0, index).trim();
  return source.length > 0 ? source : undefined;
}

function splitSegments(pathValue: string): string[] {
  return pathValue.split("/").filter((segment) => segment !== "" && segment !== ".");
}

/** Applies `..`; undefined when the path climbs above its root. */
function normalizeSegments(segments: readonly string[]): string[] | undefined {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment !== "..") {
      out.push(segment);
    } else if (out.pop() === undefined) {
      return undefined;
    }
  }
  return out;
}

function startsWithSegments(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}

/** A bind source names a file, not a directory: its last segment has a dot, like `r1.cfg` or `.bashrc`. */
function looksLikeFile(pathValue: string): boolean {
  const last = splitSegments(pathValue).at(-1) ?? "";
  return last !== ".." && last.includes(".");
}

/** An absolute path inside the topology directory, as a path relative to it. */
function relativeToTopologyDir(pathValue: string, topologyDir: string | undefined): string | undefined {
  if (topologyDir === undefined || !topologyDir.startsWith("/")) return undefined;
  const dir = normalizeSegments(splitSegments(topologyDir));
  const target = normalizeSegments(splitSegments(pathValue));
  if (!dir || !target || target.length <= dir.length || !startsWithSegments(target, dir)) {
    return undefined;
  }
  return target.slice(dir.length).join("/");
}

/** The path a value names: no inline configs (several lines) or URLs. */
function referencedPath(value: string, kind: LabFileReferenceKind): string | undefined {
  const raw = (kind === "bind" ? bindSourcePath(value) : value.trim()) ?? "";
  return raw === "" || raw.includes("\n") || URL_PATTERN.test(raw) ? undefined : raw;
}

/** The text with containerlab's variables expanded; undefined while one has no value. */
function expandVariables(text: string, scope: LabFileScope): string | undefined {
  const env = scope.variables?.env;
  let expanded = text;
  if (hasEnvReferences(expanded)) {
    expanded = resolveEnvReferences(expanded, env).text;
    // Variables without a value stay in the text.
    if (expanded.includes("$")) return undefined;
  }
  if (!hasMagicVariables(expanded)) return expanded;
  expanded = resolveMagicVariables(expanded, {
    labName: scope.variables?.labName ?? scope.labName,
    nodeName: scope.nodeName,
    topologyDir: scope.variables?.topologyDir,
    env
  });
  // Node variables in defaults, kinds and groups have no node to resolve to.
  return hasMagicVariables(expanded) ? undefined : expanded;
}

/**
 * The lab file a topology value opens, with containerlab's variables
 * expanded: the host side of a bind, or a startup config or license path.
 * Undefined when there is none to open: inline configs, URLs, `~` paths,
 * variables without a value, and binds of directories.
 */
export function resolveLabFileReference(
  value: string,
  kind: LabFileReferenceKind,
  scope: LabFileScope
): LabFileRequest | undefined {
  const raw = referencedPath(value, kind);
  const text = raw !== undefined ? expandVariables(raw, scope) : undefined;
  if (text === undefined || text.startsWith("~") || splitSegments(text).length === 0) {
    return undefined;
  }
  if (kind === "bind" && !looksLikeFile(text)) return undefined;

  if (!text.startsWith("/")) return { path: text, create: true };
  const relative = relativeToTopologyDir(text, scope.variables?.topologyDir);
  // Absolute paths elsewhere on the lab host open, but are never created.
  return relative !== undefined ? { path: relative, create: true } : { path: text, create: false };
}

/**
 * The workspace path of a lab file, for hosts that address files relative
 * to a workspace root. `topologyPath` is the workspace path of the topology
 * file and `topologyDir` its absolute directory on the lab host, which
 * absolute paths need. Undefined when the file is outside the workspace.
 */
export function resolveWorkspaceLabFile(
  request: Pick<LabFileRequest, "path">,
  topologyPath: string,
  topologyDir?: string
): string | undefined {
  // A topology outside the workspace has no workspace path.
  if (topologyPath.startsWith("/") || URL_PATTERN.test(topologyPath)) return undefined;
  const topologySegments = splitSegments(topologyPath).slice(0, -1);
  // Shared workspaces (`@shared/...`) keep their prefix, which no lab host path has.
  const prefix = topologySegments[0]?.startsWith("@") === true ? topologySegments.slice(0, 1) : [];
  const directory = topologySegments.slice(prefix.length);

  let segments: string[] | undefined;
  if (!request.path.startsWith("/")) {
    segments = normalizeSegments([...directory, ...splitSegments(request.path)]);
  } else {
    const absoluteDir = topologyDir?.startsWith("/") === true ? normalizeSegments(splitSegments(topologyDir)) : undefined;
    const target = normalizeSegments(splitSegments(request.path));
    if (!absoluteDir || !target || absoluteDir.length < directory.length) return undefined;
    const root = absoluteDir.slice(0, absoluteDir.length - directory.length);
    if (!startsWithSegments(absoluteDir.slice(root.length), directory) || !startsWithSegments(target, root)) {
      return undefined;
    }
    segments = target.slice(root.length);
  }
  if (!segments || segments.length === 0) return undefined;
  return [...prefix, ...segments].join("/");
}
