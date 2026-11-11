import path from "node:path";

import { createLocalUiStore } from "../localUiStore.ts";
import type { EndpointUiStore } from "../uiStore.ts";
import { resolveImagesConfig } from "./config.ts";
import { AsyncMutex, createAtomicFileWriter, withNodeTemplateLock } from "./mutex.ts";
import { ImagesService } from "./service.ts";

/** What a local endpoint offers for images: a running service, or the reason it has none. */
export type ImagesHandle = { service: ImagesService } | { problem: string };

/** The part of a local endpoint that `enableImages` fills in. */
export interface ImagesCapableEndpoint {
  url: string;
  backend: { options: { workspaceRoot: string } };
  ui: EndpointUiStore;
  images?: ImagesHandle;
}

/**
 * Turns the Images feature on for one local endpoint when `climg` is configured
 * in the environment: the Node Template store moves to the workspace (the folder
 * `climg` is told to write), gets its lock and atomic writes, and `climg` is checked.
 * Returns the messages to log; the endpoint is left as it was when `climg` is not configured.
 */
export async function enableImages(
  endpoint: ImagesCapableEndpoint,
  env: NodeJS.ProcessEnv,
  options: { prefix?: string; log?: (message: string) => void; extraEnv?: Record<string, string> } = {}
): Promise<string[]> {
  const resolved = resolveImagesConfig(env, options.prefix);
  const { problems } = resolved;
  const config = resolved.config && options.extraEnv ? { ...resolved.config, extraEnv: options.extraEnv } : resolved.config;
  const messages = [...problems];
  if (!config) {
    const configured = (env[`${options.prefix ?? "WEB_LOCAL_"}CLIMG_PATH`] ?? "").trim() !== "";
    if (configured) endpoint.images = { problem: problems[0] ?? "invalid configuration" };
    return messages;
  }
  const workspace = endpoint.backend.options.workspaceRoot;
  const nodetplFile = path.join(workspace, "ui", "custom-nodes.json");
  const mutex = new AsyncMutex();
  const store = withNodeTemplateLock(
    createLocalUiStore({
      clabDirectory: workspace,
      workspaceRoot: workspace,
      writeFile: createAtomicFileWriter(config.runAs)
    }),
    mutex
  );
  // The workspace store is the palette's source whether or not climg starts.
  endpoint.ui = store;
  try {
    const service = await ImagesService.create({
      config,
      store,
      mutex,
      nodetplFile,
      ...(options.log ? { log: options.log } : {})
    });
    endpoint.images = { service };
    messages.push(`Images: climg ${service.config.version} (contract ${service.config.contract}), images in ${service.config.imagesDirs[0]}, Node Templates in ${nodetplFile}.`);
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    endpoint.images = { problem };
    messages.push(`Images are off: ${problem}`);
  }
  return messages;
}
