# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json .npmrc ./

RUN --mount=type=secret,id=github_token,required=true \
  GITHUB_TOKEN="$(cat /run/secrets/github_token)" npm ci

FROM deps AS build

COPY . .

RUN npm run build
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; const tls = !['0','false','no','off'].includes(String(process.env.WEB_TLS_ENABLE || 'true').toLowerCase()); fetch((tls ? 'https' : 'http') + '://127.0.0.1:' + (process.env.PORT || '3000') + '/api/config').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "dist/server/index.cjs"]
