import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ImagesUploadResponse } from "@srl-labs/containerlab-lab-backend";

import { RequestError } from "../runtimeProxy.ts";
import type { ImagesConfig } from "./config.ts";
import { ImagesError } from "./errors.ts";
import { chownHandleToRunAs } from "./ownership.ts";
import { validateImageFileName } from "./validate.ts";

const FILE_MODE = 0o660;

export interface UploadManagerOptions {
  config: ImagesConfig;
  imagesDir: string;
  diskFloorBytes: number;
  log?: (message: string) => void;
  /** Free bytes of the images folder; `statfs` unless a test replaces it. */
  freeBytes?: (directory: string) => Promise<number>;
}

async function statfsFree(directory: string): Promise<number> {
  const stat = await fsp.statfs(directory);
  return stat.bavail * stat.bsize;
}

/**
 * Streams uploads into the images folder: `.upload-<uuid>.part`, then fsync,
 * owner change and rename to the final name. The disk check reserves the
 * declared size of every upload in progress, so concurrent uploads cannot
 * together pass the floor. `climg scan` ignores dot-files, so a part file is
 * never listed as an image.
 */
export class UploadManager {
  private reserved = 0;
  private readonly names = new Set<string>();

  constructor(private readonly options: UploadManagerOptions) {}

  get reservedBytes(): number {
    return this.reserved;
  }

  /**
   * `declared`: the Content-Length; required, because the disk check needs the size
   * before writing. The body is read from `source` as it arrives, never buffered.
   */
  async receive(input: { fileName: unknown; declared: number | undefined; source: Readable }): Promise<ImagesUploadResponse> {
    const { config, imagesDir, diskFloorBytes } = this.options;
    const name = validateImageFileName(input.fileName);
    const declared = input.declared;
    if (declared === undefined || !Number.isSafeInteger(declared) || declared <= 0) {
      throw new RequestError("A Content-Length header with the file size is required", 411);
    }
    if (declared > config.uploadMaxBytes) {
      throw new ImagesError(
        `The file is ${declared} bytes; the upload limit is ${config.uploadMaxBytes} bytes`,
        413,
        "too_large"
      );
    }
    const final = path.join(imagesDir, name);
    if (this.names.has(name) || (await exists(final))) {
      throw new ImagesError(`${name} already exists in the images folder`, 409, "exists");
    }
    const free = await (this.options.freeBytes ?? statfsFree)(imagesDir);
    if (free - declared - this.reserved < diskFloorBytes) {
      throw new ImagesError(
        `Not enough free disk: ${free} bytes free, ${declared} to upload, ${this.reserved} reserved by running uploads, ${diskFloorBytes} must stay free`,
        507,
        "disk_floor"
      );
    }

    this.names.add(name);
    this.reserved += declared;
    const part = path.join(imagesDir, `.upload-${randomUUID()}.part`);
    let handle: fsp.FileHandle | undefined;
    let written = 0;
    try {
      const writer = createWriteStream(part, { flags: "wx", mode: FILE_MODE });
      const source = input.source;
      source.on("data", (chunk: Buffer) => {
        written += chunk.length;
        if (written > declared || written > config.uploadMaxBytes) {
          source.destroy(new ImagesError("The body is larger than its Content-Length", 413, "too_large"));
        }
      });
      try {
        await pipeline(source, writer);
      } catch (error) {
        if (source.destroyed && !source.readableEnded && error instanceof Error && error.name === "AbortError") {
          throw new Error("Upload aborted");
        }
        throw error;
      }
      if (written !== declared) {
        throw new ImagesError(`Received ${written} bytes, Content-Length said ${declared}`, 400, "incomplete");
      }
      // The stream closed its descriptor; reopen to flush to disk and hand the file over.
      handle = await fsp.open(part, "r+");
      await handle.sync();
      await chownHandleToRunAs(config.runAs, handle);
      await handle.close();
      handle = undefined;
      // `link` never replaces an existing file, so a file that appeared meanwhile is not overwritten.
      try {
        await fsp.link(part, final);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new ImagesError(`${name} already exists in the images folder`, 409, "exists");
        }
        throw error;
      }
      await fsp.unlink(part);
      const freeAfter = await (this.options.freeBytes ?? statfsFree)(imagesDir);
      this.options.log?.(`image upload ${name}: ${written} bytes stored, ${freeAfter} bytes free in ${imagesDir}`);
      return { name, path: final, size: written, freeBytes: freeAfter };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fsp.rm(part, { force: true });
      throw error;
    } finally {
      this.reserved -= declared;
      this.names.delete(name);
    }
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch {
    return false;
  }
}
