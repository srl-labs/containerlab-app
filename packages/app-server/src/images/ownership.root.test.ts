// Runs only as root (uid 0): the chown and setuid paths cannot be exercised by an ordinary user.
// Run it with `bash packages/app-server/scripts/run-root-tests.sh` (a Docker container).
import assert from "node:assert/strict";
// The test starts a child as another user to prove the files stay usable for it.
// oxlint-disable-next-line no-restricted-imports
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import type { ImagesJob } from "@srl-labs/containerlab-lab-backend";

import { createLocalUiStore } from "../localUiStore.ts";
import { resolveImagesConfig } from "./config.ts";
import { enableImages, type ImagesCapableEndpoint } from "./setup.ts";
import { FAKE_CLIMG } from "./testHarness.ts";

const IS_ROOT = process.getuid?.() === 0;
const UID = 1000;
const GID = 1000;

async function expectOwner(target: string, mode?: number): Promise<void> {
  const stat = await fs.lstat(target);
  assert.equal(`${stat.uid}:${stat.gid}`, `${UID}:${GID}`, `${target} owner`);
  if (mode !== undefined) assert.equal(stat.mode & 0o777, mode, `${target} mode`);
}

async function untilEnded(service: NonNullable<Awaited<ReturnType<typeof setup>>["service"]>, id: string): Promise<ImagesJob> {
  for (let i = 0; i < 300; i += 1) {
    const job = await service.jobs.get(id);
    if (job.state !== "running" && job.state !== "queued") return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job did not end");
}

/** `enableImages` as the server does it in production, with root as the server user. */
async function setup(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "images-root-test-"));
  // The run-as user must reach everything below; the server creates the rest.
  await fs.chown(root, UID, GID);
  const imagesDir = path.join(root, "images");
  const stateDir = path.join(root, "state"); // does not exist: the server creates state/jobs
  const workspace = path.join(root, "ws"); // does not exist: the server creates ws/ui
  const callLog = path.join(root, "calls.jsonl");
  const configFile = path.join(root, "climg.yaml");
  await fs.mkdir(imagesDir);
  await fs.chown(imagesDir, UID, GID);
  await fs.writeFile(callLog, "");
  await fs.chown(callLog, UID, GID);
  await fs.writeFile(configFile, `workspace: ${workspace}\n`);
  await fs.chown(configFile, UID, GID);
  const nodetplFile = path.join(workspace, "ui", "custom-nodes.json");

  const endpoint: ImagesCapableEndpoint = {
    url: "local",
    backend: { options: { workspaceRoot: workspace } },
    ui: createLocalUiStore({ clabDirectory: workspace, workspaceRoot: workspace })
  };
  const messages = await enableImages(
    endpoint,
    {
      WEB_LOCAL_CLIMG_PATH: FAKE_CLIMG,
      WEB_LOCAL_CLIMG_CONFIG: configFile,
      WEB_LOCAL_CLIMG_STATE: stateDir,
      WEB_LOCAL_CLIMG_USER: `${UID}:${GID}`
    },
    { extraEnv: { FAKE_CLIMG_LOG: callLog, FAKE_IMAGES_DIR: imagesDir, FAKE_NODETPL_FILE: nodetplFile } }
  );
  const service = endpoint.images && "service" in endpoint.images ? endpoint.images.service : undefined;
  assert.ok(service, `images enabled: ${messages.join("; ")}`);
  t.after(async () => {
    await service.jobs.idle(5000);
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, imagesDir, stateDir, workspace, nodetplFile, callLog, endpoint, service };
}

test("uid 0 in WEB_LOCAL_CLIMG_USER is refused, and so is a missing user when running as root", { skip: !IS_ROOT }, async () => {
  const base = { WEB_LOCAL_CLIMG_PATH: FAKE_CLIMG };
  const zero = resolveImagesConfig({ ...base, WEB_LOCAL_CLIMG_USER: "0:0" });
  assert.equal(zero.config, undefined);
  assert.match(zero.problems[0], /must not be root/);
  assert.equal(resolveImagesConfig({ ...base, WEB_LOCAL_CLIMG_USER: "0:1000" }).config, undefined);
  const missing = resolveImagesConfig(base);
  assert.equal(missing.config, undefined);
  assert.match(missing.problems[0], /required when the server runs as root/);

  const endpoint: ImagesCapableEndpoint = {
    url: "local",
    backend: { options: { workspaceRoot: "/nonexistent" } },
    ui: createLocalUiStore({ clabDirectory: "/nonexistent", workspaceRoot: "/nonexistent" })
  };
  await enableImages(endpoint, { ...base, WEB_LOCAL_CLIMG_USER: "0:0" });
  assert.ok(endpoint.images && "problem" in endpoint.images);
});

test("climg runs as the configured uid:gid and the job files it leaves are owned by that user", { skip: !IS_ROOT }, async (t) => {
  const ctx = await setup(t);
  const started = await ctx.service.jobs.start({ op: "pull", ref: "labhub:vios-1" });
  const ended = await untilEnded(ctx.service, started.id);
  assert.equal(ended.state, "succeeded");

  const calls = (await fs.readFile(ctx.callLog, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { argv: string[]; uid: number; gid: number });
  assert.ok(calls.length >= 3, "version, config and pull were recorded");
  for (const call of calls) assert.deepEqual([call.uid, call.gid], [UID, GID], `climg ${call.argv[0]} ran as ${call.uid}:${call.gid}`);
  assert.ok(calls.some((call) => call.argv[0] === "pull"));

  const jobsDir = path.join(ctx.stateDir, "jobs");
  await expectOwner(ctx.stateDir);
  await expectOwner(jobsDir);
  const names = await fs.readdir(jobsDir);
  assert.ok(names.some((name) => name.endsWith(".json")) && names.some((name) => name.endsWith(".out")) && names.some((name) => name.endsWith(".err")));
  for (const name of names) await expectOwner(path.join(jobsDir, name));
});

test("an uploaded image is owned by the run-as user", { skip: !IS_ROOT }, async (t) => {
  const ctx = await setup(t);
  const body = Buffer.from("not really a qcow2");
  const result = await ctx.service.uploads.receive({ fileName: "a.qcow2", declared: body.length, source: Readable.from([body]) });
  await expectOwner(result.path); // creation modes of these files are masked by the umask; the owner is what matters
  assert.deepEqual(await fs.readdir(ctx.imagesDir), ["a.qcow2"], "no part file is left");
});

test("custom-nodes.json after a palette save is 0660 owned by the run-as user, and that user can read and rewrite it", { skip: !IS_ROOT }, async (t) => {
  const ctx = await setup(t);
  await ctx.endpoint.ui.saveCustomNode({ name: "palette", kind: "linux", image: "alpine" });
  await expectOwner(ctx.nodetplFile, 0o660);
  const directory = path.dirname(ctx.nodetplFile);
  await expectOwner(directory);
  await expectOwner(path.dirname(directory));

  // Replace it a second time: the rename must keep the owner and mode.
  await ctx.endpoint.ui.saveCustomNode({ name: "second", kind: "linux", image: "alpine" });
  await expectOwner(ctx.nodetplFile, 0o660);
  assert.deepEqual((await fs.readdir(directory)).sort(), ["custom-nodes.json"], "no temp file is left");

  // As climg (uid 1000): read, rewrite in place, and create a sibling, as `climg nodetpl` does.
  const script = `
    const fs = require("node:fs");
    const file = process.argv[1];
    if (process.getuid() !== ${UID} || process.getgid() !== ${GID}) throw new Error("wrong user");
    const nodes = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!nodes.some((node) => node.name === "palette")) throw new Error("palette missing");
    fs.writeFileSync(file, JSON.stringify([...nodes, { name: "from-climg", kind: "linux", image: "alpine" }]) + "\\n");
    fs.writeFileSync(file + ".owned.json", "[]");
  `;
  const run = spawnSync(process.execPath, ["-e", script, ctx.nodetplFile], { uid: UID, gid: GID, encoding: "utf8" });
  assert.equal(run.status, 0, `child as ${UID}:${GID} failed: ${run.stderr}`);
  const after = JSON.parse(await fs.readFile(ctx.nodetplFile, "utf8")) as Array<{ name: string }>;
  assert.ok(after.some((node) => node.name === "from-climg"));

  // And the server can still save over what climg wrote.
  await ctx.endpoint.ui.saveCustomNode({ name: "third", kind: "linux", image: "alpine" });
  await expectOwner(ctx.nodetplFile, 0o660);
});
