import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const cssSource = path.join(__dirname, "src/styles/global.css");
const cssOutput = path.join(distDir, "styles/global.css");
const monacoAssetsSource = path.join(__dirname, "src/monaco/assets.json");
const monacoAssetsOutput = path.join(distDir, "monaco-assets.json");
const packageJsonPath = path.join(__dirname, "package.json");
const tscBin = require.resolve("typescript/bin/tsc");
const copiedCssAssets = [
  {
    from: path.join(__dirname, "src/theme/appTheme.css"),
    to: [path.join(distDir, "chunks/appTheme.css")]
  },
  {
    from: path.join(__dirname, "src/components/canvas/nodes/FreeTextNode.css"),
    to: [
      path.join(distDir, "FreeTextNode.css"),
      path.join(distDir, "chunks/FreeTextNode.css"),
      path.join(distDir, "components/canvas/nodes/FreeTextNode.css")
    ]
  }
];

const entryPoints = {
  index: "src/index.ts",
  "host/index": "src/host/index.ts",
  "session/index": "src/session/index.ts",
  "theme/index": "src/theme/index.ts",
  "explorer/index": "src/explorer/index.ts",
  "image-manager/index": "src/image-manager/index.ts",
  "image-manager/catalog": "src/image-manager/catalog-entry.ts",
  "inspect/index": "src/inspect/index.ts",
  "welcome/index": "src/welcome/index.ts",
  "node-impairments/index": "src/node-impairments/index.ts",
  "wireshark-vnc/index": "src/wireshark-vnc/index.ts",
  "viewer/index": "src/viewer/index.ts",
  "monaco/core": "src/monaco/core.ts",
  "monaco/editor-worker": "src/monaco/editor-worker.ts",
  "monaco/json-worker": "src/monaco/json-worker.ts",
  "monaco/yaml-worker": "src/monaco/yaml-worker.ts"
};

const cssExternalPlugin = {
  name: "css-external",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.css$/ }, (args) => ({
      path: args.path,
      external: true
    }));
  }
};

function expandExternalPackage(packageName) {
  return [packageName, `${packageName}/*`];
}

async function loadExternalPackages() {
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  return [
    ...new Set(
      [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]
        .flatMap((packageName) => expandExternalPackage(packageName))
    )
  ];
}

async function prepareDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(path.join(distDir, "styles"), { recursive: true });
}

async function buildJavaScript() {
  const external = await loadExternalPackages();

  await build({
    absWorkingDir: __dirname,
    entryPoints,
    outdir: distDir,
    bundle: true,
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    format: "esm",
    platform: "neutral",
    target: ["es2022"],
    jsx: "automatic",
    sourcemap: false,
    logLevel: "info",
    external,
    plugins: [cssExternalPlugin],
    loader: {
      ".gif": "dataurl",
      ".jpg": "dataurl",
      ".json": "json",
      ".png": "dataurl",
      ".svg": "dataurl"
    }
  });
}

async function copyCss() {
  await fs.copyFile(cssSource, cssOutput);
  await Promise.all(
    copiedCssAssets.flatMap((asset) =>
      asset.to.map(async (target) => {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(asset.from, target);
      })
    )
  );
}

async function copyMonacoAssetsManifest() {
  await fs.copyFile(monacoAssetsSource, monacoAssetsOutput);
}

function buildTypes() {
  execFileSync(process.execPath, [tscBin, "-p", "tsconfig.build.json"], {
    cwd: __dirname,
    stdio: "inherit"
  });
}

await prepareDist();
await Promise.all([buildJavaScript(), copyCss(), copyMonacoAssetsManifest()]);
buildTypes();
