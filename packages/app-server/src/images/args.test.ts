import assert from "node:assert/strict";
import test from "node:test";

import { RequestError } from "../runtimeProxy.ts";
import { commandLine, jobArgs, nodetplArgs, searchArgs, showArgs } from "./args.ts";
import { IMAGES_CONFIG_KEYS, parseByteSize, resolveImagesConfig } from "./config.ts";
import { climgEnvironment } from "./runner.ts";
import { validateImageFileName, validateRef, validateTag } from "./validate.ts";

const BAD_REFS = ["--force", "-x", "--tag=x", "vios; rm -rf /", "a b", "$(id)", "`id`", "a|b", "", "../x", "labhub:", "x\nforce", "-", "a/b/c/../d"];

test("references that look like options or shell syntax are rejected", () => {
  for (const ref of BAD_REFS) {
    assert.throws(() => validateRef(ref), RequestError, JSON.stringify(ref));
  }
  for (const ref of ["labhub:vios-1", "local:vios.qcow2", "#363", "vrnetlab/cisco_vios:159-3.M3", "vios", "labhub:#12"]) {
    assert.equal(validateRef(ref), ref);
  }
  assert.throws(() => validateRef(undefined), RequestError);
  assert.throws(() => validateRef(["a"]), RequestError);
  assert.throws(() => validateRef("a".repeat(256)), RequestError);
});

test("tags follow the docker reference grammar and never start with a dash", () => {
  assert.equal(validateTag("vrnetlab/x:1.2"), "vrnetlab/x:1.2");
  for (const tag of ["--force", "-x", "x y", "X/UPPER", "a;b", "a:"]) assert.throws(() => validateTag(tag), RequestError);
});

test("every command line is options, then --, then positionals", () => {
  assert.deepEqual(commandLine("show", ["--json"], ["labhub:x"]), ["show", "--json", "--", "labhub:x"]);
  assert.deepEqual(commandLine("scan", ["--json"]), ["scan", "--json"]);
  assert.deepEqual(showArgs("labhub:x"), ["show", "--json", "--", "labhub:x"]);
  assert.deepEqual(nodetplArgs("/ws/ui/custom-nodes.json", "add", "labhub:x"), [
    "nodetpl", "--json", "--writer", "file", "--nodetpl-file", "/ws/ui/custom-nodes.json", "--", "add", "labhub:x"
  ]);
  assert.deepEqual(nodetplArgs("/p", "sync", undefined, true), [
    "nodetpl", "--json", "--writer", "file", "--nodetpl-file", "/p", "--dry-run", "--", "sync"
  ]);
  assert.deepEqual(
    jobArgs({ op: "pull", ref: "labhub:x", jobFile: "/s/jobs/1.json", force: true }),
    ["pull", "--yes", "--json", "--job-file", "/s/jobs/1.json", "--no-nodetpl", "--force", "--", "labhub:x"]
  );
  assert.deepEqual(
    jobArgs({ op: "build", filePath: "/images/a.qcow2", kind: "cisco_vios", version: "1.2", tag: "t:1", jobFile: "/j" }),
    ["build", "--yes", "--json", "--job-file", "/j", "--no-nodetpl", "--kind", "cisco_vios", "--version", "1.2", "--tag", "t:1", "--", "/images/a.qcow2"]
  );
  assert.deepEqual(searchArgs({ q: "vios 159", source: "labhub", status: "built" }), [
    "search", "--json", "--source", "labhub", "--status", "built", "--", "vios", "159"
  ]);
});

test("option-looking values are refused for every builder", () => {
  assert.throws(() => showArgs("--force"), RequestError);
  assert.throws(() => searchArgs({ q: "--all" }), RequestError);
  assert.throws(() => searchArgs({ q: "ok", kind: "-x" }), RequestError);
  assert.throws(() => searchArgs({ source: "x" as "all" }), RequestError);
  assert.throws(() => nodetplArgs("/p", "add", "-x"), RequestError);
  assert.throws(() => nodetplArgs("/p", "remove", "--force"), RequestError);
  assert.throws(() => jobArgs({ op: "pull", ref: "x", tag: "--tag=x", jobFile: "/j" }), RequestError);
  assert.throws(() => jobArgs({ op: "add", filePath: "/i/a.qcow2", version: "-1", jobFile: "/j" }), RequestError);
  assert.throws(() => jobArgs({ op: "add", filePath: "/i/a.qcow2", kind: "x; id", jobFile: "/j" }), RequestError);
});

test("file names with path parts, traversal, wrong extensions or odd characters are refused", () => {
  for (const name of ["../a.qcow2", "a/b.qcow2", "..", "a..b.qcow2", ".hidden.qcow2", "-x.qcow2", "a b.qcow2", "a\\b.qcow2", "a.txt", "a.qcow2.sh", "", "%2e%2e%2fa.qcow2", "a\u0000.qcow2", "x".repeat(260) + ".qcow2"]) {
    assert.throws(() => validateImageFileName(name), RequestError, JSON.stringify(name));
  }
  for (const name of ["a.qcow2", "vios-1.2.vmdk", "x.tar.gz", "x.TGZ", "i86bi.bin", "a.iol"]) {
    assert.equal(validateImageFileName(name), name);
  }
});

test("configuration: byte sizes, run-as user and the disabled state", () => {
  assert.equal(parseByteSize("20G"), 20 * 1024 ** 3);
  assert.equal(parseByteSize("512MiB"), 512 * 1024 ** 2);
  assert.equal(parseByteSize("1048576"), 1048576);
  assert.equal(parseByteSize("x"), undefined);
  assert.equal(parseByteSize("0"), undefined);

  assert.equal(resolveImagesConfig({}, "WEB_LOCAL_", 1000).config, undefined);
  assert.deepEqual(resolveImagesConfig({}, "WEB_LOCAL_", 1000).problems, []);
  const ok = resolveImagesConfig({ WEB_LOCAL_CLIMG_PATH: "/opt/climg", WEB_LOCAL_CLIMG_USER: "1000:999", WEB_LOCAL_IMAGES_UPLOAD_MAX: "1G" }, "WEB_LOCAL_", 0);
  assert.deepEqual(ok.config?.runAs, { uid: 1000, gid: 999 });
  assert.equal(ok.config?.uploadMaxBytes, 1024 ** 3);
  assert.equal(ok.config?.maxJobs, 4);
  assert.equal(ok.config?.maxRunning, 1);
  assert.equal(ok.config?.maxQueued, 20);
  assert.equal(resolveImagesConfig({ WEB_LOCAL_CLIMG_PATH: "/opt/climg" }, "WEB_LOCAL_", 1000).config?.runAs, undefined);
  assert.equal(resolveImagesConfig({ WEB_LOCAL_CLIMG_PATH: "/opt/climg" }, "WEB_LOCAL_", 0).config, undefined, "root needs a run-as user");
  assert.equal(resolveImagesConfig({ WEB_LOCAL_CLIMG_PATH: "/opt/climg", WEB_LOCAL_CLIMG_USER: "0:0" }, "WEB_LOCAL_", 0).config, undefined);
  assert.equal(resolveImagesConfig({ WEB_LOCAL_CLIMG_PATH: "climg" }, "WEB_LOCAL_", 1000).config, undefined, "relative path");
  assert.equal(resolveImagesConfig({ WEB_LOCAL_CLIMG_PATH: "/opt/climg", WEB_LOCAL_CLIMG_USER: "bds" }, "WEB_LOCAL_", 1000).config, undefined);
  assert.equal(resolveImagesConfig({ WEB_LOCAL_CLIMG_PATH: "/opt/climg", WEB_LOCAL_IMAGES_UPLOAD_MAX: "lots" }, "WEB_LOCAL_", 1000).config?.uploadMaxBytes, 20 * 1024 ** 3);
});

test("WEB_LOCAL_CLIMG_HOME is parsed, and a relative path is refused", () => {
  const base = { WEB_LOCAL_CLIMG_PATH: "/opt/climg", WEB_LOCAL_CLIMG_USER: "1000:1000" };
  assert.equal(resolveImagesConfig({ ...base, WEB_LOCAL_CLIMG_HOME: "/home/climg" }, "WEB_LOCAL_", 0).config?.home, "/home/climg");
  assert.equal(resolveImagesConfig(base, "WEB_LOCAL_", 0).config?.home, undefined);
  const refused = resolveImagesConfig({ ...base, WEB_LOCAL_CLIMG_HOME: "home/climg" }, "WEB_LOCAL_", 0);
  assert.equal(refused.config, undefined);
  assert.match(refused.problems[0], /WEB_LOCAL_CLIMG_HOME must be an absolute path/);
});

test("the configured HOME wins over the passwd home of the run-as user", () => {
  const config = { climgPath: "/opt/climg", runAs: { uid: process.getuid?.() ?? 1000, gid: 1000 }, uploadMaxBytes: 1, maxJobs: 1, maxRunning: 1, maxQueued: 0 };
  const fromPasswd = climgEnvironment(config, { PATH: "/bin", HOME: "/server/home" }).HOME;
  assert.notEqual(fromPasswd, "/home/configured");
  assert.equal(climgEnvironment({ ...config, home: "/home/configured" }, { PATH: "/bin", HOME: "/server/home" }).HOME, "/home/configured");
});

test("WEB_LOCAL_IMAGES_MAX_RUNNING and _MAX_QUEUED are parsed, and a bad value keeps the default with a problem", () => {
  const base = { WEB_LOCAL_CLIMG_PATH: "/opt/climg", WEB_LOCAL_CLIMG_USER: "1000:1000" };
  const set = resolveImagesConfig({ ...base, WEB_LOCAL_IMAGES_MAX_RUNNING: "2", WEB_LOCAL_IMAGES_MAX_QUEUED: "0" }, "WEB_LOCAL_", 0);
  assert.equal(set.config?.maxRunning, 2);
  assert.equal(set.config?.maxQueued, 0);
  assert.deepEqual(set.problems, []);
  const bad = resolveImagesConfig({ ...base, WEB_LOCAL_IMAGES_MAX_RUNNING: "0", WEB_LOCAL_IMAGES_MAX_QUEUED: "many" }, "WEB_LOCAL_", 0);
  assert.equal(bad.config?.maxRunning, 1);
  assert.equal(bad.config?.maxQueued, 20);
  assert.equal(bad.problems.length, 2);
  assert.ok(IMAGES_CONFIG_KEYS.includes("WEB_LOCAL_IMAGES_MAX_RUNNING") && IMAGES_CONFIG_KEYS.includes("WEB_LOCAL_IMAGES_MAX_QUEUED"));
});

test("search passes --all and --vendor through, before the keywords", () => {
  assert.deepEqual(searchArgs({ q: "h3c vsr", vendor: "H3C", all: true }), ["search", "--json", "--vendor", "H3C", "--all", "--", "h3c", "vsr"]);
  assert.deepEqual(searchArgs({ vendor: "Palo Alto" }), ["search", "--json", "--vendor", "Palo Alto"]);
  assert.throws(() => searchArgs({ vendor: "-x" }), RequestError);
  assert.ok(!searchArgs({ q: "vios" }).includes("--all"));
});
