import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { errorStatus } from "../contract/errors.ts";
import { LocalLabBackend } from "./index.ts";
import { topologyGitInfo } from "./topologyTemplates.ts";

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lab-backend-templates-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function initRepository(directory: string, branch: string): void {
  const run = (...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], {
      stdio: "ignore",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }
    });
  run("init", "-q", "-b", branch);
  run("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
}

/**
 * A `containerlab` stand-in that records its arguments, writes `rendered` to
 * the `--export-rendered` path, prints `output` and exits with `exitCode`.
 */
async function fakeRenderer(
  directory: string,
  options: { rendered?: string; output?: string; exitCode?: number }
): Promise<string> {
  const script = path.join(directory, "containerlab");
  const write = options.rendered === undefined
    ? ""
    : `while [ $# -gt 0 ]; do if [ "$1" = "--export-rendered" ]; then cat > "$2" <<'YAML'\n${options.rendered}\nYAML\nfi; shift; done\n`;
  await fs.writeFile(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${directory}/args"\npwd > "${directory}/cwd"\n${write}cat <<'OUT' >&2\n${options.output ?? ""}\nOUT\nexit ${options.exitCode ?? 0}\n`,
    { mode: 0o755 }
  );
  return script;
}

test("templates are listed, with a literal name or the file name", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.mkdir(path.join(root, "labs"));
  await fs.writeFile(path.join(root, "labs", "fabric.clab.gotmpl"), "name: {{ .name }}\ntopology: {}\n");
  await fs.writeFile(
    path.join(root, "labs", "dc.clab.gotmpl"),
    "name: dc\ntopology:\n  nodes:\n{{- range .nodes }}\n    {{ . }}: {}\n{{- end }}\n"
  );
  await fs.writeFile(path.join(root, "flat.clab.gotmpl"), "name: other\n");

  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: "/nonexistent/containerlab" });
  const entries = await backend.listTopologies();
  assert.deepEqual(
    entries.map((entry) => [entry.labName, entry.yamlFileName]),
    [
      ["dc", "labs/dc.clab.gotmpl"],
      ["fabric", "labs/fabric.clab.gotmpl"],
      ["flat", "flat.clab.gotmpl"]
    ]
  );
});

test("Git tokens in lab names expand like containerlab expands them", async (t) => {
  const root = await temporaryDirectory(t);
  const repository = path.join(root, "repo");
  await fs.mkdir(repository);
  initRepository(repository, "feat/x");
  await fs.writeFile(path.join(repository, "a.clab.yml"), "name: dc-__gitBranch__\n");
  await fs.writeFile(path.join(repository, "b.clab.yml"), "name: b-__gitHash__\n");
  await fs.mkdir(path.join(root, "plain"));
  await fs.writeFile(path.join(root, "plain", "c.clab.yml"), "name: c-__gitBranch__\n");
  await fs.writeFile(path.join(root, "plain", "d.clab.yml"), "name: d\n");

  const info = await topologyGitInfo(repository);
  assert.equal(info.branch, "feat/x");
  assert.match(info.hash, /^[0-9a-f]{7}$/);
  // Only a repository rooted in the topology's directory counts.
  assert.deepEqual(await topologyGitInfo(path.join(root, "plain")), { branch: "none", hash: "none" });

  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: "/nonexistent/containerlab" });
  const names = (await backend.listTopologies()).map((entry) => entry.labName);
  assert.deepEqual(names, [`b-${info.hash}`, "c-none", "d", "dc-feat-x"]);

  const variables = await backend.topologyVariables(
    { labName: "", path: "repo/a.clab.yml" },
    { labName: "dc-__gitBranch__", envNames: ["CLAB_TEST_IMAGE", "CLAB_TEST_MISSING"] }
  );
  assert.equal(variables.labName, "dc-feat-x");
  assert.equal(variables.topologyDir, repository);
});

test("variables come from the environment containerlab runs with", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(path.join(root, "lab.clab.yml"), "name: lab\n");
  const env = { ...process.env, CLAB_TEST_IMAGE: "srl:25" };
  const request = { labName: "lab", envNames: ["CLAB_TEST_IMAGE", "CLAB_TEST_MISSING"] };

  const direct = new LocalLabBackend({ workspaceRoot: root, env });
  assert.deepEqual(await direct.topologyVariables({ labName: "lab", path: "lab.clab.yml" }, request), {
    labName: "lab",
    topologyDir: root,
    env: { CLAB_TEST_IMAGE: "srl:25" }
  });
  // sudo resets the environment, so only defaults are known.
  const sudo = new LocalLabBackend({ workspaceRoot: root, env, sudo: true });
  const variables = await sudo.topologyVariables({ labName: "lab", path: "lab.clab.yml" }, request);
  assert.equal(variables.env, undefined);
});

test("rendering runs a dry-run deploy that exports the rendered topology", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.mkdir(path.join(root, "dc"));
  await fs.writeFile(path.join(root, "dc", "dc.clab.gotmpl"), "name: {{ .name }}\n");
  await fs.writeFile(path.join(root, "dc", "dc.clab_vars.yml"), "name: dc1\n");
  await fs.writeFile(path.join(root, "dc", "dc.clab_vars.txt"), "ignored\n");
  const binary = await fakeRenderer(root, { rendered: "name: dc1\ntopology: {}" });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary, runtime: "podman" });

  const rendered = await backend.renderTopology({ labName: "dc", path: "dc/dc.clab.gotmpl" });
  assert.deepEqual(rendered, {
    content: "name: dc1\ntopology: {}\n",
    labName: "dc1",
    varsFiles: ["dc.clab_vars.yml"]
  });
  const args = (await fs.readFile(path.join(root, "args"), "utf8")).trim().split("\n");
  assert.deepEqual(args.slice(0, 4), ["deploy", "--dry-run", "-r", "podman"]);
  assert.equal(args[4], "--export-rendered");
  assert.deepEqual(args.slice(6), ["-t", path.join(root, "dc", "dc.clab.gotmpl")]);
  assert.equal((await fs.readFile(path.join(root, "cwd"), "utf8")).trim(), path.join(root, "dc"));

  const withVars = await backend.renderTopology(
    { labName: "dc", path: "dc/dc.clab.gotmpl" },
    { varsFile: "prod.yml" }
  );
  assert.deepEqual(withVars.varsFiles, ["prod.yml"]);
  assert.deepEqual(
    (await fs.readFile(path.join(root, "args"), "utf8")).trim().split("\n").slice(-2),
    ["--vars", "prod.yml"]
  );
});

test("a rendered topology containerlab rejects comes with its error", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(path.join(root, "lab.clab.gotmpl"), "name: lab\n");
  const binary = await fakeRenderer(root, {
    rendered: "name: lab\nbogus: 1",
    output: "21:00:00 ERRO field bogus not found",
    exitCode: 1
  });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });
  const rendered = await backend.renderTopology({ labName: "lab", path: "lab.clab.gotmpl" });
  assert.equal(rendered.content, "name: lab\nbogus: 1\n");
  assert.equal(rendered.error, "field bogus not found");
});

test("template errors and old containerlab versions are reported, never deployed", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(path.join(root, "lab.clab.gotmpl"), "name: {{ .missing.x }}\n");

  const broken = new LocalLabBackend({
    workspaceRoot: root,
    binaryPath: await fakeRenderer(root, {
      output: "21:00:00 ERRO failed to execute template: nil pointer",
      exitCode: 1
    })
  });
  const templateError = await broken.renderTopology({ labName: "lab", path: "lab.clab.gotmpl" }).catch((e: unknown) => e);
  assert.equal(errorStatus(templateError), 422);
  assert.match(String(templateError), /failed to execute template/);

  const old = new LocalLabBackend({
    workspaceRoot: root,
    binaryPath: await fakeRenderer(root, { output: "Error: unknown flag: --dry-run", exitCode: 1 })
  });
  const unsupported = await old.renderTopology({ labName: "lab", path: "lab.clab.gotmpl" }).catch((e: unknown) => e);
  assert.equal(errorStatus(unsupported), 501);
});
