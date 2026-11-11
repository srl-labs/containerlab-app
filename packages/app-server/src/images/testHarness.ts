import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import type { ImagesConfig } from "./config.ts";
import { createLocalUiStore } from "../localUiStore.ts";
import { AsyncMutex, createAtomicFileWriter, withNodeTemplateLock } from "./mutex.ts";
import { ImagesService } from "./service.ts";
import type { EndpointUiStore } from "../uiStore.ts";

export const FAKE_CLIMG = path.join(import.meta.dirname, "fixtures", "fake-climg.mjs");

export interface Harness {
  root: string;
  imagesDir: string;
  stateDir: string;
  workspace: string;
  nodetplFile: string;
  callLog: string;
  config: ImagesConfig;
  store: EndpointUiStore;
  mutex: AsyncMutex;
  service: ImagesService;
  /** Every recorded `climg` command line. */
  calls(): Promise<Array<{ argv: string[]; pid: number; env: string[] }>>;
}

/** A service wired to the fake `climg`, in a temp folder that is removed after the test. */
export async function createHarness(
  t: TestContext,
  options: { env?: Record<string, string>; config?: Partial<ImagesConfig>; password?: string } = {}
): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "images-test-"));
  const imagesDir = path.join(root, "images");
  const stateDir = path.join(root, "state");
  const workspace = path.join(root, "ws");
  const callLog = path.join(root, "calls.jsonl");
  await fs.mkdir(imagesDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  const nodetplFile = path.join(workspace, "ui", "custom-nodes.json");
  const configFile = path.join(root, "climg.yaml");
  await fs.writeFile(
    configFile,
    options.password ? `workspace: ${workspace}\ncredentials:\n  username: admin\n  password: ${options.password}\n` : `workspace: ${workspace}\n`
  );

  const config: ImagesConfig = {
    climgPath: FAKE_CLIMG,
    configPath: configFile,
    statePath: stateDir,
    uploadMaxBytes: 20 * 1024 ** 3,
    maxJobs: 4,
    maxRunning: 4,
    maxQueued: 0,
    extraEnv: {
      FAKE_CLIMG_LOG: callLog,
      FAKE_IMAGES_DIR: imagesDir,
      FAKE_NODETPL_FILE: nodetplFile,
      ...(options.password ? { FAKE_CLIMG_PASSWORD: options.password } : {}),
      ...options.env
    },
    ...options.config
  };
  const mutex = new AsyncMutex();
  const store = withNodeTemplateLock(
    createLocalUiStore({ clabDirectory: workspace, workspaceRoot: workspace, writeFile: createAtomicFileWriter(undefined) }),
    mutex
  );
  let service: ImagesService;
  try {
    service = await ImagesService.create({ config, store, mutex, nodetplFile });
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
  t.after(async () => {
    await service.jobs.idle(5000);
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    imagesDir,
    stateDir,
    workspace,
    nodetplFile,
    callLog,
    config,
    store,
    mutex,
    service,
    async calls() {
      const text = await fs.readFile(callLog, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { argv: string[]; pid: number; env: string[] });
    }
  };
}
