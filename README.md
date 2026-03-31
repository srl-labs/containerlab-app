# containerlab-web

Standalone browser runtime for containerlab built on `@srl-labs/clab-ui`.

This repo owns:

- the Vite frontend host
- the Fastify backend proxy
- the standalone unit and Playwright E2E suites
- the static assets and schema copy needed by the standalone app

`@srl-labs/clab-ui` remains the shared package consumed by both this repo and
`vscode-containerlab`.

## Requirements

- Node.js `>= 24`
- npm
- Playwright Chromium for E2E runs

Install dependencies:

```bash
npm install
```

The published `@srl-labs/clab-ui` dependency is pulled from GitHub Packages, so
set `GITHUB_TOKEN` before installing.

Install Playwright once for E2E:

```bash
npx playwright install chromium
```

## Common Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the standalone frontend and backend |
| `npm run build` | Build frontend and backend production artifacts |
| `npm run typecheck` | Typecheck app, server, and E2E TypeScript |
| `npm run test:unit` | Run standalone unit tests |
| `npm run test:e2e` | Run the Playwright suite |
| `npm run start` | Start the built backend |

By default this repo depends on the published `@srl-labs/clab-ui` package.
