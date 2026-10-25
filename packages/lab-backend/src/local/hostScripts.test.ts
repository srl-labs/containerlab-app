import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { LabBackendError } from "../contract/errors.ts";
import { runLocalHostScript } from "./hostScripts.ts";
import { resolveLocalOptions } from "./options.ts";

async function labFolder(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lab-backend-scripts-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("an inline script runs in the topology folder and knows its lab", async (t) => {
  const folder = await labFolder(t);
  const topology = path.join(folder, "demo.clab.yml");
  const result = await runLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo", topology },
    { script: 'echo "$CLAB_LAB_NAME $CLAB_TOPOLOGY $PWD"; echo oops >&2; exit 3' }
  );
  assert.equal(result.stdout.trim(), `demo ${topology} ${folder}`);
  assert.equal(result.stderr.trim(), "oops");
  assert.equal(result.exitCode, 3);
  assert.equal(result.timedOut, false);
});

test("a relative script path starts at the topology folder", async (t) => {
  const folder = await labFolder(t);
  await fs.mkdir(path.join(folder, "scripts"));
  await fs.writeFile(path.join(folder, "scripts", "hello.sh"), "echo hello from $(basename $PWD)\n");
  const result = await runLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo", topology: path.join(folder, "demo.clab.yml") },
    { scriptPath: "scripts/hello.sh" }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), `hello from ${path.basename(folder)}`);
});

test("a missing script file is reported before anything runs", async (t) => {
  const folder = await labFolder(t);
  await assert.rejects(
    runLocalHostScript(
      resolveLocalOptions({ workspaceRoot: folder }),
      { labName: "demo", topology: path.join(folder, "demo.clab.yml") },
      { scriptPath: "missing.sh" }
    ),
    (error: unknown) => error instanceof LabBackendError && error.status === 404
  );
});

test("a script that runs past its timeout is stopped", async (t) => {
  const folder = await labFolder(t);
  const result = await runLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo", topology: path.join(folder, "demo.clab.yml") },
    { script: "sleep 5", timeoutSeconds: 0.3 }
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
});

test("hosts that turn script buttons off refuse to run them", async (t) => {
  const folder = await labFolder(t);
  await assert.rejects(
    runLocalHostScript(
      resolveLocalOptions({ workspaceRoot: folder, hostScripts: false }),
      { labName: "demo" },
      { script: "echo hi" }
    ),
    (error: unknown) => error instanceof LabBackendError && error.status === 403
  );
});
