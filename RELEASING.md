# Releasing Containerlab products

Publish one GitHub Release for the product you want to ship. The tag selects the product; its version must match that product's `package.json`. Creating or pushing a tag alone does not publish. The release workflows must already exist on the default branch before the first release.

| Product | Manifest | Prepared version/tag | Result |
| --- | --- | --- | --- |
| Shared UI | `packages/clab-ui/package.json` | `0.3.2` for the first manual publish; later `clab-ui-v<version>` | `@containerlab/clab-ui` on npmjs.org |
| VS Code extension | `apps/vscode-containerlab/package.json` | `vscode-v0.26.4` | VSIX, Marketplace, Open VSX |
| Web app | `apps/web/package.json` | `web-v0.2.3` | `ghcr.io/srl-labs/containerlab-web:0.2.3` |
| Desktop app | `apps/desktop/package.json` | `desktop-v0.2.3` | Linux, macOS, Windows installers |

Only `@containerlab/clab-ui` is a public npm package. Internal libraries and application manifests stay private. Their versions do not have to match the root or each other. Applications bundle their workspace UI from the release commit; a UI-only npm release does not update installed applications.

## npm Trusted Publishing (no npm secret)

The UI workflow uses GitHub OIDC with npm Trusted Publishing. Do **not** create `NPM_TOKEN` or enable a token's Bypass 2FA setting for this workflow. Your npm account can keep 2FA enabled. npm creates short-lived credentials for the authorized workflow and automatically adds provenance; see [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

In the npm settings for `@containerlab/clab-ui`, add a **GitHub Actions** trusted publisher with these exact values:

| Setting | Value |
| --- | --- |
| Organization or user | `srl-labs` |
| Repository | `containerlab-app` |
| Workflow filename | `publish-clab-ui.yml` |
| Environment name | Leave empty; this job does not use a GitHub environment |
| Allowed actions | Enable direct **`npm publish`** |

The GitHub workflow already grants `id-token: write` and runs on a GitHub-hosted runner. It requires npm >=11.5.1; the pinned Node 24 release supplies a compatible npm CLI. No account token is passed to the job.

### First-ever publication

The new package is not yet on npm. Trusted publisher settings belong to an existing package, so bootstrap it once with your interactive npm login and 2FA. From a reviewed checkout, when ready to publish:

```sh
pnpm ui:pack
node scripts/check-packed-clab-ui.mjs artifacts/clab-ui.tgz
npm login --registry=https://registry.npmjs.org
npm publish ./artifacts/clab-ui.tgz --access public
```

This publishes the actual built package (currently 0.3.2), not a placeholder. Then configure the trusted publisher above. The next automated release must use a new manifest version, for example **0.3.3** with tag **`clab-ui-v0.3.3`**. Publishing the bootstrap version again will fail the immutable-version check. All later npm releases can run through GitHub Releases without an npm token. The first-publication limitation is also tracked in [npm's documentation issue](https://github.com/npm/documentation/issues/1926).

### GitHub secrets for other products

Create repository secrets in [Settings → Secrets and variables → Actions](https://github.com/srl-labs/containerlab-app/settings/secrets/actions) for extension store publication:

| Secret | Needed for | Value |
| --- | --- | --- |
| `VSCE_PAT` | VS Code Marketplace | Azure DevOps token with Marketplace **Manage** permission for the existing `srl-labs` publisher. |
| `OVSX_PAT` | Open VSX | Access token authorized for the existing `srl-labs` namespace. |

Missing store tokens skip their respective stores; the workflow still produces a downloadable VSIX. Keep the extension identity `srl-labs.vscode-containerlab`.

`GITHUB_TOKEN` is supplied automatically by GitHub for GHCR pushes and release assets. If the GHCR package does not already grant this repository Actions write access, grant it in the package settings. Unsigned desktop installers and GitHub Pages need no additional secrets. Existing PR Cloudflare previews separately use `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and repository variable `CLOUDFLARE_PAGES_PROJECT_NAME`.

## GitHub Latest and registry tags

Keep the existing `v0.2.2` release and its tag. It can remain **Latest** until the next stable desktop release is ready. Mark that release (for example `desktop-v0.2.3`) as Latest; do not move or rename old Git tags. This keeps the repository's `/releases/latest` link pointing to desktop downloads.

| Channel | What updates it |
| --- | --- |
| GitHub **Latest** release | Stable desktop release only |
| npm `@containerlab/clab-ui@latest` | Stable UI release only |
| GHCR `containerlab-web:latest` | Stable web release only |
| npm/GHCR `next` | The corresponding product's prerelease |

These are independent. UI, VS Code, and web GitHub Releases should have **Set as the latest release** unchecked (`gh release create ... --latest=false`). For a stable desktop release, check it (`--latest`). Prereleases never become GitHub Latest. See [GitHub release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

## Prepare and publish

1. Change the selected product's manifest version and release notes. Use a version that has not been published to that product's distribution channel. Keep `pnpm-lock.yaml` current with `pnpm install --lockfile-only` after dependency changes.
2. Run `pnpm typecheck`, `pnpm test`, and the product checks below. Merge the reviewed changes first.
3. In GitHub, choose **Releases → Draft a new release**, create the product tag at the reviewed commit, and enter product-specific release notes. Alternatively, use `gh release create <tag> --target <commit> --title '<product> <version>' --notes-file <notes.md> --latest=false`.
4. Publish the release. The matching workflow builds and publishes only that product. Use **Set as the latest release** only for stable desktop releases; other product releases should leave it unchecked. GitHub's Latest designation is shared by the whole repository.

Examples: after bootstrapping and bumping the UI to 0.3.3, publishing `clab-ui-v0.3.3` ships only the UI to npm; publishing `vscode-v0.26.4` ships only the extension. The former generic `v<version>` application tags are historical and no longer release new builds.

| Product | Useful checks |
| --- | --- |
| UI | `pnpm test:package` and `pnpm test:ui` |
| Extension | `pnpm vsix` and `pnpm test:vscode` |
| Web | `pnpm web` and `pnpm test:web` |
| Desktop | `pnpm desktop --linux`, `pnpm desktop --mac dmg --universal`, or `pnpm desktop --win nsis --x64` on the appropriate platform |

The npm workflow checks the target/version and registry, verifies the version is unpublished, runs UI checks, packs once, installs and validates that exact tarball outside the workspace, and publishes it through OIDC with automatic provenance. **Run workflow** on “Publish clab-ui to npm” validates and uploads an artifact without publishing; it is suitable for testing this setup before the first release. To retry a failed publication, rerun the original workflow. If npm already accepted the version, a new publish is refused; it cannot be overwritten.

Product release workflows start from `release: published`. Main branch development builds are separate. Automation that creates releases using `GITHUB_TOKEN` does not automatically trigger these workflows; use a deliberate workflow invocation or an appropriately authorized GitHub App if automating release creation later.

## Prereleases and development builds

For UI, web, and desktop, use a version such as `0.4.0-beta.1` in both the manifest and tag, and select GitHub's **pre-release** checkbox. The checker rejects a mismatch. UI prereleases use npm's `next` dist-tag. Web prereleases receive their full version tag and `next`; only stable web releases update `latest`. Main branch web images use `main` and a commit SHA, so unreleased changes do not replace `latest`.

VS Code requires numeric `X.Y.Z` manifest versions. For an extension prerelease, choose a fresh numeric version and check GitHub's prerelease box; the VSIX is marked `--pre-release` for Marketplace/Open VSX. Do not reuse that version for the later stable release.

Main/manual desktop runs build downloadable Actions artifacts without attaching them to a release. Desktop installers are currently unsigned; signing/notarization are separate from this migration.

## Repository cutover

- This package is named `@containerlab/clab-ui`, matching the npm account. `@srl-labs/clab-ui` on GitHub Packages is a different package. External consumers must update their dependency and imports; public npm installation requires no GitHub token or custom registry mapping.
- Existing published GitHub Packages versions should remain available. After the new workflows are active, disable the old repositories' publishing/schema workflows and link their READMEs to this monorepo. Keep their Git history accessible.
- Marketplace/Open VSX secrets must be available in this repository, even if they were configured in the old extension repository.
