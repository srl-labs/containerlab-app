# Publishing @containerlab/clab-ui

This package lives at `packages/clab-ui` in the `containerlab-app` pnpm workspace. Only this library is published to npmjs.org; applications and internal libraries remain private npm packages.

1. Complete the one-time npm bootstrap and configure Trusted Publishing as described in [RELEASING.md](../../RELEASING.md).
2. Update `packages/clab-ui/package.json` to a new, unpublished version.
3. Run `pnpm test:package` from the monorepo root.
4. Merge the reviewed changes.
5. Publish a GitHub Release tagged `clab-ui-v<version>` at that commit. Leave **Set as the latest release** unchecked.

The `publish-clab-ui.yml` workflow validates the version, builds and packs the UI, tests that exact tarball with npm consumers, and publishes through GitHub OIDC with automatic provenance. No `NPM_TOKEN` secret or token 2FA bypass is needed. Stable versions use npm's `latest` tag. Prerelease versions, such as `0.4.0-beta.1`, require GitHub's prerelease checkbox and use npm's `next` tag.

A manual **Run workflow** only validates and uploads the tarball. Pushing a tag alone does not publish any product. Existing `@srl-labs/clab-ui` versions on GitHub Packages remain separate; consumers must update their dependency and imports to the npm name.
