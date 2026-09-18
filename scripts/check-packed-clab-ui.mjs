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
  // Validate a supplied release artifact unchanged, or build a complete package via prepack.
  const tarball = path.join(temporary, "clab-ui.tgz");
  if (process.argv[2]) {
    fs.copyFileSync(path.resolve(process.argv[2]), tarball);
  } else {
    run(pnpm, ["--filter", "@containerlab/clab-ui", "pack", "--out", tarball], root);
  }
  const dependencies = { "@containerlab/clab-ui": "file:./clab-ui.tgz" };
  for (const name of [
    "react",
    "react-dom",
    "typescript",
    "esbuild",
    "@types/react",
    "@types/react-dom",
  ]) {
    dependencies[name] = workspaceConfig.catalog[name];
  }
  fs.writeFileSync(
    path.join(temporary, "package.json"),
    JSON.stringify({ private: true, type: "module", packageManager: readJson("package.json").packageManager, dependencies }),
  );
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"]);
  const packageRoot = path.join(temporary, "node_modules/@containerlab/clab-ui");
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
  assert.equal(manifest.name, "@containerlab/clab-ui");
  assert.equal(manifest.version, readJson("packages/clab-ui/package.json").version);
  assert.equal(manifest.publishConfig.registry, "https://registry.npmjs.org");
  assert.equal(manifest.private, false);
  const publicModules = Object.entries(manifest.exports)
    .filter(([, target]) => typeof target === "object" && target.types)
    .map(([subpath]) => manifest.name + (subpath === "." ? "" : subpath.slice(1)));
  const browserFixture = publicModules.map((specifier, index) =>
    `import * as api${index} from ${JSON.stringify(specifier)};\nconsole.log(api${index});`
  ).join("\n");
  fs.writeFileSync(path.join(temporary, "browser.ts"), browserFixture);
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
        types: [],
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
  // Check each subpath on its own: one entrypoint must not hide another's
  // missing ambient declarations by making them visible to the whole program.
  for (const specifier of publicModules) {
    fs.writeFileSync(path.join(temporary, "public-api.ts"), `import * as api from ${JSON.stringify(specifier)};\nvoid api;\n`);
    const config = JSON.parse(fs.readFileSync(path.join(temporary, "tsconfig.json"), "utf8"));
    config.include = ["public-api.ts"];
    fs.writeFileSync(path.join(temporary, "tsconfig.public.json"), JSON.stringify(config));
    run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.public.json"]);
  }
  fs.writeFileSync(path.join(temporary, "bundle.mjs"), `
    import assert from "node:assert/strict";
    import { build } from "esbuild";
    await build({ entryPoints: ["browser.ts"], bundle: true, platform: "browser", format: "esm", outdir: "browser-dist",
      loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".svg": "dataurl", ".png": "dataurl" } });
    // VS Code consumes these entries without the standalone workspace, terminal or 3D logo.
    const result = await build({ stdin: { contents: 'import * as editor from "@containerlab/clab-ui"; import * as explorer from "@containerlab/clab-ui/explorer"; console.log(editor, explorer);', resolveDir: process.cwd() },
      bundle: true, platform: "browser", format: "esm", outdir: "embedded-dist", write: false, metafile: true,
      loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".svg": "dataurl", ".png": "dataurl" } });
    const unusedFeatures = Object.keys(result.metafile.inputs).filter((file) => file.includes("/@containerlab/clab-ui/dist/workspace/") || file.includes("/@xterm/") || file.includes("/three/"));
    assert.deepEqual(unusedFeatures, [], "embedded editor/explorer must not import standalone features");
  `);
  run(process.execPath, ["bundle.mjs"]);
  run(process.execPath, ["consumer.ts"]);
  run(process.execPath, ["--input-type=commonjs", "-e", `
    const assert = require("node:assert/strict");
    const { FilterUtils } = require("@containerlab/clab-ui/explorer/filter");
    assert.equal(FilterUtils.createFilter("lab*")("lab-demo"), true);
    assert.equal(FilterUtils.createFilter("lab*")("other"), false);
  `]);
  console.log(
    "Packed clab-ui: all public declarations, browser bundle, and Node runtime checks passed.",
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
