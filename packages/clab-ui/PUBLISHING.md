# Publishing `@srl-labs/clab-ui`

`clab-ui` is a single-package repository. The repo root is the publishable
`@srl-labs/clab-ui` package.

## Publish

1. Update the version in `package.json`.
2. Commit and push.
3. Create tag `v<version>` matching `package.json`.
4. Push the tag.

The `publish-package.yml` workflow publishes `@srl-labs/clab-ui` to GitHub
Packages.

Supported public surface:

- `@srl-labs/clab-ui`
- `@srl-labs/clab-ui/host`
- `@srl-labs/clab-ui/session`
- `@srl-labs/clab-ui/theme`
- `@srl-labs/clab-ui/explorer`
- `@srl-labs/clab-ui/inspect`
- `@srl-labs/clab-ui/welcome`
- `@srl-labs/clab-ui/node-impairments`
- `@srl-labs/clab-ui/wireshark-vnc`
- `@srl-labs/clab-ui/styles/global.css`

## Local publish

```bash
cd /home/flschwar/projects/clab/clab-ui
npm install
npm run typecheck
npm run publish:ui
```

## Local consumer workflow

Build the package first when another sibling repo wants to consume the local
checkout:

```bash
cd /home/flschwar/projects/clab/clab-ui
npm install
npm run build
```
