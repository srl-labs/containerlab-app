/**
 * The Images view against an in-memory fake `ImagesClient` and a real jobs watcher.
 * `?state=` picks the scenario: `ready` (default), `unavailable`, `labhost`, `nokvm`,
 * `empty`, `error-unavailable`. `?theme=light|dark` picks the theme.
 * `window.__IMAGES__` records the client calls for specs to read. The initial running
 * pull of the `ready` state stays at 42% so specs can cancel it; jobs started in the
 * page advance 20% per 300 ms and then succeed. The `ready` state also has one queued job (place 1)
 * behind the running one, and two H3C entries without a buildable kind (listed because `all` is on).
 */
import React from "react";
import { createRoot } from "react-dom/client";

import { MuiThemeProvider } from "../../src/theme/MuiThemeProvider";
import { applyStandaloneAppearance, readStandaloneAppearance } from "../../src/workspace/state/themePreferences";
import { ImagesView } from "../../src/workspace/images/ImagesView";
import { createImagesJobsWatcher } from "../../src/workspace/images/jobsWatcher";
import type {
  ImageRecord,
  ImagesClient,
  ImagesDoctorCheck,
  ImagesIndexInfo,
  ImagesJob,
  ImagesJobRequest,
  ImagesScanFile,
  ImagesSearchQuery,
  ImagesStatus,
  ImagesTemplate,
  ImagesTemplateResult,
  ImagesUnavailableInfo
} from "../../src/workspace/images/types";
import "../../src/styles/global.css";

const params = new URLSearchParams(location.search);
applyStandaloneAppearance(readStandaloneAppearance(), params.get("theme") === "light" ? "light" : "dark");
const state = params.get("state") ?? "ready";

const LATENCY_MS = 150;
const JOB_TICK_MS = 300;
const GIB = 2 ** 30;

const CONFIG_KEYS = ["WEB_LOCAL_CLIMG_PATH", "WEB_LOCAL_CLIMG_CONFIG", "WEB_LOCAL_CLIMG_STATE", "WEB_LOCAL_CLIMG_USER", "WEB_LOCAL_CLIMG_HOME", "WEB_LOCAL_IMAGES_UPLOAD_MAX", "WEB_LOCAL_IMAGES_MAX_RUNNING", "WEB_LOCAL_IMAGES_MAX_QUEUED"];
const NOT_CONFIGURED: ImagesUnavailableInfo = {
  reason: "unavailable",
  detail: "The image manager is not configured on this server. Set WEB_LOCAL_CLIMG_PATH (and the other WEB_LOCAL_CLIMG_* settings).",
  configKeys: CONFIG_KEYS
};
const LAB_HOST: ImagesUnavailableInfo = {
  reason: "unavailable",
  detail: "The Images view is not available for this endpoint: it needs a local lab host."
};

interface Fixture extends ImageRecord {
  id?: number;
  section?: string;
}

const fixtureRecords: Fixture[] = [
  { key: "labhub:vios-159-3.M3", source: "labhub", status: "available", kind: "cisco_vios", version: "159-3.M3", name: "vios-159-3.M3", size: 57_000_000, tag: "vrnetlab/cisco_vios:159-3.M3", detail: "", id: 412, section: "QEMU" },
  { key: "labhub:vios-159-3.M2", source: "labhub", status: "available", kind: "cisco_vios", version: "159-3.M2", name: "vios-159-3.M2", size: 56_000_000, tag: "vrnetlab/cisco_vios:159-3.M2", detail: "", id: 411, section: "QEMU" },
  { key: "labhub:Cisco IOSv L2 2020", source: "labhub", status: "available", kind: "cisco_vios", version: "2020", name: "Cisco IOSv L2 2020", size: 82_000_000, tag: "vrnetlab/cisco_vios:2020", detail: "", id: 77, section: "QEMU" },
  { key: "labhub:vEOS-lab-4.32.0F", source: "labhub", status: "available", kind: "arista_veos", version: "4.32.0F", name: "vEOS-lab-4.32.0F", size: 610_000_000, tag: "vrnetlab/arista_veos:4.32.0F", detail: "", id: 305, section: "QEMU" },
  { key: "labhub:vjunos-router-23.4R1", source: "labhub", status: "built", kind: "juniper_vjunosrouter", version: "23.4R1", name: "vjunos-router-23.4R1", size: 1_900_000_000, tag: "vrnetlab/juniper_vjunosrouter:23.4R1", detail: "", id: 220, section: "QEMU" },
  { key: "labhub:sros-25.7.R1", source: "labhub", status: "available", kind: "nokia_sros", version: "25.7.R1", name: "sros-25.7.R1", size: 1_100_000_000, tag: "vrnetlab/nokia_sros:25.7.R1", detail: "", id: 150, section: "QEMU" },
  { key: "labhub:csr1000v-17.3", source: "labhub", status: "cached", kind: "cisco_csr1000v", version: "17.3", name: "csr1000v-17.3", size: 920_000_000, tag: "vrnetlab/cisco_csr1000v:17.3", detail: "", id: 98, section: "QEMU" },
  { key: "local:vEOS64-lab-4.32.0F.qcow2", source: "local", status: "cached", kind: "arista_veos", version: "4.32.0F", size: 610_000_000, tag: "vrnetlab/arista_veos:4.32.0F", path: "/srv/images/vEOS64-lab-4.32.0F.qcow2" }
];

const vendorByKind: Record<string, [string, string]> = {
  cisco_vios: ["Cisco", "Cisco/IOSv"], cisco_csr1000v: ["Cisco", "Cisco/CSR1000v"], arista_veos: ["Arista", "Arista/vEOS"],
  juniper_vjunosrouter: ["Juniper", "Juniper/vJunos"], nokia_sros: ["Nokia", "Nokia/SR OS"]
};
const withVendor = (record: Fixture): Fixture => {
  const [vendor, folder] = vendorByKind[record.kind ?? ""] ?? [undefined, undefined];
  if (vendor === undefined) return record;
  return { ...record, vendor, folder: record.source === "local" ? null : folder };
};
const unbuildableRecords: Fixture[] = [
  { key: "labhub:h3cvsr1k-7.1.064-R1362P12", source: "labhub", status: "unbuildable", kind: null, version: null, name: "h3cvsr1k-7.1.064-R1362P12", size: 700_000_000, detail: "", id: 901, section: "QEMU", vendor: "H3C", folder: "H3C/vSR", model: "vSR" },
  { key: "labhub:h3cvswitch_S9850-7.1.070-R7639P06", source: "labhub", status: "unbuildable", kind: null, version: null, name: "h3cvswitch_S9850-7.1.070-R7639P06", size: 650_000_000, detail: "", id: 902, section: "QEMU", vendor: "H3C", folder: "H3C/vSW", model: "vSW" }
];

const records: Fixture[] = state === "empty" ? [] : [...fixtureRecords.map(withVendor), ...unbuildableRecords].map((record) => ({ ...record }));

const templates: ImagesTemplate[] = [
  { name: "cisco-vios-159-3.M3", kind: "cisco_vios", image: "vrnetlab/cisco_vios:159-3.M3", icon: "router", managed: true, customized: true, imagePresent: true },
  { name: "arista-veos-4.32.0F", kind: "arista_veos", image: "vrnetlab/arista_veos:4.32.0F", managed: true, customized: true, imagePresent: false },
  { name: "srl", kind: "nokia_srlinux", image: "ghcr.io/nokia/srlinux:latest", managed: false, imagePresent: null }
];

function doctorChecks(): ImagesDoctorCheck[] {
  const kvm: ImagesDoctorCheck = state === "nokvm"
    ? { check: "/dev/kvm", status: "FAIL", detail: "missing" }
    : { check: "/dev/kvm", status: "ok", detail: "present and accessible" };
  return [
    { check: "config", status: "ok", detail: "/etc/climg.yaml" },
    { check: "docker", status: "ok", detail: "29.0.1" },
    kvm,
    { check: "containerlab", status: "ok", detail: "0.70.2" },
    { check: "vrnetlab", status: "ok", detail: "/home/user/containerlab/vrnetlab @ 4f2a1c" },
    { check: "disk", status: "ok", detail: "412.0 GB free, floor 20.0 GB" },
    { check: "mirror main", status: "ok", detail: "Range probe HTTP 206 in 120 ms" }
  ];
}

function fakeStatus(): ImagesStatus {
  return {
    configured: true,
    contract: 1,
    climgVersion: "0.4.0",
    config: {
      imagesDirs: ["/srv/images"],
      stateDir: "/home/user/.local/state/climg",
      diskFloorBytes: 20e9,
      maxBuilds: 2,
      mirrors: ["main", "eu"],
      credentialsSet: true
    },
    doctor: { checks: doctorChecks(), checkedAt: new Date().toISOString(), ok: state !== "nokvm" },
    uploadMaxBytes: 20 * GIB,
    uploadExtensions: [".qcow2", ".vmdk", ".tgz", ".tar.gz", ".bin", ".iol"],
    maxJobs: 4
  };
}

const indexInfo: ImagesIndexInfo = {
  release: "2025.10.1", age: "3h12m", counts: { QEMU: 180, IOL: 12 }, buildable: 96,
  vendors: [
    { vendor: "Cisco", entries: 3, buildable: 3 }, { vendor: "Arista", entries: 2, buildable: 2 }, { vendor: "Juniper", entries: 1, buildable: 1 },
    { vendor: "Nokia", entries: 1, buildable: 1 }, { vendor: "H3C", entries: 2, buildable: 0 }
  ]
};

// ---- helpers ----

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function unavailableError(info: ImagesUnavailableInfo): Error {
  return Object.assign(new Error(info.detail), { unavailable: info });
}

function vendorOf(record: ImageRecord): string {
  return (record.vendor ?? (record.kind ?? "").split("_")[0] ?? "").toLowerCase();
}

function matches(record: ImageRecord, query: ImagesSearchQuery): boolean {
  if (query.kind !== undefined && query.kind !== "" && record.kind !== query.kind) return false;
  if (query.vendor !== undefined && query.vendor !== "" && vendorOf(record) !== query.vendor.toLowerCase()) return false;
  if (query.all !== true && record.status === "unbuildable") return false;
  if (query.source && query.source !== "all" && record.source !== query.source) return false;
  if (query.status && record.status !== query.status) return false;
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [record.name, record.key, record.kind, record.version, record.tag, record.vendor, record.folder].map((value) => String(value ?? "").toLowerCase());
  return words.every((word) => haystack.some((value) => value.includes(word)));
}

function findRecord(ref: string): Fixture | undefined {
  if (ref.startsWith("#")) return records.find((record) => String(record.id) === ref.slice(1));
  return records.find((record) => record.key === ref || record.tag === ref);
}

function templateNameOf(record: ImageRecord): string {
  return `${(record.kind ?? "image").replace(/_/g, "-")}-${record.version ?? record.name ?? "latest"}`;
}

function showRecord(record: Fixture): ImageRecord {
  const base = record.size ?? 0;
  return {
    ...record,
    predicted_tag: record.tag ?? null,
    built_tag: record.status === "built" ? (record.tag ?? null) : null,
    files: [{ filename: `${record.name ?? record.key.split(":")[1]}.qcow2`, size: base, checksum: { md5: "9e107d9d372bb6826bd81d3542a419d6", sha1: "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12" } }],
    patches: record.kind === "cisco_vios" ? [{ name: "vios-serial-console.patch", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }] : null,
    kind_patches: record.kind === "cisco_vios" ? ["vios-boot-order"] : null,
    make: (record.kind ?? "") !== "" ? `make -C ${(record.kind ?? "").replace("_", "/")} docker-image` : null
  };
}

function templateResult(action: string, dryRun: boolean, extra: Partial<ImagesTemplateResult> = {}): ImagesTemplateResult {
  return { action, dry_run: dryRun, writer: "file", changes: [], skipped: [], added: [], updated: [], removed: [], ...extra };
}

function upsertTemplate(record: ImageRecord): void {
  const name = templateNameOf(record);
  if (templates.some((template) => template.name === name)) return;
  templates.push({ name, kind: record.kind ?? "", image: record.tag, icon: "router", managed: true, imagePresent: record.status === "built" || record.status === "cached" });
}

// ---- jobs ----

const jobs: ImagesJob[] = [];
let jobSeq = 0;

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function finishJob(job: ImagesJob, outcome: ImagesJob["state"]): void {
  job.state = outcome;
  job.updatedAt = iso();
  job.finishedAt = iso();
  if (outcome !== "succeeded") return;
  job.phase = "done";
  job.pct = 100;
  job.message = "Done";
  job.log.push("done");
  const record = job.ref !== undefined ? findRecord(job.ref) : undefined;
  if (record && (job.op === "pull" || job.op === "build")) {
    record.status = "built";
    upsertTemplate(record);
    job.nodetpl = { name: templateNameOf(record), written: true };
  }
}

function startFakeJob(request: ImagesJobRequest): ImagesJob {
  jobSeq += 1;
  const job: ImagesJob = {
    ...request,
    id: `job-${jobSeq}`,
    state: "running",
    phase: request.op === "build" ? "build" : "download",
    pct: 0,
    message: "Starting",
    log: [`${request.op} ${request.ref ?? request.file ?? ""}`.trim()],
    startedAt: iso(),
    updatedAt: iso()
  };
  jobs.push(job);
  const timer = setInterval(() => {
    if (job.state !== "running") {
      clearInterval(timer);
      return;
    }
    job.pct = Math.min(100, (job.pct ?? 0) + 20);
    job.updatedAt = iso();
    job.message = `${job.pct}%`;
    job.log.push(`progress ${job.pct}%`);
    if (job.pct >= 100) {
      clearInterval(timer);
      finishJob(job, "succeeded");
    }
  }, JOB_TICK_MS);
  return job;
}

if (state === "ready" || state === "nokvm") {
  jobs.push(
    {
      id: "job-seed-pull",
      op: "pull",
      ref: "labhub:sros-25.7.R1",
      state: "running",
      phase: "download",
      pct: 42,
      message: "Downloading sros-25.7.R1",
      log: ["resolving labhub:sros-25.7.R1", "mirror main: HTTP 206", "downloading 1.1 GB", "downloaded 462 MB of 1.1 GB"],
      startedAt: iso(-60_000),
      updatedAt: iso(-1_000)
    },
    {
      id: "job-seed-queued",
      op: "pull",
      ref: "labhub:csr1000v-17.3",
      state: "queued",
      phase: "",
      pct: null,
      message: "queued",
      log: [],
      queuePosition: 1,
      startedAt: iso(-30_000),
      updatedAt: iso(-30_000)
    },
    {
      id: "job-seed-build",
      op: "build",
      ref: "labhub:vjunos-router-23.4R1",
      state: "succeeded",
      phase: "done",
      pct: 100,
      message: "Done",
      log: ["make docker-image", "built vrnetlab/juniper_vjunosrouter:23.4R1"],
      startedAt: iso(-600_000),
      updatedAt: iso(-300_000),
      finishedAt: iso(-300_000),
      nodetpl: { name: "juniper-vjunosrouter-23.4R1", written: true, kept: ["interfacePattern", "icon"] }
    }
  );
}

// ---- client ----

interface ImagesProbe {
  calls: string[];
  templatesChanged: number;
  jobsEnded: number;
  /** File names whose upload finished. */
  uploaded: string[];
}

const probe: ImagesProbe = { calls: [], templatesChanged: 0, jobsEnded: 0, uploaded: [] };
Object.assign(window, { __IMAGES__: probe });

/** Records the call (except the jobs poll, which would drown the list) and answers after the fake latency. */
async function call<T>(name: string, args: unknown[], run: () => T | Promise<T>): Promise<T> {
  if (name !== "jobs") probe.calls.push(`${name} ${JSON.stringify(args)}`);
  await sleep(LATENCY_MS);
  return run();
}

function scanFiles(): ImagesScanFile[] {
  return records
    .filter((record) => record.source === "local")
    .map((record) => ({
      path: String(record.path ?? ""),
      size: record.size ?? 0,
      kind: record.kind ?? null,
      version: record.version ?? null,
      tag: record.tag ?? null,
      status: record.status
    }));
}

function guessLocal(name: string): { kind: string | null; version: string | null } {
  const match = /^vEOS\S*?-(\d+\.\d+\.\d+[A-Z])\./.exec(name);
  return match ? { kind: "arista_veos", version: match[1] } : { kind: null, version: null };
}

function createFakeClient(): ImagesClient {
  const client: ImagesClient = {
    status: () => call("status", [], () => {
      if (state === "error-unavailable") throw unavailableError(NOT_CONFIGURED);
      return fakeStatus();
    }),
    index: () => call("index", [], () => ({ ...indexInfo })),
    refreshIndex: () => call("refreshIndex", [], () => ({ ...indexInfo, age: "0m" })),
    search: (query, signal) => call("search", [query], () => {
      if (signal?.aborted === true) throw new DOMException("Aborted", "AbortError");
      return records.filter((record) => matches(record, query)).map((record) => ({ ...record }));
    }),
    show: (ref) => call("show", [ref], () => {
      const record = findRecord(ref);
      if (!record) throw new Error(`Image not found: ${ref}`);
      return showRecord(record);
    }),
    scan: () => call("scan", [], scanFiles),
    templates: () => call("templates", [], () => ({ templates: templates.map((template) => ({ ...template })) })),
    addTemplate: (ref) => call("addTemplate", [ref], () => {
      const record = findRecord(ref);
      if (!record) throw new Error(`Image not found: ${ref}`);
      upsertTemplate(record);
      return templateResult("add", false, { added: [templateNameOf(record)] });
    }),
    removeTemplate: (name) => call("removeTemplate", [name], () => {
      const index = templates.findIndex((template) => template.name === name && template.managed);
      if (index < 0) throw new Error(`Not a managed template: ${name}`);
      templates.splice(index, 1);
      return templateResult("remove", false, { removed: [name] });
    }),
    syncTemplates: (dryRun) => call("syncTemplates", [dryRun], () => {
      const result = templateResult("sync", dryRun, {
        changes: [
          { action: "created", name: "juniper-vjunosrouter-23.4R1" },
          { action: "deleted", name: "cisco-csr1000v-17.3" },
          { action: "updated", name: "cisco-vios-159-3.M3", kept: ["interfacePattern"] }
        ],
        skipped: [{ name: "arista-veos-4.32.0F", reason: "edited by user; image missing" }],
        added: ["juniper-vjunosrouter-23.4R1"],
        removed: ["cisco-csr1000v-17.3"]
      });
      if (!dryRun) {
        const built = findRecord("labhub:vjunos-router-23.4R1");
        if (built) upsertTemplate(built);
        const stale = templates.findIndex((template) => template.name === "cisco-csr1000v-17.3");
        if (stale >= 0) templates.splice(stale, 1);
      }
      return result;
    }),
    startJob: (request) => call("startJob", [request], () => ({ ...startFakeJob(request) })),
    jobs: () => call("jobs", [], () => ({ jobs: jobs.map((job) => ({ ...job, log: [...job.log] })), active: jobs.filter((job) => job.state === "running" || job.state === "queued").length })),
    cancelJob: (id) => call("cancelJob", [id], () => {
      const job = jobs.find((entry) => entry.id === id);
      if (!job) throw new Error(`No such job: ${id}`);
      if (job.state === "running" || job.state === "queued") {
        job.state = "cancelled";
        job.message = "Cancelled";
        job.updatedAt = iso();
        job.finishedAt = iso();
      }
      return { ...job, log: [...job.log] };
    }),
    upload: async (file, options) => {
      probe.calls.push(`upload ${JSON.stringify([{ name: file.name, size: file.size }])}`);
      const total = file.size;
      const steps = 10;
      for (let step = 1; step <= steps; step += 1) {
        await sleep(150);
        if (options.signal.aborted) throw new Error("Upload cancelled");
        options.onProgress(Math.round((total * step) / steps), total);
      }
      const path = `/srv/images/${file.name}`;
      records.push({ key: `local:${file.name}`, source: "local", status: "cached", ...guessLocal(file.name), size: total, tag: undefined, path });
      probe.uploaded.push(file.name);
      return { name: file.name, path, size: total, freeBytes: 400 * GIB };
    }
  };
  return client;
}

// ---- mount ----

function Harness() {
  const unavailable = { unavailable: NOT_CONFIGURED, labhost: LAB_HOST }[state as "unavailable" | "labhost"] as ImagesUnavailableInfo | undefined;
  const [{ client, watcher }] = React.useState(() => {
    if (unavailable) return { client: undefined, watcher: undefined };
    const fake = createFakeClient();
    return {
      client: fake,
      watcher: createImagesJobsWatcher(fake, { intervalMs: 300, onJobEnded: () => { probe.jobsEnded += 1; } })
    };
  });
  const onTemplatesChanged = React.useCallback(() => { probe.templatesChanged += 1; }, []);
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <ImagesView
        client={client}
        jobs={watcher}
        endpointLabel="lab-host-1"
        unavailable={unavailable}
        onTemplatesChanged={onTemplatesChanged}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MuiThemeProvider>
      <Harness />
    </MuiThemeProvider>
  </React.StrictMode>
);
