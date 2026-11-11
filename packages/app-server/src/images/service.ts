import fsp from "node:fs/promises";
import path from "node:path";

import type {
  BuiltImage,
  ImageRecord,
  ImagesIndexInfo,
  ImagesScanFile,
  ImagesSearchQuery,
  ImagesStatusResponse,
  ImagesTemplate,
  ImagesTemplateResult,
  ImagesTemplatesResponse
} from "@srl-labs/containerlab-lab-backend";

import { indexArgs, imagesArgs, nodetplArgs, scanArgs, searchArgs, showArgs, doctorArgs, versionArgs, configArgs } from "./args.ts";
import { ClimgClient } from "./client.ts";
import { IMAGE_EXTENSIONS, type ImagesConfig } from "./config.ts";
import { ImagesError } from "./errors.ts";
import { JobRegistry } from "./jobs.ts";
import { Redactor } from "./redact.ts";
import type { AsyncMutex } from "./mutex.ts";
import {
  SUPPORTED_CONTRACT,
  parseBuiltImages,
  parseConfig,
  parseDoctor,
  parseIndex,
  parseNodetplList,
  parseRecord,
  parseRecords,
  parseScan,
  parseTemplateResult,
  parseVersionLine,
  type ClimgConfigDoc
} from "./shapes.ts";
import { UploadManager } from "./upload.ts";
import { validateRef, validateTemplateName } from "./validate.ts";
import type { EndpointUiStore } from "../uiStore.ts";

const DOCTOR_TTL_MS = 5 * 60_000;
const INDEX_REFRESH_TIMEOUT_MS = 120_000;
const DOCTOR_TIMEOUT_MS = 120_000;

export interface ImagesServiceOptions {
  config: ImagesConfig;
  /** The Node Template store of the endpoint; its mutex is shared with the template steps. */
  store: EndpointUiStore;
  mutex: AsyncMutex;
  /** The file `store` serves; `climg` is told to write the same file. */
  nodetplFile: string;
  log?: (message: string) => void;
}

/**
 * Everything the Images routes need, for one local endpoint: `climg` client,
 * the cached doctor, the job registry and the upload manager.
 */
export class ImagesService {
  readonly redactor = new Redactor();
  readonly client: ClimgClient;
  readonly jobs: JobRegistry;
  readonly uploads: UploadManager;
  readonly mutex: AsyncMutex;
  private readonly store: EndpointUiStore;
  private doctorCache: { at: number; value: Promise<ImagesStatusResponse["doctor"]> } | undefined;
  private climgConfig: ClimgConfigDoc | undefined;
  private climgVersion: string | undefined;

  private constructor(private readonly options: ImagesServiceOptions, config: ClimgConfigDoc, version: string) {
    this.client = new ClimgClient(options.config, this.redactor);
    this.mutex = options.mutex;
    this.store = options.store;
    this.climgConfig = config;
    this.climgVersion = version;
    this.redactor.loadFromConfigFile(options.config.configPath ?? config.configFile);
    const stateDir = options.config.statePath ?? config.stateDir;
    this.jobs = new JobRegistry({
      config: options.config,
      client: this.client,
      redactor: this.redactor,
      mutex: options.mutex,
      jobsDir: path.join(stateDir, "jobs"),
      imagesDir: config.imagesDirs[0],
      nodetplFile: options.nodetplFile,
      ...(options.log ? { log: options.log } : {})
    });
    this.uploads = new UploadManager({
      config: options.config,
      imagesDir: config.imagesDirs[0],
      diskFloorBytes: config.diskFloorBytes,
      ...(options.log ? { log: options.log } : {})
    });
  }

  /**
   * Startup check: `climg --version` must report contract 1 and `climg config --json`
   * must parse. Throws an `ImagesError` that names what is wrong.
   */
  static async create(options: ImagesServiceOptions): Promise<ImagesService> {
    const probe = new ClimgClient(options.config, new Redactor());
    const versionResult = await probe.raw(versionArgs(), 20_000);
    if (versionResult.code !== 0) {
      throw new ImagesError(
        `climg --version failed (exit ${versionResult.code}): ${versionResult.stderr.trim().slice(0, 300)}`,
        503,
        "spawn_failed"
      );
    }
    const version = parseVersionLine(versionResult.stdout);
    if (version.contract !== SUPPORTED_CONTRACT) {
      throw new ImagesError(
        `climg ${version.version} speaks contract ${version.contract}; this server needs contract ${SUPPORTED_CONTRACT}`,
        503,
        "incompatible"
      );
    }
    const config = parseConfig(await probe.json(configArgs(), { timeoutMs: 30_000 }));
    if (config.contract !== SUPPORTED_CONTRACT) {
      throw new ImagesError(`climg config reports contract ${config.contract}; this server needs ${SUPPORTED_CONTRACT}`, 503, "incompatible");
    }
    const service = new ImagesService(options, config, version.version);
    await service.jobs.recover();
    return service;
  }

  get config(): ClimgConfigDoc {
    return this.climgConfig as ClimgConfigDoc;
  }

  private async fresh<T>(args: string[], parse: (value: unknown) => T, timeoutMs?: number): Promise<T> {
    const value = parse(await this.client.json(args, timeoutMs ? { timeoutMs } : {}));
    return this.redactor.deep(value);
  }

  private doctor(): Promise<ImagesStatusResponse["doctor"]> {
    if (!this.doctorCache || Date.now() - this.doctorCache.at > DOCTOR_TTL_MS) {
      const value = this.client
        .json(doctorArgs(), { timeoutMs: DOCTOR_TIMEOUT_MS, allowExit1: true })
        .then((raw) => {
          const checks = this.redactor.deep(parseDoctor(raw));
          return { checks, checkedAt: new Date().toISOString(), ok: checks.every((check) => check.status.toUpperCase() !== "FAIL") };
        });
      this.doctorCache = { at: Date.now(), value };
      // A failed doctor is not cached.
      value.catch(() => {
        if (this.doctorCache?.value === value) this.doctorCache = undefined;
      });
    }
    return this.doctorCache.value;
  }

  async status(): Promise<ImagesStatusResponse> {
    const { config } = this;
    return {
      configured: true,
      contract: SUPPORTED_CONTRACT,
      climgVersion: this.climgVersion ?? "",
      config: {
        imagesDirs: config.imagesDirs,
        stateDir: config.stateDir,
        diskFloorBytes: config.diskFloorBytes,
        maxBuilds: config.maxBuilds,
        mirrors: config.mirrors,
        ...(config.workspace !== undefined ? { workspace: config.workspace } : {}),
        ...(config.nodetplFile !== undefined ? { nodetplFile: config.nodetplFile } : {}),
        ...(config.nodetplWriter !== undefined ? { nodetplWriter: config.nodetplWriter } : {}),
        credentialsSet: config.credentialsSet
      },
      doctor: await this.doctor(),
      uploadMaxBytes: this.options.config.uploadMaxBytes,
      uploadExtensions: [...IMAGE_EXTENSIONS],
      maxJobs: this.options.config.maxJobs,
      maxRunning: this.jobs.slots,
      maxQueued: this.options.config.maxQueued
    };
  }

  async index(refresh: boolean): Promise<ImagesIndexInfo> {
    return this.fresh(indexArgs(refresh), parseIndex, refresh ? INDEX_REFRESH_TIMEOUT_MS : undefined);
  }

  async search(query: ImagesSearchQuery): Promise<ImageRecord[]> {
    return this.fresh(searchArgs(query), parseRecords);
  }

  async show(ref: unknown): Promise<ImageRecord> {
    return this.fresh(showArgs(ref), parseRecord);
  }

  async images(): Promise<BuiltImage[]> {
    return this.fresh(imagesArgs(), parseBuiltImages);
  }

  async scan(): Promise<ImagesScanFile[]> {
    return this.fresh(scanArgs(), parseScan);
  }

  /** `nodetpl list --json` joined with the template store: managed flag from `climg`, content from the store. */
  async templates(): Promise<ImagesTemplatesResponse> {
    const [listed, built, stored] = await Promise.all([
      this.fresh(nodetplArgs(this.options.nodetplFile, "list"), parseNodetplList),
      this.images().catch(() => undefined),
      this.store.getCustomNodes()
    ]);
    const present = built ? new Set(built.filter((image) => image.built !== false).map((image) => image.tag)) : undefined;
    const owned = new Map(listed.map((row) => [row.name, row]));
    const templates: ImagesTemplate[] = stored.customNodes.map((node) => {
      const name = String(node.name ?? "");
      const image = typeof node.image === "string" ? node.image : undefined;
      const customized = owned.get(name)?.customized;
      return {
        name,
        kind: String(node.kind ?? ""),
        ...(image !== undefined ? { image } : {}),
        ...(typeof node.icon === "string" ? { icon: node.icon } : {}),
        managed: owned.get(name)?.owned === true,
        ...(customized !== undefined ? { customized } : {}),
        imagePresent: image === undefined || present === undefined || !image.startsWith("vrnetlab/") ? null : present.has(image)
      };
    });
    return { templates: this.redactor.deep(templates) };
  }

  private async writeTemplates(
    action: "add" | "remove" | "sync",
    target: string | undefined,
    dryRun = false
  ): Promise<ImagesTemplateResult> {
    const args = nodetplArgs(this.options.nodetplFile, action, target, dryRun);
    if (dryRun) return this.fresh(args, parseTemplateResult);
    return this.mutex.run(() => this.fresh(args, parseTemplateResult));
  }

  async addTemplate(ref: unknown): Promise<ImagesTemplateResult> {
    return this.writeTemplates("add", validateRef(ref));
  }

  /** Removes a template `climg` owns; any other template is refused. */
  async removeTemplate(nameValue: unknown): Promise<ImagesTemplateResult> {
    const name = validateTemplateName(nameValue);
    return this.mutex.run(async () => {
      const listed = await this.fresh(nodetplArgs(this.options.nodetplFile, "list"), parseNodetplList);
      const row = listed.find((entry) => entry.name === name);
      if (!row) throw new ImagesError(`No Node Template named ${name}`, 404, "not_found");
      if (!row.owned) throw new ImagesError(`${name} is not managed by climg and cannot be removed here`, 403, "not_managed");
      return this.fresh(nodetplArgs(this.options.nodetplFile, "remove", name), parseTemplateResult);
    });
  }

  async syncTemplates(dryRun: boolean): Promise<ImagesTemplateResult> {
    return this.writeTemplates("sync", undefined, dryRun);
  }

  /** Free bytes where images live; for the upload log line and tests. */
  async freeBytes(): Promise<number> {
    const stat = await fsp.statfs(this.config.imagesDirs[0]);
    return stat.bavail * stat.bsize;
  }
}
