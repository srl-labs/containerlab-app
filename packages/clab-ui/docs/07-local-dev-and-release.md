# 7. Local Dev and Release

This page is the practical workflow for iterating across the sibling repos without guessing which artifact a consumer is actually using.

## Fastest loop when changing `clab-ui`

1. Build `clab-ui`.
2. Start the consumer in its local-ui mode.
3. Rebuild `clab-ui` every time you change the shared package.

### Step 1: build the shared package

```bash
cd /home/flschwar/projects/clab/clab-ui
npm install
npm run build
```

### Step 2A: run `containerlab-app` against the local package

```bash
cd /home/flschwar/projects/clab/containerlab-app
npm install
npm run dev:web:local
```

`dev:local` already enables local-ui mode and fails early if `../clab-ui/dist` is missing.

### Step 2B: build or package `vscode-containerlab` against the local package

```bash
cd /home/flschwar/projects/clab/vscode-containerlab
npm install
npm run build:local-ui
npm run package:local-ui
```

These scripts also set local-ui mode for you.

## When to rebuild `clab-ui`

Rebuild whenever you change anything that affects published output, including:

- React UI components
- host contracts or runtime helpers
- session or message types
- feature entrypoints
- shared styles

If a consumer still shows old behavior after a rebuild, restart that consumer too.

## Published-package flow

Use the published package flow when you want to test the same artifact other repos will consume from GitHub Packages.

1. Bump the version in `clab-ui/package.json`.
2. Commit and push.
3. Create a matching tag `vX.Y.Z`.
4. Push the tag.
5. Let `.github/workflows/publish-package.yml` publish the package.
6. Bump dependencies in `containerlab-app` and `vscode-containerlab`.

## Environment variables you are likely to touch

| Variable | Used in | Purpose |
|---|---|---|
| `CLAB_UI_SOURCE=local` | local consumer builds | switch imports from published package to sibling `../clab-ui/dist` |
| `CLAB_API_URL` | `containerlab-app` server | default API endpoint offered by the browser host |
| `GITHUB_TOKEN` | local npm install flows | GitHub Packages authentication |
| `NODE_AUTH_TOKEN` | publish workflow | package publish authentication |
| `JWT_SECRET` | `clab-api-server` | secure JWT signing |

## Recommended order when debugging integration regressions

1. Confirm `clab-ui/dist` was rebuilt.
2. Confirm the consumer is actually using local-ui mode when you expect it to.
3. Confirm the host-specific bridge still matches the package contract.
4. Only then investigate deeper auth, ownership, or runtime problems.

## Sanity commands per repo

```bash
cd /home/flschwar/projects/clab/clab-ui && npm run build && npm run lint && npm run test:unit
cd /home/flschwar/projects/clab/containerlab-app && npm run build && npm run test:unit
cd /home/flschwar/projects/clab/vscode-containerlab && npm run lint && npm test
cd /home/flschwar/projects/clab/clab-api-server && task && task test
```
