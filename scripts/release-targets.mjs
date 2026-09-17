export const releaseTargets = {
  "clab-ui": "packages/clab-ui/package.json",
  vscode: "apps/vscode-containerlab/package.json",
  web: "apps/web/package.json",
  desktop: "apps/desktop/package.json",
};

export function resolveRelease(tag, readManifest, expectedTarget, prereleaseFlag) {
  const target = Object.keys(releaseTargets).find((name) => tag.startsWith(`${name}-v`));
  if (!target) throw new Error(`Unknown release tag ${tag}. Use ${Object.keys(releaseTargets).map((name) => `${name}-v<version>`).join(", ")}.`);
  if (expectedTarget && target !== expectedTarget) {
    throw new Error(`Tag ${tag} selects ${target}, not ${expectedTarget}.`);
  }
  const manifest = readManifest(releaseTargets[target]);
  const version = tag.slice(target.length + 2);
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!semver || semver[4]?.split(".").some((part) => /^0\d+$/.test(part))) {
    throw new Error(`Invalid release version ${version}.`);
  }
  if (version !== manifest.version) {
    throw new Error(`Tag ${tag} does not match ${releaseTargets[target]} version ${manifest.version}.`);
  }
  const hasSuffix = Boolean(semver[4]);
  if (target === "vscode" && hasSuffix) {
    throw new Error("VS Code versions must be numeric X.Y.Z; use a GitHub prerelease and the Marketplace prerelease channel.");
  }
  if (prereleaseFlag !== undefined && target !== "vscode" && (prereleaseFlag === "true") !== hasSuffix) {
    throw new Error("The GitHub prerelease setting must match the version's prerelease suffix.");
  }
  const prerelease = hasSuffix || prereleaseFlag === "true";
  return { target, name: manifest.name, version, prerelease, channel: prerelease ? "next" : "latest" };
}
