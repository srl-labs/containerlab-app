const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const reactTopoViewerEntry = path.join(__dirname, "src/webviews/reactTopoViewer/entry.tsx");
const explorerWebviewEntry = path.join(__dirname, "src/webviews/explorer/entry.tsx");
const inspectWebviewEntry = path.join(__dirname, "src/webviews/inspect/entry.tsx");
const imageManagerWebviewEntry = path.join(__dirname, "src/webviews/imageManager/entry.tsx");
const welcomeWebviewEntry = path.join(__dirname, "src/webviews/welcome/entry.tsx");
const nodeImpairmentsWebviewEntry = path.join(__dirname, "src/webviews/nodeImpairments/entry.tsx");
const wiresharkVncWebviewEntry = path.join(__dirname, "src/webviews/wiresharkVnc/entry.tsx");
const clabUiGlobalCss = require.resolve("@containerlab/clab-ui/styles/global.css");

function findPackageRootFromEntry(entryPath) {
  let current = path.dirname(entryPath);
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Unable to find package root for entry: ${entryPath}`);
    }
    current = parent;
  }
}

const clabUiPackageRoot = findPackageRootFromEntry(clabUiGlobalCss);

const fallbackMonacoAssets = {
  workers: {
    "monaco-editor-worker": {
      package: "monaco-editor",
      path: "esm/vs/editor/editor.worker.js"
    },
    "monaco-json-worker": {
      package: "monaco-editor",
      path: "esm/vs/language/json/json.worker.js"
    },
    "monaco-yaml-worker": {
      package: "monaco-yaml",
      path: "yaml.worker.js"
    }
  },
  codiconFont: {
    package: "monaco-editor",
    candidates: [
      "min/vs/base/browser/ui/codicons/codicon/codicon.ttf",
      "esm/vs/base/browser/ui/codicons/codicon/codicon.ttf",
      "dev/vs/base/browser/ui/codicons/codicon/codicon.ttf"
    ]
  }
};

function loadClabUiMonacoAssets() {
  try {
    const manifestPath = require.resolve("@containerlab/clab-ui/monaco-assets.json");
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return fallbackMonacoAssets;
  }
}

function resolveClabUiDependencyAsset(packageName, relativePath) {
  return require.resolve(`${packageName}/${relativePath}`, { paths: [clabUiPackageRoot] });
}

const monacoAssets = loadClabUiMonacoAssets();
const monacoWorkerEntries = Object.fromEntries(
  Object.entries(monacoAssets.workers).map(([name, asset]) => [
    name,
    resolveClabUiDependencyAsset(asset.package, asset.path)
  ])
);
const monacoCodiconFontPath =
  monacoAssets.codiconFont.candidates
    .map((candidate) => {
      try {
        return resolveClabUiDependencyAsset(monacoAssets.codiconFont.package, candidate);
      } catch {
        return null;
      }
    })
    .find((candidate) => candidate !== null) ?? null;

const reactSingletonAliasPlugin = {
  name: "react-singleton-alias",
  setup(build) {
    const aliasTargets = new Map([
      ["react", require.resolve("react")],
      ["react/jsx-runtime", require.resolve("react/jsx-runtime")],
      ["react/jsx-dev-runtime", require.resolve("react/jsx-dev-runtime")],
      ["react-dom", require.resolve("react-dom")],
      ["react-dom/client", require.resolve("react-dom/client")]
    ]);

    build.onResolve(
      { filter: /^(react|react\/jsx-runtime|react\/jsx-dev-runtime|react-dom|react-dom\/client)$/ },
      (args) => {
        const resolved = aliasTargets.get(args.path);
        return resolved ? { path: resolved } : null;
      }
    );
  }
};

const browserAssetLoaders = {
  ".svg": "dataurl",
  ".png": "dataurl",
  ".jpg": "dataurl",
  ".gif": "dataurl",
  ".woff": "dataurl",
  ".woff2": "dataurl",
  ".ttf": "dataurl",
  ".eot": "dataurl"
};

// Plugin to stub native .node files - ssh2 has JS fallbacks
const nativeNodeModulesPlugin = {
  name: "native-node-modules",
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, () => ({
      path: "noop",
      namespace: "native-node-empty"
    }));
    build.onLoad({ filter: /.*/, namespace: "native-node-empty" }, () => ({
      contents: "module.exports = {};"
    }));
  }
};

// Plugin to ignore CSS imports (we handle CSS separately with PostCSS)
const ignoreCssPlugin = {
  name: "ignore-css",
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, () => ({
      path: "css-stub",
      namespace: "css-stub"
    }));
    build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({
      contents: "",
      loader: "js"
    }));
  }
};

// Copy font files to dist
async function copyFonts() {
  const fontDir = path.join(__dirname, "dist/webfonts");
  await fs.promises.mkdir(fontDir, { recursive: true });

  // Monaco codicon font (used by Monaco UI widgets)
  if (monacoCodiconFontPath) {
    await fs.promises.copyFile(monacoCodiconFontPath, path.join(fontDir, "codicon.ttf"));
  }
}

// Bundle the MapLibre module worker and its shared chunk for webview CSP compatibility.
async function copyMapLibreWorker() {
  const srcPath = require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs", { paths: [clabUiPackageRoot] });
  const destPath = path.join(__dirname, "dist/maplibre-gl-csp-worker.js");
  await esbuild.build({
    entryPoints: [srcPath],
    outfile: destPath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022"
  });
}

// Build CSS with PostCSS
async function buildCss() {
  console.log("Building CSS with PostCSS...");
  execSync(
    `pnpm exec postcss "${clabUiGlobalCss}" --config "${path.join(__dirname, "postcss.config.js")}" -o dist/reactTopoViewerStyles.css`,
    {
      stdio: "inherit"
    }
  );

  // Fix font paths - rewrite node_modules paths to webfonts/
  const cssPath = path.join(__dirname, "dist/reactTopoViewerStyles.css");
  let css = await fs.promises.readFile(cssPath, "utf8");

  // Handle maplibre-gl font references if any
  css = css.replace(
    /url\([^)]*node_modules\/maplibre-gl\/[^)]*\/([^/)]+\.(woff2?|ttf|eot))\)/g,
    "url(webfonts/$1)"
  );

  // Monaco codicon font reference (relative to editor.main.css)
  css = css.replace(
    /url\((\"|')?\.\.\/base\/browser\/ui\/codicons\/codicon\/codicon\.ttf(\")?\)/g,
    "url(webfonts/codicon.ttf)"
  );

  await fs.promises.writeFile(cssPath, css);
}

async function build() {
  const isWatch = process.argv.includes("--watch");
  const isDev = process.argv.includes("--dev");

  // Ensure dist directory exists
  await fs.promises.mkdir(path.join(__dirname, "dist"), { recursive: true });

  // Common options
  const commonOptions = {
    bundle: true,
    minify: !isDev,
    treeShaking: true,
    sourcemap: isDev ? "inline" : false,
    logLevel: "info"
  };

  // Build extension (Node.js)
  const extensionBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ["src/extension.ts"],
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    outfile: "dist/extension.js",
    plugins: [nativeNodeModulesPlugin, reactSingletonAliasPlugin]
  });

  // Build webview (Browser) - CSS handled separately.
  // ESM + code splitting keeps lazy imports (Monaco, MapLibre, modals) out of
  // the entry bundle so the TopoViewer boots fast; chunks load on demand.
  const webviewBuild = esbuild.build({
    ...commonOptions,
    entryPoints: { reactTopoViewerWebview: reactTopoViewerEntry },
    platform: "browser",
    format: "esm",
    splitting: true,
    target: ["es2020", "chrome90", "firefox90", "safari14.1"],
    outdir: "dist",
    chunkNames: "topoviewer-chunks/[name]-[hash]",
    plugins: [
      ignoreCssPlugin,
      reactSingletonAliasPlugin
    ],
    jsx: "automatic",
    loader: browserAssetLoaders,
    define: {
      "process.env.NODE_ENV": isDev ? '"development"' : '"production"'
    }
  });

  const explorerWebviewBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [explorerWebviewEntry],
    platform: "browser",
    format: "iife",
    target: ["es2020", "chrome90", "firefox90", "safari14.1"],
    outfile: "dist/containerlabExplorerView.js",
    plugins: [
      ignoreCssPlugin,
      reactSingletonAliasPlugin
    ],
    jsx: "automatic",
    loader: browserAssetLoaders,
    define: {
      "process.env.NODE_ENV": isDev ? '"development"' : '"production"'
    }
  });

  const welcomeWebviewBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [welcomeWebviewEntry],
    platform: "browser",
    format: "iife",
    target: ["es2020", "chrome90", "firefox90", "safari14.1"],
    outfile: "dist/welcomePageWebview.js",
    plugins: [
      ignoreCssPlugin,
      reactSingletonAliasPlugin
    ],
    jsx: "automatic",
    loader: browserAssetLoaders,
    define: {
      "process.env.NODE_ENV": isDev ? '"development"' : '"production"'
    }
  });

  const inspectWebviewBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [inspectWebviewEntry],
    platform: "browser",
    format: "iife",
    target: ["es2020", "chrome90", "firefox90", "safari14.1"],
    outfile: "dist/inspectWebview.js",
    plugins: [
      ignoreCssPlugin,
      reactSingletonAliasPlugin
    ],
    jsx: "automatic",
    loader: browserAssetLoaders,
    define: {
      "process.env.NODE_ENV": isDev ? '"development"' : '"production"'
    }
  });

  const imageManagerWebviewBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [imageManagerWebviewEntry],
    platform: "browser",
    format: "iife",
    target: ["es2020", "chrome90", "firefox90", "safari14.1"],
    outfile: "dist/imageManagerWebview.js",
    plugins: [
      ignoreCssPlugin,
      reactSingletonAliasPlugin
    ],
    jsx: "automatic",
    loader: browserAssetLoaders,
    define: {
      "process.env.NODE_ENV": isDev ? '"development"' : '"production"'
    }
  });

  const nodeImpairmentsWebviewBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [nodeImpairmentsWebviewEntry],
    platform: "browser",
    format: "iife",
    target: ["es2020", "chrome90", "firefox90", "safari14.1"],
    outfile: "dist/nodeImpairmentsWebview.js",
    plugins: [
      ignoreCssPlugin,
      reactSingletonAliasPlugin
    ],
    jsx: "automatic",
    loader: browserAssetLoaders,
    define: {
      "process.env.NODE_ENV": isDev ? '"development"' : '"production"'
    }
  });

  const wiresharkVncWebviewBuild = esbuild.build({
    ...commonOptions,
    entryPoints: [wiresharkVncWebviewEntry],
    platform: "browser",
    format: "iife",
    target: ["es2020", "chrome90", "firefox90", "safari14.1"],
    outfile: "dist/wiresharkVncWebview.js",
    plugins: [
      ignoreCssPlugin,
      reactSingletonAliasPlugin
    ],
    jsx: "automatic",
    loader: browserAssetLoaders,
    define: {
      "process.env.NODE_ENV": isDev ? '"development"' : '"production"'
    }
  });

  // Build Monaco workers for webview (separate files for CSP-friendly worker-src)
  const monacoWorkersBuild = esbuild.build({
    ...commonOptions,
    entryPoints: monacoWorkerEntries,
    platform: "browser",
    format: "iife",
    target: ["es2020", "chrome90", "firefox90", "safari14.1"],
    outdir: "dist",
    plugins: [ignoreCssPlugin]
  });

  // Run all builds in parallel
  await Promise.all([
    extensionBuild,
    webviewBuild,
    explorerWebviewBuild,
    welcomeWebviewBuild,
    inspectWebviewBuild,
    imageManagerWebviewBuild,
    nodeImpairmentsWebviewBuild,
    wiresharkVncWebviewBuild,
    monacoWorkersBuild,
    copyFonts(),
    copyMapLibreWorker(),
    buildCss()
  ]);

  console.log("Build complete!");

  // Watch mode
  if (isWatch) {
    const { watch } = await import("chokidar");

    // Watch extension and webview with esbuild
    const extCtx = await esbuild.context({
      ...commonOptions,
      entryPoints: ["src/extension.ts"],
      platform: "node",
      format: "cjs",
      external: ["vscode"],
      outfile: "dist/extension.js",
      plugins: [nativeNodeModulesPlugin, reactSingletonAliasPlugin]
    });

    const webCtx = await esbuild.context({
      ...commonOptions,
      entryPoints: { reactTopoViewerWebview: reactTopoViewerEntry },
      platform: "browser",
      format: "esm",
      splitting: true,
      target: ["es2020", "chrome90", "firefox90", "safari14.1"],
      outdir: "dist",
      chunkNames: "topoviewer-chunks/[name]-[hash]",
      plugins: [
        ignoreCssPlugin,
        reactSingletonAliasPlugin
      ],
      jsx: "automatic",
      loader: browserAssetLoaders
    });

    const explorerWebCtx = await esbuild.context({
      ...commonOptions,
      entryPoints: [explorerWebviewEntry],
      platform: "browser",
      format: "iife",
      target: ["es2020", "chrome90", "firefox90", "safari14.1"],
      outfile: "dist/containerlabExplorerView.js",
      plugins: [
        ignoreCssPlugin,
        reactSingletonAliasPlugin
      ],
      jsx: "automatic",
      loader: browserAssetLoaders
    });

    const welcomeWebCtx = await esbuild.context({
      ...commonOptions,
      entryPoints: [welcomeWebviewEntry],
      platform: "browser",
      format: "iife",
      target: ["es2020", "chrome90", "firefox90", "safari14.1"],
      outfile: "dist/welcomePageWebview.js",
      plugins: [
        ignoreCssPlugin,
        reactSingletonAliasPlugin
      ],
      jsx: "automatic",
      loader: browserAssetLoaders
    });

    const inspectWebCtx = await esbuild.context({
      ...commonOptions,
      entryPoints: [inspectWebviewEntry],
      platform: "browser",
      format: "iife",
      target: ["es2020", "chrome90", "firefox90", "safari14.1"],
      outfile: "dist/inspectWebview.js",
      plugins: [
        ignoreCssPlugin,
        reactSingletonAliasPlugin
      ],
      jsx: "automatic",
      loader: browserAssetLoaders
    });

    const imageManagerWebCtx = await esbuild.context({
      ...commonOptions,
      entryPoints: [imageManagerWebviewEntry],
      platform: "browser",
      format: "iife",
      target: ["es2020", "chrome90", "firefox90", "safari14.1"],
      outfile: "dist/imageManagerWebview.js",
      plugins: [
        ignoreCssPlugin,
        reactSingletonAliasPlugin
      ],
      jsx: "automatic",
      loader: browserAssetLoaders
    });

    const nodeImpairmentsWebCtx = await esbuild.context({
      ...commonOptions,
      entryPoints: [nodeImpairmentsWebviewEntry],
      platform: "browser",
      format: "iife",
      target: ["es2020", "chrome90", "firefox90", "safari14.1"],
      outfile: "dist/nodeImpairmentsWebview.js",
      plugins: [
        ignoreCssPlugin,
        reactSingletonAliasPlugin
      ],
      jsx: "automatic",
      loader: browserAssetLoaders
    });

    const wiresharkVncWebCtx = await esbuild.context({
      ...commonOptions,
      entryPoints: [wiresharkVncWebviewEntry],
      platform: "browser",
      format: "iife",
      target: ["es2020", "chrome90", "firefox90", "safari14.1"],
      outfile: "dist/wiresharkVncWebview.js",
      plugins: [
        ignoreCssPlugin,
        reactSingletonAliasPlugin
      ],
      jsx: "automatic",
      loader: browserAssetLoaders
    });

    const monacoWorkersCtx = await esbuild.context({
      ...commonOptions,
      entryPoints: monacoWorkerEntries,
      platform: "browser",
      format: "iife",
      target: ["es2020", "chrome90", "firefox90", "safari14.1"],
      outdir: "dist",
      plugins: [ignoreCssPlugin]
    });

    await Promise.all([
      extCtx.watch(),
      webCtx.watch(),
      explorerWebCtx.watch(),
      welcomeWebCtx.watch(),
      inspectWebCtx.watch(),
      imageManagerWebCtx.watch(),
      nodeImpairmentsWebCtx.watch(),
      wiresharkVncWebCtx.watch(),
      monacoWorkersCtx.watch()
    ]);

    // Watch CSS files and rebuild
    const cssWatchRoot = path.dirname(clabUiGlobalCss);
    const cssWatcher = watch(cssWatchRoot, {
      ignoreInitial: true,
      ignored: (filePath, stats) => stats?.isFile() && !filePath.endsWith(".css")
    });
    cssWatcher.on("change", () => {
      console.log("CSS changed, rebuilding...");
      buildCss();
    });

    console.log("Watching for changes...");
  }
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
