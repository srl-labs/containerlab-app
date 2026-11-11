import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { EndpointUiStore } from "../uiStore.ts";
import type { ImagesRunAs } from "./config.ts";
import { chownHandleToRunAs, mkdirForRunAs } from "./ownership.ts";

/** Runs tasks one at a time, in the order they were asked for; a failing task does not block the next. */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

/** Mode of the Node Template file and its folder: the `climg` user and the host group can write. */
const TEMPLATE_FILE_MODE = 0o660;
const TEMPLATE_DIR_MODE = 0o770;

/**
 * Replaces a file atomically: temp file next to it, owner and mode set, then
 * rename, so a reader sees the old or the new content and never a mix.
 */
export function createAtomicFileWriter(runAs: ImagesRunAs | undefined) {
  return async (file: string, content: string): Promise<void> => {
    const directory = path.dirname(file);
    await mkdirForRunAs(runAs, directory, TEMPLATE_DIR_MODE);
    const temp = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
    const handle = await fs.open(temp, "wx", TEMPLATE_FILE_MODE);
    try {
      await handle.writeFile(content, "utf8");
      await handle.chmod(TEMPLATE_FILE_MODE);
      await chownHandleToRunAs(runAs, handle);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await fs.rm(temp, { force: true });
      throw error;
    }
    await handle.close();
    try {
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  };
}

/** Serialises every write of the Node Template store; reads stay lock-free because writes are atomic. */
export function withNodeTemplateLock(store: EndpointUiStore, mutex: AsyncMutex): EndpointUiStore {
  return {
    ...store,
    saveCustomNode: (customNode) => mutex.run(() => store.saveCustomNode(customNode)),
    replaceCustomNodes: (customNodes) => mutex.run(() => store.replaceCustomNodes(customNodes)),
    deleteCustomNode: (name) => mutex.run(() => store.deleteCustomNode(name)),
    setDefaultCustomNode: (name) => mutex.run(() => store.setDefaultCustomNode(name))
  };
}
