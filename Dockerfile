# syntax=docker/dockerfile:1.7

# The build emits portable JavaScript and static assets for both runtime architectures.
FROM --platform=$BUILDPLATFORM node:26.8-alpine AS deps

WORKDIR /app

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable
COPY scripts/check-package-manager.mjs scripts/check-package-manager.mjs
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/vscode-containerlab/package.json apps/vscode-containerlab/package.json
COPY packages/app-contract/package.json packages/app-contract/package.json
COPY packages/app-server/package.json packages/app-server/package.json
COPY packages/clab-ui/package.json packages/clab-ui/package.json
COPY packages/standalone-runtime/package.json packages/standalone-runtime/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store

FROM deps AS build

COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/app-contract ./packages/app-contract
COPY packages/app-server ./packages/app-server
COPY packages/clab-ui ./packages/clab-ui
COPY packages/standalone-runtime ./packages/standalone-runtime

RUN pnpm web

FROM node:26.8-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; const tls = !['0','false','no','off'].includes(String(process.env.WEB_TLS_ENABLE || 'true').toLowerCase()); fetch((tls ? 'https' : 'http') + '://[::1]:' + (process.env.PORT || '3001') + '/api/config').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "apps/web/dist/server/index.cjs"]
