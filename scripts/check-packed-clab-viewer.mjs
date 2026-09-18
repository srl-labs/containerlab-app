import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { workspaceConfig, readJson } from "./workspace-config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "clab-viewer-consumer-"));
const run = (command, args, cwd = temporary) => execFileSync(command, args, {
  cwd, stdio: "inherit", shell: process.platform === "win32"
});
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const yaml = "name: external\ntopology:\n  defaults:\n    kind: linux\n    image: alpine:3.23\n  nodes:\n    client: {}\n    server: {}\n  links:\n    - endpoints: [client:eth1, server:eth1]\n";
const annotatedYaml = fs.readFileSync(path.join(root, "docs/examples/packet-walk.clab.yml"), "utf8");
const annotations = fs.readFileSync(path.join(root, "docs/examples/packet-walk.clab.yml.annotations.json"), "utf8");
let browser;
let server;

try {
  const tarball = path.join(temporary, "clab-viewer.tgz");
  if (process.argv[2]) fs.copyFileSync(path.resolve(process.argv[2]), tarball);
  else run(pnpm, ["--filter", "@containerlab/clab-viewer", "pack", "--out", tarball], root);
  fs.writeFileSync(path.join(temporary, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: { "@containerlab/clab-viewer": "file:./clab-viewer.tgz" },
    devDependencies: { typescript: workspaceConfig.catalog.typescript }
  }));
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"]);
  const packageRoot = path.join(temporary, "node_modules/@containerlab/clab-viewer");
  assert.ok(!fs.realpathSync(packageRoot).startsWith(root + path.sep), "consumer must use the tarball, not workspace source");
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "@containerlab/clab-viewer");
  assert.equal(manifest.version, readJson("packages/clab-viewer/package.json").version);
  assert.equal(manifest.private, false);
  assert.equal(manifest.publishConfig.registry, "https://registry.npmjs.org");
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    assert.deepEqual(Object.keys(manifest[field] ?? {}), [], `viewer must have no ${field}`);
  }
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const spec of Object.values(manifest[field] ?? {})) {
      assert.ok(!spec.startsWith("catalog:") && !spec.startsWith("workspace:"), "published versions must be portable");
    }
  }
  for (const target of Object.values(manifest.exports)) {
    for (const file of typeof target === "string" ? [target] : Object.values(target)) {
      assert.ok(fs.globSync(file, { cwd: packageRoot }).length, `missing export ${file}`);
    }
  }
  for (const dependency of ["@containerlab/clab-ui", "react", "react-dom", "monaco-editor", "maplibre-gl"]) {
    assert.ok(!fs.existsSync(path.join(temporary, "node_modules", dependency)), `unexpected installed dependency: ${dependency}`);
  }

  const require = createRequire(path.join(temporary, "package.json"));
  const staticRoot = path.dirname(require.resolve("@containerlab/clab-viewer/static/viewer.html"));
  for (const asset of ["viewer.html", "component.mjs", "component.css", "styles.css", "index.js", "index.d.ts", "types.d.ts"]) {
    assert.ok(fs.existsSync(path.join(staticRoot, asset)), `missing viewer asset ${asset}`);
  }
  fs.writeFileSync(path.join(temporary, "consumer.ts"), `
    import { mountViewer, type MountViewerOptions, type ViewerHandle, type ViewerNodeInfo, type ViewerOptions } from "@containerlab/clab-viewer";
    import "@containerlab/clab-viewer/styles.css";
    const options: ViewerOptions = { background: "lines", onNodeSelect: id => { document.body.dataset.selected = id ?? ""; } };
    const input: MountViewerOptions = {
      yaml: ${JSON.stringify(yaml)}, theme: "light", viewerOptions: options,
      onReady: ({ nodes, links }) => {
        const node: ViewerNodeInfo = nodes[0];
        document.body.dataset.ready = String(nodes.length);
        document.body.dataset.links = String(links);
        document.body.dataset.first = node.id;
      }
    };
    const container = document.getElementById("viewer")!;
    let viewer: ViewerHandle = mountViewer(container, input);
    document.getElementById("dispose")!.onclick = () => viewer.unmount();
    document.getElementById("remount")!.onclick = () => { viewer = mountViewer(container, input); };
    document.getElementById("annotations")!.onclick = () => {
      viewer.unmount();
      viewer = mountViewer(container, { ...input, yaml: ${JSON.stringify(annotatedYaml)}, annotations: ${JSON.stringify(annotations)} });
    };
  `);
  fs.writeFileSync(path.join(temporary, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2024", module: "ESNext", moduleResolution: "bundler",
      strict: true, skipLibCheck: false, types: [], noEmit: true,
      lib: ["ES2024", "DOM", "DOM.Iterable"]
    },
    include: ["consumer.ts"]
  }));
  const typescript = require("typescript/package.json");
  run(process.execPath, [path.resolve(path.dirname(require.resolve("typescript/package.json")), typescript.bin.tsc), "-p", "tsconfig.json"]);
  await build({
    absWorkingDir: temporary, entryPoints: ["consumer.ts"], bundle: true,
    platform: "browser", format: "esm", splitting: true, outdir: "public/app",
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "file", ".png": "file" }
  });
  const publicRoot = path.join(temporary, "public");
  fs.cpSync(staticRoot, path.join(publicRoot, "nested/viewer"), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, "index.html"), `<!doctype html><html><head>
    <link rel="stylesheet" href="/app/consumer.css"><style>#viewer { height: 500px; }</style>
    </head><body><button id="dispose">Dispose</button><button id="remount">Remount</button><button id="annotations">Annotations</button><div id="viewer"></div>
    <script type="module" src="/app/consumer.js"></script></body></html>`);
  fs.writeFileSync(path.join(publicRoot, "nested/index.html"), `<!doctype html><html><head>
    <link rel="stylesheet" href="./viewer/component.css"><script type="module" src="./viewer/component.mjs"></script>
    </head><body>
    <clab-topology id="first" title="First" view="split" theme="light" loading="eager"><pre>${yaml}</pre></clab-topology>
    <clab-topology id="second" title="Second" theme="dark" loading="eager"><pre>${yaml.replaceAll("client", "other")}</pre></clab-topology>
    </body></html>`);
  const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
      let filename = path.resolve(publicRoot, `.${pathname}`);
      if (filename !== publicRoot && !filename.startsWith(publicRoot + path.sep)) { response.writeHead(403).end(); return; }
      if (fs.statSync(filename).isDirectory()) filename = path.join(filename, "index.html");
      response.setHeader("Content-Type", mime[path.extname(filename)] ?? "application/octet-stream");
      response.end(fs.readFileSync(filename));
    } catch { response.writeHead(404).end(); }
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(url);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "2");
  await expect(page.locator("body")).toHaveAttribute("data-links", "1");
  await expect(page.locator(".react-flow__node-topology-node")).toHaveCount(2);
  await page.locator('.react-flow__node[data-id="client"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-selected", "client");
  await page.getByRole("button", { name: "Dispose", exact: true }).click();
  await expect(page.locator("#viewer")).toBeEmpty();
  await page.getByRole("button", { name: "Remount", exact: true }).click();
  await expect(page.locator(".react-flow__node-topology-node")).toHaveCount(2);

  // Exercise lazy renderer chunks after an external bundler relocates the package.
  await page.getByRole("button", { name: "Annotations", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "3");
  await expect(page.locator(".react-flow__node-group-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__node-free-shape-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__node-free-text-node")).toHaveCount(8);
  await expect(page.getByText("Follow one packet.", { exact: true })).toBeVisible();

  await page.goto(`${url}/nested/`);
  for (const id of ["first", "second"]) {
    await expect(page.locator(`#${id}`)).toHaveAttribute("data-loaded", "true");
    await expect(page.frameLocator(`#${id} iframe`).locator(".react-flow__node-topology-node")).toHaveCount(2);
  }
  await expect(page.frameLocator("#first iframe").locator("html")).toHaveAttribute("data-clab-theme", "light");
  await expect(page.frameLocator("#second iframe").locator("html")).toHaveAttribute("data-clab-theme", "dark");
  await page.frameLocator("#first iframe").locator('.react-flow__node[data-id="client"]').click();
  await expect(page.locator("#first select")).toHaveValue("client");
  await expect(page.locator("#second select")).toHaveValue("");
  await page.evaluate(() => document.getElementById("first").remove());
  await expect(page.frameLocator("#second iframe").locator(".react-flow__node-topology-node")).toHaveCount(2);
  assert.deepEqual(failures, []);
  console.log("Packed clab-viewer: dependency-free npm install, portable types, bundled API, lifecycle, and isolated HTML embeds passed.");
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  fs.rmSync(temporary, { recursive: true, force: true });
}
