import { readJson } from "./workspace-config.mjs";
import { releaseTargets } from "./release-targets.mjs";

const target = process.argv[2] ?? "clab-ui";
if (!["clab-ui", "clab-viewer"].includes(target)) throw new Error(`Not an npm release target: ${target}`);
const { name, version, publishConfig, private: isPrivate } = readJson(releaseTargets[target]);
if (isPrivate || name !== `@containerlab/${target}` || publishConfig.registry !== "https://registry.npmjs.org") {
  throw new Error(`Only the public @containerlab/${target} package may be published by this target.`);
}
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
  signal: AbortSignal.timeout(30_000),
});
if (response.ok) throw new Error(`${name}@${version} is already published. Bump the package version; npm versions are immutable.`);
if (response.status !== 404) throw new Error(`Cannot check npm version: HTTP ${response.status}.`);
console.log(`${name}@${version} is available to publish.`);
