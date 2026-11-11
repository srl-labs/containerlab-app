import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedReason,
  canBuild,
  canPull,
  formatSize,
  freeDiskBytes,
  isUnbuildable,
  queueText,
  sortJobs,
  sortRecords,
  vendorOptions,
  keptFields,
  keptMissingImage,
  keptText,
  localFileName,
  recordRef,
  templateChanges,
  unavailableOf,
  uploadProblem
} from "./imagesModel";
import type { ImageRecord, ImagesDoctorCheck } from "./types";

const record = (fields: Partial<ImageRecord>): ImageRecord => ({ key: "labhub:x", source: "labhub", status: "available", ...fields });
const check = (name: string, status: string, detail = ""): ImagesDoctorCheck => ({ check: name, status, detail });

test("recordRef returns a valid key as is", () => {
  assert.equal(recordRef(record({ key: "labhub:vios-159-3.M3" })), "labhub:vios-159-3.M3");
});

test("recordRef uses #id for a LabHub record whose key has spaces", () => {
  assert.equal(recordRef(record({ key: "labhub:Cisco IOSv L2 2020", id: 77, section: "QEMU" })), "#77");
});

test("recordRef gives a DYNAMIPS record with an invalid key no #id ref (ids collide with QEMU)", () => {
  const dynamips = record({ key: "labhub:c7200-[1]-a3jk9s-mz.124-25g.image", id: 22, section: "DYNAMIPS" });
  assert.equal(recordRef(dynamips), undefined);
  assert.equal(recordRef({ ...dynamips, id: undefined }), undefined);
});

test("recordRef falls back to a valid docker tag, else undefined", () => {
  assert.equal(recordRef(record({ key: "labhub:Cisco IOSv L2 2020", tag: "vrnetlab/cisco_iosv:2020" })), "vrnetlab/cisco_iosv:2020");
  assert.equal(recordRef(record({ key: "labhub:Cisco IOSv L2 2020", tag: "Bad Tag!" })), undefined);
  assert.equal(recordRef(record({ key: "labhub:Cisco IOSv L2 2020" })), undefined);
});

test("recordRef never returns an option-like key", () => {
  assert.equal(recordRef(record({ key: "--force", source: "local" })), undefined);
  assert.equal(recordRef(record({ key: "-rf", source: "local", tag: "--force" })), undefined);
  assert.notEqual(recordRef(record({ key: "--force", id: 5 })), "--force");
});

test("a failed /dev/kvm check blocks pull and build, naming it, but not upload or templates", () => {
  const checks = [check("/dev/kvm", "FAIL", "missing"), check("docker", "ok")];
  assert.match(blockedReason(checks, "pull") ?? "", /\/dev\/kvm/);
  assert.match(blockedReason(checks, "build") ?? "", /\/dev\/kvm/);
  assert.equal(blockedReason(checks, "upload"), undefined);
  assert.equal(blockedReason(checks, "templates"), undefined);
});

test("pull is blocked when every mirror fails, not when one answers", () => {
  assert.ok(blockedReason([check("mirror a", "FAIL"), check("mirror b", "FAIL")], "pull"));
  assert.equal(blockedReason([check("mirror a", "FAIL"), check("mirror b", "ok")], "pull"), undefined);
});

test("warn never blocks and missing checks do not block", () => {
  const warn = [check("/dev/kvm", "warn"), check("disk", "warn"), check("mirror a", "warn")];
  for (const action of ["pull", "build", "upload", "templates"] as const) {
    assert.equal(blockedReason(warn, action), undefined);
    assert.equal(blockedReason(undefined, action), undefined);
  }
});

test("freeDiskBytes parses the disk check", () => {
  assert.equal(freeDiskBytes([check("disk", "ok", "412.0 GB free, floor 20.0 GB")]), 412e9);
  assert.equal(freeDiskBytes([check("docker", "ok")]), undefined);
  assert.equal(freeDiskBytes(undefined), undefined);
});

test("formatSize uses decimal units", () => {
  assert.equal(formatSize(57_000_000), "57.0 MB");
  assert.equal(formatSize(undefined), "–");
  assert.equal(formatSize(null), "–");
  assert.equal(formatSize(512), "512 B");
});

test("uploadProblem checks extension, name and size", () => {
  const limits = { extensions: [".qcow2", ".tar.gz", ".vmdk"], maxBytes: 1_000_000 };
  assert.match(uploadProblem({ name: "a.iso", size: 1 }, limits) ?? "", /\.qcow2 \.tar\.gz \.vmdk/);
  assert.ok(uploadProblem({ name: "../x.qcow2", size: 1 }, limits));
  assert.ok(uploadProblem({ name: "a b.qcow2", size: 1 }, limits));
  assert.match(uploadProblem({ name: "big.qcow2", size: 2_000_000 }, limits) ?? "", /larger than the upload limit/);
  assert.equal(uploadProblem({ name: "vEOS64-lab-4.32.0F.qcow2", size: 500 }, limits), undefined);
  assert.equal(uploadProblem({ name: "image.tar.gz", size: 500 }, limits), undefined);
});

test("localFileName comes from the path, else the key; only for local records", () => {
  assert.equal(localFileName(record({ source: "local", key: "local:k", path: "/var/images/vEOS.qcow2" })), "vEOS.qcow2");
  assert.equal(localFileName(record({ source: "local", key: "local:fallback.qcow2" })), "fallback.qcow2");
  assert.equal(localFileName(record({ source: "labhub", key: "labhub:x", path: "/a/b.qcow2" })), undefined);
  assert.equal(localFileName(record({ source: "local", key: "local:x", path: "/a/b c.qcow2" })), undefined);
});

test("canPull and canBuild depend on source and status", () => {
  assert.equal(canPull(record({ source: "labhub", status: "available" })), true);
  assert.equal(canPull(record({ source: "labhub", status: "built" })), true);
  assert.equal(canPull(record({ source: "local", status: "available" })), false);
  assert.equal(canPull(record({ source: "labhub", status: "unbuildable" })), false);
  assert.equal(canBuild(record({ source: "local", status: "cached", key: "local:a.qcow2" })), true);
  assert.equal(canBuild(record({ source: "local", status: "built", key: "local:a.qcow2" })), false);
  assert.equal(canBuild(record({ source: "labhub", status: "cached", key: "labhub:a" })), false);
  assert.equal(canBuild(record({ source: "local", status: "cached", key: "local:a b.qcow2" })), false);
});

test("unavailableOf returns the info of an unavailable error only", () => {
  const unavailable = { reason: "unavailable" as const, detail: "x", configKeys: ["A"] };
  assert.deepEqual(unavailableOf(Object.assign(new Error("404"), { unavailable })), unavailable);
  assert.equal(unavailableOf(new Error("plain")), undefined);
  assert.equal(unavailableOf(Object.assign(new Error("x"), { unavailable: { reason: "other", detail: "x" } })), undefined);
  assert.equal(unavailableOf(null), undefined);
});

test("templateChanges drops malformed entries", () => {
  const changes = [{ action: "created", name: "a" }, null, "x", { action: "deleted" }, { name: "b" }, { action: 1, name: "c" }, { action: "deleted", name: "d" }];
  assert.deepEqual(templateChanges(changes), [
    { action: "created", name: "a", kept: [] },
    { action: "deleted", name: "d", kept: [] }
  ]);
});

test("templateChanges carries the kept fields of an updated template and ignores a malformed list", () => {
  assert.deepEqual(
    templateChanges([
      { action: "updated", name: "a", kept: ["interfacePattern", "icon"] },
      { action: "updated", name: "b" },
      { action: "updated", name: "c", kept: "icon" },
      { action: "updated", name: "d", kept: ["x", 3, ""] }
    ]),
    [
      { action: "updated", name: "a", kept: ["interfacePattern", "icon"] },
      { action: "updated", name: "b", kept: [] },
      { action: "updated", name: "c", kept: [] },
      { action: "updated", name: "d", kept: ["x"] }
    ]
  );
});

test("keptText and keptFields phrase what climg kept", () => {
  assert.equal(keptText(["interfacePattern"]), "kept your interfacePattern");
  assert.equal(keptText(["a", "b"]), "kept your a, b");
  assert.equal(keptText([]), undefined);
  assert.deepEqual(keptFields(undefined), []);
});

test("keptMissingImage picks the edited templates skipped for a missing image", () => {
  const skipped = [
    { name: "a", reason: "edited by user; image missing" },
    { name: "b", reason: "other reason" },
    null,
    { reason: "edited by user; image missing" }
  ];
  assert.deepEqual(keptMissingImage(skipped), ["a"]);
});

test("sortRecords puts not buildable entries after buildable ones, keeping each group's order", () => {
  const rows = [record({ key: "a", status: "unbuildable" }), record({ key: "b" }), record({ key: "c", status: "unbuildable" }), record({ key: "d", status: "built" })];
  assert.deepEqual(sortRecords(rows).map((row) => row.key), ["b", "d", "a", "c"]);
  assert.equal(isUnbuildable(rows[0] as ImageRecord), true);
});

test("vendorOptions prefers the index vendors, then the vendors of the results, then the kinds", () => {
  const index = { vendors: [{ vendor: "H3C", entries: 2, buildable: 0 }, { vendor: "Cisco", entries: 5, buildable: 5 }] };
  assert.deepEqual(vendorOptions(index, ["Nokia"], ["arista_veos"]), ["Cisco", "H3C"]);
  assert.deepEqual(vendorOptions({}, ["Nokia", "Cisco"], ["arista_veos"]), ["Cisco", "Nokia"]);
  assert.deepEqual(vendorOptions(undefined, [], ["arista_veos", "arista_ceos", "cisco_iol"]), ["arista", "cisco"]);
});

test("sortJobs: running first, then the queue by place, then ended jobs newest first", () => {
  const job = (id: string, state: "running" | "queued" | "succeeded", startedAt: string, queuePosition?: number) => ({
    id, state, startedAt, ...(queuePosition !== undefined ? { queuePosition } : {})
  });
  const sorted = sortJobs([
    job("old", "succeeded", "2024-01-01T08:00:00Z"),
    job("q2", "queued", "2024-01-01T10:05:00Z", 2),
    job("new", "succeeded", "2024-01-01T09:00:00Z"),
    job("run", "running", "2024-01-01T10:00:00Z"),
    job("q1", "queued", "2024-01-01T10:09:00Z", 1)
  ]);
  assert.deepEqual(sorted.map((entry) => entry.id), ["run", "q1", "q2", "new", "old"]);
});

test("queueText says Next for the head of the queue and N in line behind it", () => {
  assert.equal(queueText({ state: "queued", queuePosition: 1 }), "Queued · Next");
  assert.equal(queueText({ state: "queued", queuePosition: 3 }), "Queued · 3 in line");
  assert.equal(queueText({ state: "queued" }), undefined);
  assert.equal(queueText({ state: "running", queuePosition: 1 }), undefined);
});
