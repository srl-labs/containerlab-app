import { spawnSync } from "node:child_process";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const siteUrl = new URL(process.env.PREVIEW_SITE_URL ?? "http://127.0.0.1:8011/");
if (!/^https?:$/.test(siteUrl.protocol) || siteUrl.pathname !== "/" || siteUrl.search || siteUrl.hash || siteUrl.username || siteUrl.password) {
  throw new Error("PREVIEW_SITE_URL must be an HTTP(S) origin ending in /");
}

function run(args, env = {}) {
  const result = spawnSync("pnpm", args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed (${result.status ?? result.signal})`);
}

run(["pages"], { VITE_PUBLIC_BASE_PATH: "/sandbox/" });

// Keep the config beside zensical.toml so all source paths resolve identically.
// The published GitHub Pages configuration remains unchanged.
const configPath = path.join(root, `.zensical-preview-${process.pid}.toml`);
const config = await readFile(path.join(root, "zensical.toml"), "utf8");
if (!/^site_url = .+$/m.test(config)) throw new Error("Missing documentation site_url");
try {
  await writeFile(configPath, config.replace(/^site_url = .+$/m, `site_url = ${JSON.stringify(siteUrl.href)}`));
  run(["docs:build", "--config-file", configPath]);
} finally {
  await rm(configPath, { force: true });
}

const site = path.join(root, "site");
// Existing docs link to the published sandbox. In previews, open the sandbox
// built from this same commit, including links on nested documentation pages.
for (const file of await readdir(site, { recursive: true })) {
  if (!file.endsWith(".html")) continue;
  const filename = path.join(site, file);
  const html = await readFile(filename, "utf8");
  const updated = html.replaceAll('href="https://srl-labs.github.io/containerlab-app/"', 'href="/sandbox/"');
  if (updated !== html) await writeFile(filename, updated);
}
await cp(path.join(root, "apps/web/dist/client"), path.join(site, "sandbox"), { recursive: true });
