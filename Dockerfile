# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/app-contract/package.json packages/app-contract/package.json
COPY packages/app-server/package.json packages/app-server/package.json
COPY packages/standalone-runtime/package.json packages/standalone-runtime/package.json

RUN --mount=type=secret,id=github_token,required=true \
  GITHUB_TOKEN="$(cat /run/secrets/github_token)" \
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
  npm ci

FROM deps AS build

COPY . .

RUN npm run build:web
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

RUN apk add --no-cache openssl \
  && mkdir -p /home/node/.config/containerlab-web/tls \
  && mkdir -p /home/node/.local/state/containerlab-web \
  && chown -R node:node /home/node/.config /home/node/.local

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const tls = !['0','false','no','off'].includes(String(process.env.WEB_TLS_ENABLE || 'true').toLowerCase()); const client = require(tls ? 'node:https' : 'node:http'); const request = client.get({ hostname: '127.0.0.1', port: process.env.PORT || '3001', path: '/api/health/live', rejectUnauthorized: false }, (response) => { response.resume(); if (response.statusCode !== 200) process.exitCode = 1; }); request.on('error', () => { process.exitCode = 1; });"

CMD ["node", "apps/web/dist/server/index.cjs"]
