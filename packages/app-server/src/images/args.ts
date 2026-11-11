import type { ImagesSearchQuery } from "@srl-labs/containerlab-lab-backend";

import {
  SEARCH_SOURCES,
  SEARCH_STATUSES,
  validateEnum,
  validateKeywords,
  validateKind,
  validateRef,
  validateTag,
  validateTemplateName,
  validateVendor,
  validateVersion
} from "./validate.ts";

/**
 * Every `climg` command line the server builds: options first, then `--`, then
 * every positional. For `nodetpl` the action is a positional too:
 * `nodetpl --json --writer file --nodetpl-file P -- add <ref>` (the form
 * `nodetpl <action> --json -- <ref>` does not parse on Python <= 3.12.3).
 */
export function commandLine(command: string, options: string[], positionals: string[] = []): string[] {
  // climg 0.1.0 rejects a trailing `--` when there is nothing after it.
  return positionals.length > 0 ? [command, ...options, "--", ...positionals] : [command, ...options];
}

export const versionArgs = (): string[] => ["--version"];
export const configArgs = (): string[] => ["config", "--json"];
export const doctorArgs = (): string[] => commandLine("doctor", ["--json"]);
export const imagesArgs = (): string[] => commandLine("images", ["--json"]);
export const scanArgs = (): string[] => commandLine("scan", ["--json"]);
export const indexArgs = (refresh: boolean): string[] =>
  commandLine("index", refresh ? ["--refresh", "--json"] : ["--json"]);

export function searchArgs(query: ImagesSearchQuery): string[] {
  const options = ["--json"];
  if (query.kind !== undefined) options.push("--kind", validateKind(query.kind));
  if (query.vendor !== undefined) options.push("--vendor", validateVendor(query.vendor));
  if (query.source !== undefined) options.push("--source", validateEnum("source", query.source, SEARCH_SOURCES));
  if (query.status !== undefined) options.push("--status", validateEnum("status", query.status, SEARCH_STATUSES));
  if (query.all === true) options.push("--all");
  return commandLine("search", options, validateKeywords(query.q));
}

export const showArgs = (ref: unknown): string[] => commandLine("show", ["--json"], [validateRef(ref)]);

/** `nodetpl` always names the template file the server's store serves, and the file writer. */
export function nodetplArgs(
  nodetplFile: string,
  action: "list" | "add" | "remove" | "sync",
  target?: string,
  dryRun = false
): string[] {
  const options = ["--json", "--writer", "file", "--nodetpl-file", nodetplFile];
  if (dryRun) options.push("--dry-run");
  const positionals: string[] = [action];
  if (action === "add") positionals.push(validateRef(target));
  if (action === "remove") positionals.push(validateTemplateName(target));
  return commandLine("nodetpl", options, positionals);
}

export interface JobArgsInput {
  op: "pull" | "build" | "add";
  ref?: unknown;
  /** Absolute path of an image file already checked to be inside the images folder. */
  filePath?: string;
  kind?: unknown;
  version?: unknown;
  tag?: unknown;
  force?: unknown;
  jobFile: string;
}

/** `pull|build|add` as a job: confirmed, JSON, progress file, and no template write (the server does it under its lock). */
export function jobArgs(input: JobArgsInput): string[] {
  const options = ["--yes", "--json", "--job-file", input.jobFile, "--no-nodetpl"];
  if (input.op === "pull") {
    if (input.force === true) options.push("--force");
    if (input.tag !== undefined) options.push("--tag", validateTag(input.tag));
    return commandLine("pull", options, [validateRef(input.ref)]);
  }
  if (input.kind !== undefined) options.push("--kind", validateKind(input.kind));
  if (input.version !== undefined) options.push("--version", validateVersion(input.version));
  if (input.tag !== undefined) options.push("--tag", validateTag(input.tag));
  const target = input.filePath ?? validateRef(input.ref);
  return commandLine(input.op, options, [target]);
}
