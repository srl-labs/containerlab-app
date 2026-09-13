import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceConfig, readJson } from "./workspace-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "clab-ui-consumer-"));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const run = (command, args, cwd = temporary) =>
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

try {
  // The root command builds first; pack exactly those artifacts without rebuilding.
  const tarball = path.join(temporary, "clab-ui.tgz");
  run(pnpm, ["--filter", "@srl-labs/clab-ui", "--config.ignore-scripts=true", "pack", "--out", tarball], root);
  const dependencies = { "@srl-labs/clab-ui": "file:./clab-ui.tgz" };
  for (const name of [
    "react",
    "react-dom",
    "typescript",
    "@types/react",
    "@types/react-dom",
  ]) {
    dependencies[name] = workspaceConfig.catalog[name];
  }
  fs.writeFileSync(
    path.join(temporary, "package.json"),
    JSON.stringify({ private: true, type: "module", packageManager: readJson("package.json").packageManager, dependencies }),
  );
  run(pnpm, ["install", "--ignore-scripts", "--no-frozen-lockfile"]);
  const packageRoot = path.join(temporary, "node_modules/@srl-labs/clab-ui");
  assert.ok(!fs.realpathSync(packageRoot).startsWith(root + path.sep), "consumer must not resolve to workspace source");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const spec of Object.values(manifest[field] ?? {})) {
      assert.ok(!spec.startsWith("catalog:") && !spec.startsWith("workspace:"), "packed manifest must contain portable version specifiers");
    }
  }
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    for (const artifact of typeof target === "string"
      ? [target]
      : Object.values(target)) {
      assert.ok(
        fs.globSync(artifact, { cwd: packageRoot }).length > 0,
        `${subpath}: missing ${artifact}`,
      );
    }
  }
  fs.copyFileSync(
    path.join(root, "scripts/fixtures/clab-ui-consumer.ts"),
    path.join(temporary, "consumer.ts"),
  );
  fs.writeFileSync(
    path.join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2024",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        lib: ["ES2024", "DOM", "DOM.Iterable"],
        jsx: "react-jsx",
      },
      include: ["consumer.ts"],
    }),
  );
  run(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "-p",
    "tsconfig.json",
  ]);
  run(process.execPath, ["consumer.ts"]);
  console.log(
    "Packed clab-ui artifact, YAML/catalog types, and runtime checks passed.",
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
