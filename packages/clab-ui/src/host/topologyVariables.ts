/**
 * Topology templates and the variables containerlab expands, as pure helpers
 * that hosts and the editor share.
 *
 * containerlab renders every topology file as a Go template, then substitutes
 * environment variables (`${VAR:=default}`) in the result. Lab names may use
 * `__gitBranch__` / `__gitHash__`, and some node fields use magic variables
 * such as `__clabNodeDir__`.
 */

const TOPOLOGY_FILE_PATTERN = /\.clab\.(?:ya?ml|gotmpl)$/i;
const TEMPLATE_FILE_PATTERN = /\.clab\.gotmpl$/i;
const GIT_BRANCH_TOKEN = "__gitBranch__";
const GIT_HASH_TOKEN = "__gitHash__";

/** A containerlab topology file: `*.clab.yml`, `*.clab.yaml` or a `*.clab.gotmpl` template. */
export function isTopologyFileName(fileName: string): boolean {
  return TOPOLOGY_FILE_PATTERN.test(fileName);
}

/** A `*.clab.gotmpl` topology template, which only containerlab can turn into topology YAML. */
export function isTopologyTemplateFileName(fileName: string): boolean {
  return TEMPLATE_FILE_PATTERN.test(fileName);
}

/** The file name without `.clab.yml`, `.clab.yaml` or `.clab.gotmpl`. */
export function topologyFileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(TOPOLOGY_FILE_PATTERN, "");
}

/**
 * The literal top-level `name:` of a topology or template, without parsing
 * it as YAML. Templated names (`{{ ... }}`) have no literal value.
 */
export function literalTopologyName(content: string): string | undefined {
  const match = /^name:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#'"][^#\n]*?))[ \t]*(?:#.*)?$/m.exec(content);
  const value = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
  return value !== undefined && value !== "" && !value.includes("{{") ? value : undefined;
}

export interface GitInfo {
  /** The checked out branch, `HEAD` when detached, `none` outside a repository. */
  branch: string;
  /** The seven-character commit hash, `none` when there is none. */
  hash: string;
}

export function hasLabNameGitTokens(labName: string): boolean {
  return labName.includes(GIT_BRANCH_TOKEN) || labName.includes(GIT_HASH_TOKEN);
}

/**
 * Expands `__gitBranch__` and `__gitHash__` in a lab name the way containerlab
 * does: `/` in branch names becomes `-`.
 */
export function expandLabNameGitTokens(labName: string, git: GitInfo): string {
  if (!hasLabNameGitTokens(labName)) return labName;
  const branch = git.branch.replace(/\//g, "-");
  return labName.split(GIT_BRANCH_TOKEN).join(branch).split(GIT_HASH_TOKEN).join(git.hash);
}

/** What the lab host knows about the variables containerlab expands in one topology. */
export interface TopologyVariables {
  /** The name containerlab runs the lab under, with Git tokens expanded. */
  labName?: string;
  /** Absolute directory of the topology file on the lab host. */
  topologyDir?: string;
  /**
   * Environment variables containerlab deploys with, limited to the names the
   * topology refers to. Missing when the host cannot see that environment:
   * then only defaults such as `${VAR:=default}` resolve.
   */
  env?: Record<string, string>;
}

/** The environment variable containerlab uses instead of the topology directory for lab directories. */
const LAB_DIR_BASE_VARIABLE = "CLAB_LABDIR_BASE";

const NAME_CHAR = /[\p{L}\p{N}_]/u;
const DIGIT = /\p{N}/u;

function readName(text: string, start: number): number {
  let end = start;
  while (end < text.length && NAME_CHAR.test(text[end])) end += 1;
  return end;
}

/**
 * The environment variables a text refers to, as containerlab's envsubst
 * finds them (`$VAR`, `${VAR}`, `${VAR:=default}`, ...). The topology host
 * reads only these from its environment.
 */
export function listEnvReferences(text: string): string[] {
  const names = new Set<string>([LAB_DIR_BASE_VARIABLE]);
  for (const match of text.matchAll(/\$\{?([\p{L}\p{N}_]+)/gu)) {
    const name = match[1];
    if (!DIGIT.test(name[0]) && name !== "_") names.add(name);
  }
  return [...names].sort();
}

export type EnvReferenceSource = "environment" | "default" | "unset" | "host";

export interface EnvReference {
  name: string;
  /**
   * `environment`: the host's value; `default`: the default in the text;
   * `unset`: the host has no value and containerlab keeps the text;
   * `host`: the value depends on an environment this host cannot see.
   */
  source: EnvReferenceSource;
}

export interface EnvResolution {
  /** The text after substitution; unknown parts stay as written. */
  text: string;
  references: EnvReference[];
}

type Operator = "" | ":=" | ":-" | ":+" | "=" | "-" | "+";
const OPERATORS: readonly Operator[] = [":=", ":-", ":+", "=", "-", "+", ""];

interface Substitution {
  name: string;
  operator: Operator;
  fallback: string;
  end: number;
}

function parseSubstitution(text: string, open: number): Substitution | undefined {
  // `open` points at `{`.
  const nameStart = open + 1;
  const nameEnd = readName(text, nameStart);
  if (nameEnd === nameStart) return undefined;
  const close = text.indexOf("}", nameEnd);
  const lineEnd = text.indexOf("\n", nameEnd);
  if (close < 0 || (lineEnd >= 0 && lineEnd < close)) return undefined;
  const rest = text.slice(nameEnd, close);
  // Longest operators first, so `:=` is not read as `:` text.
  const operator = OPERATORS.find((candidate) =>
    candidate === "" ? rest === "" : rest.startsWith(candidate)
  );
  if (operator === undefined) return undefined;
  return {
    name: text.slice(nameStart, nameEnd),
    operator,
    fallback: rest.slice(operator.length),
    end: close + 1
  };
}

/** Values and notes of the environment variables in one text. */
class EnvLookup {
  readonly references: EnvReference[] = [];
  private readonly env: Record<string, string> | undefined;

  constructor(env: Record<string, string> | undefined) {
    this.env = env;
  }

  note(name: string, source: EnvReferenceSource): void {
    if (!this.references.some((entry) => entry.name === name && entry.source === source)) {
      this.references.push({ name, source });
    }
  }

  /** The variable's value; envsubst treats an empty one as missing. */
  value(name: string): string | undefined {
    const value = this.env?.[name];
    return value !== undefined && value.length > 0 ? value : undefined;
  }

  get known(): boolean {
    return this.env !== undefined;
  }

  isSet(name: string): boolean {
    return this.env !== undefined && Object.hasOwn(this.env, name);
  }

  /** `$NAME`: the value, or the variable as written when there is none. */
  plain(name: string): string {
    const value = this.value(name);
    if (value !== undefined) {
      this.note(name, "environment");
      return value;
    }
    this.note(name, this.known ? "unset" : "host");
    return `$${name}`;
  }

  /** A default is text or another variable. */
  fallback(text: string): string {
    return /^\$[A-Za-z_][\p{L}\p{N}_]*$/u.test(text) ? this.plain(text.slice(1)) : text;
  }

  substitute(substitution: Substitution, written: string): string {
    const { name, operator, fallback } = substitution;
    switch (operator) {
      case ":=":
      case ":-": {
        const value = this.value(name);
        if (value !== undefined) {
          this.note(name, "environment");
          return value;
        }
        this.note(name, this.known ? "default" : "host");
        return this.fallback(fallback);
      }
      case ":+":
      case "+":
        if (!this.known) {
          this.note(name, "host");
          return written;
        }
        this.note(name, this.isSet(name) ? "environment" : "unset");
        return this.isSet(name) ? this.fallback(fallback) : "";
      case "=":
      case "-":
        if (this.isSet(name)) return this.plain(name);
        this.note(name, this.known ? "default" : "host");
        return this.fallback(fallback);
      default:
        return this.plain(name);
    }
  }
}

/**
 * Substitutes environment variables like containerlab does before parsing a
 * topology: a variable with no value stays in the text, and
 * `${VAR:=default}` / `${VAR:-default}` fall back to their default. Without
 * `env` the host's environment is unknown, so only defaults resolve.
 */
export function resolveEnvReferences(
  text: string,
  env: Record<string, string> | undefined
): EnvResolution {
  const lookup = new EnvLookup(env);
  let out = "";
  let index = 0;
  while (index < text.length) {
    const dollar = text.indexOf("$", index);
    if (dollar < 0) {
      out += text.slice(index);
      break;
    }
    out += text.slice(index, dollar);
    const next = text[dollar + 1] ?? "";
    const substitution =
      next === "{" && !DIGIT.test(text[dollar + 2] ?? "") ? parseSubstitution(text, dollar + 1) : undefined;
    if (next === "$") {
      // `$$` is an escaped `$`.
      out += "$";
      index = dollar + 2;
    } else if (substitution) {
      out += lookup.substitute(substitution, text.slice(dollar, substitution.end));
      index = substitution.end;
    } else if (next === "{") {
      out += "${";
      index = dollar + 2;
    } else if (NAME_CHAR.test(next) && !DIGIT.test(next)) {
      const end = readName(text, dollar + 1);
      const name = text.slice(dollar + 1, end);
      out += name === "_" ? "$_" : lookup.plain(name);
      index = end;
    } else {
      out += "$";
      index = dollar + 1;
    }
  }
  return { text: out, references: lookup.references };
}

/** True when a text uses environment variables containerlab substitutes. */
export function hasEnvReferences(text: string): boolean {
  return text.includes("$") && resolveEnvReferences(text, undefined).references.length > 0;
}

export interface MagicVariable {
  token: string;
  description: string;
  /** Needs a node, i.e. only resolves in node fields. */
  perNode: boolean;
}

/** containerlab's magic variables, in the order editors suggest them. */
export const MAGIC_VARIABLES: readonly MagicVariable[] = [
  { token: "__clabNodeName__", description: "Short name of the node", perNode: true },
  { token: "__clabNodeDir__", description: "Directory of the node in the lab directory", perNode: true },
  { token: "__clabDir__", description: "Lab directory, clab-<lab name>", perNode: false },
  { token: "__clabLabName__", description: "Name of the lab directory, clab-<lab name>", perNode: false }
];

export interface MagicVariableContext {
  labName: string;
  nodeName?: string;
  /** Absolute topology directory; relative paths are shown without it. */
  topologyDir?: string;
  env?: Record<string, string>;
}

function joinPath(base: string | undefined, name: string): string {
  if (base === undefined || base === "") return `./${name}`;
  return `${base.replace(/[\\/]+$/, "")}/${name}`;
}

/** The value each magic variable has for a node of a lab. */
export function magicVariableValues(context: MagicVariableContext): Record<string, string | undefined> {
  const labDirName = `clab-${context.labName}`;
  const labDirOverride = context.env?.[LAB_DIR_BASE_VARIABLE];
  const labDirBase =
    labDirOverride !== undefined && labDirOverride !== "" ? labDirOverride : context.topologyDir;
  const labDir = joinPath(labDirBase, labDirName);
  const trimmedNode = context.nodeName?.trim();
  const nodeName = trimmedNode !== undefined && trimmedNode !== "" ? trimmedNode : undefined;
  return {
    __clabNodeName__: nodeName,
    __clabNodeDir__: nodeName !== undefined ? `${labDir}/${nodeName}` : undefined,
    __clabDir__: labDir,
    __clabLabName__: labDirName
  };
}

export function hasMagicVariables(text: string): boolean {
  return MAGIC_VARIABLES.some((variable) => text.includes(variable.token));
}

/** Replaces the magic variables that have a value; the others stay as written. */
export function resolveMagicVariables(text: string, context: MagicVariableContext): string {
  const values = magicVariableValues(context);
  let out = text;
  for (const variable of MAGIC_VARIABLES) {
    const value = values[variable.token];
    if (value !== undefined) out = out.split(variable.token).join(value);
  }
  return out;
}
