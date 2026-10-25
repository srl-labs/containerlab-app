import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  expandLabNameGitTokens,
  hasLabNameGitTokens,
  literalTopologyName,
  type GitInfo,
  type TopologyVariables
} from "@containerlab/clab-ui/host";

import type { RenderedTopology } from "../contract/backend.ts";
import { LabBackendError } from "../contract/errors.ts";
import type { ResolvedLocalOptions } from "./options.ts";
import { containerlabCommand, lastContainerlabError, runCommand, stripAnsi } from "./process.ts";

const RENDER_TIMEOUT_MS = 60_000;
const VARS_FILE_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);
const NO_GIT: GitInfo = { branch: "none", hash: "none" };

/**
 * Git branch and short hash of the repository at `directory`, the way
 * containerlab finds them: only a repository rooted there counts.
 */
export async function topologyGitInfo(directory: string, env?: NodeJS.ProcessEnv): Promise<GitInfo> {
  try {
    await fs.lstat(path.join(directory, ".git"));
  } catch {
    return NO_GIT;
  }
  const git = async (args: string[]): Promise<string | undefined> => {
    try {
      const result = await runCommand("git", ["-C", directory, ...args], { env, timeoutMs: 5000 });
      const output = result.stdout.trim();
      return result.code === 0 && output ? output : undefined;
    } catch {
      return undefined;
    }
  };
  const [branch, hash] = await Promise.all([
    git(["symbolic-ref", "--short", "-q", "HEAD"]),
    git(["rev-parse", "--verify", "-q", "HEAD"])
  ]);
  if (!branch && !hash) return NO_GIT;
  // A detached HEAD has no branch; go-git names it HEAD.
  return { branch: branch ?? "HEAD", hash: hash ? hash.slice(0, 7) : "none" };
}

/** The lab name containerlab gives a topology whose `name` uses Git tokens. */
export async function expandTopologyLabName(
  labName: string,
  topologyFile: string,
  env?: NodeJS.ProcessEnv
): Promise<string> {
  if (!hasLabNameGitTokens(labName)) return labName;
  return expandLabNameGitTokens(labName, await topologyGitInfo(path.dirname(topologyFile), env));
}

/**
 * The vars files containerlab reads for a topology without `--vars`:
 * `<file name without its last extension>_vars.*` next to it, sorted.
 */
async function discoverVarsFiles(topologyFile: string): Promise<string[]> {
  const directory = path.dirname(topologyFile);
  const base = path.basename(topologyFile);
  const prefix = `${base.slice(0, base.length - path.extname(base).length)}_vars.`;
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.startsWith(prefix) && VARS_FILE_EXTENSIONS.has(path.extname(entry)))
    .sort();
}

function renderUnsupported(output: string): boolean {
  return /unknown flag: --(?:dry-run|export-rendered)/.test(output);
}

/**
 * Renders a topology with containerlab without deploying it: a dry-run
 * deploy only plans, and `--export-rendered` saves the template and
 * environment expansion. containerlab before 0.78 has no dry-run and
 * rejects the flags, so it never deploys either.
 */
export async function renderTopologyFile(
  options: ResolvedLocalOptions,
  topologyFile: string,
  varsFile?: string
): Promise<RenderedTopology> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clab-render-"));
  const output = path.join(directory, "rendered.clab.yml");
  try {
    const args = ["deploy", "--dry-run", "-r", options.runtime, "--export-rendered", output, "-t", topologyFile];
    if (varsFile) args.push("--vars", varsFile);
    const [file, commandArgs] = containerlabCommand(options, args);
    const result = await runCommand(file, commandArgs, {
      cwd: path.dirname(topologyFile),
      env: options.env,
      timeoutMs: RENDER_TIMEOUT_MS
    });
    const log = stripAnsi(`${result.stderr}\n${result.stdout}`).trim();
    let content: string | undefined;
    try {
      content = await fs.readFile(output, "utf8");
    } catch {
      content = undefined;
    }
    if (content === undefined) {
      if (renderUnsupported(log)) {
        throw new LabBackendError("Rendering a topology needs containerlab 0.78 or newer.", 501);
      }
      throw new LabBackendError(lastContainerlabError(log) ?? (log.split("\n").pop() || "Rendering failed"), 422);
    }
    const declared = literalTopologyName(content);
    const labName = declared
      ? await expandTopologyLabName(declared, topologyFile, options.env)
      : undefined;
    const error = result.code === 0 ? undefined : (lastContainerlabError(log) ?? `containerlab exited with ${result.code}`);
    return {
      content,
      ...(labName ? { labName } : {}),
      varsFiles: varsFile ? [varsFile] : await discoverVarsFiles(topologyFile),
      ...(error ? { error } : {})
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * What the editor needs to preview variables of a topology on this machine.
 * Behind `sudo` containerlab runs with another environment, so only
 * defaults are known then.
 */
export async function localTopologyVariables(
  options: ResolvedLocalOptions,
  topologyFile: string,
  request: { labName: string; envNames: string[] }
): Promise<TopologyVariables> {
  const env: Record<string, string> = {};
  for (const name of request.envNames) {
    const value = options.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    labName: await expandTopologyLabName(request.labName, topologyFile, options.env),
    topologyDir: path.dirname(topologyFile),
    ...(options.sudo ? {} : { env })
  };
}
