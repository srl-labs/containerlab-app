import assert from "node:assert/strict";
import test from "node:test";
import { releaseTargets, resolveRelease } from "./release-targets.mjs";

const versions = { "clab-ui": "0.3.2", "clab-viewer": "0.1.0", vscode: "0.26.4", web: "1.2.3", desktop: "4.5.6" };
const readManifest = (file) => {
  const target = Object.keys(releaseTargets).find((name) => releaseTargets[name] === file);
  return { name: target, version: versions[target] };
};

test("each product validates its own version independently", () => {
  for (const [target, version] of Object.entries(versions)) {
    assert.equal(resolveRelease(`${target}-v${version}`, readManifest, target, "false").version, version);
  }
});

test("unknown tags, mismatched targets and stale versions fail before publishing", () => {
  assert.throws(() => resolveRelease("v0.2.2", readManifest), /Unknown release tag/);
  assert.throws(() => resolveRelease("web-v1.2.3", readManifest, "desktop"), /not desktop/);
  assert.throws(() => resolveRelease("clab-viewer-v0.1.0", readManifest, "clab-ui"), /not clab-ui/);
  assert.throws(() => resolveRelease("desktop-v1.2.3", readManifest), /does not match/);
  assert.throws(() => resolveRelease("web-v01.2.3", readManifest), /Invalid release version/);
});

test("prereleases cannot silently enter stable channels", () => {
  const readPreview = () => ({ name: "preview", version: "1.2.3-beta.1" });
  assert.equal(resolveRelease("web-v1.2.3-beta.1", readPreview, "web", "true").channel, "next");
  assert.throws(() => resolveRelease("web-v1.2.3-beta.1", readPreview, "web", "false"), /prerelease setting/);
  assert.throws(() => resolveRelease("web-v1.2.3", readManifest, "web", "true"), /prerelease setting/);
  assert.throws(() => resolveRelease("web-v1.2.3-beta.01", readPreview), /Invalid release version/);
});

test("VS Code uses numeric versions and an explicit prerelease flag", () => {
  assert.equal(resolveRelease("vscode-v0.26.4", readManifest, "vscode", "true").prerelease, true);
  assert.throws(() => resolveRelease("vscode-v1.2.3-beta.1", () => ({ version: "1.2.3-beta.1" })), /must be numeric/);
});
