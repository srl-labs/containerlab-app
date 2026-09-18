import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "build";
if (!["build", "serve", "prepare"].includes(mode)) throw new Error(`Unknown docs command: ${mode}`);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["--filter", "@containerlab/clab-viewer", "run", "build"]);
// This directory contains generated assets only. Drop old content-hashed chunks.
await rm(path.join(root, "docs/assets/viewer"), { recursive: true, force: true });
await mkdir(path.join(root, "docs/assets/viewer"), { recursive: true });
await cp(path.join(root, "packages/clab-viewer/dist"), path.join(root, "docs/assets/viewer"), { recursive: true });
if (mode !== "prepare") run("uv", ["run", "--frozen", "zensical", mode, ...(mode === "build" ? ["--strict", "--clean"] : []), ...process.argv.slice(3)]);
