import { readJson } from "./workspace-config.mjs";

const { name, version, publishConfig, private: isPrivate } = readJson("packages/clab-ui/package.json");
if (isPrivate || name !== "@containerlab/clab-ui" || publishConfig.registry !== "https://registry.npmjs.org") {
  throw new Error("Only the public @containerlab/clab-ui package may be published to npm.");
}
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
  signal: AbortSignal.timeout(30_000),
});
if (response.ok) throw new Error(`${name}@${version} is already published. Bump the package version; npm versions are immutable.`);
if (response.status !== 404) throw new Error(`Cannot check npm version: HTTP ${response.status}.`);
console.log(`${name}@${version} is available to publish.`);
