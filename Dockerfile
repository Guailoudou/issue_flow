# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable \
  && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS web-build

COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared

RUN pnpm --filter @issueflow/web build

FROM dependencies AS api

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssl \
  && rm -rf /var/lib/apt/lists/*

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY docker/api-entrypoint.sh /usr/local/bin/issueflow-api-entrypoint

RUN pnpm --filter @issueflow/api exec prisma generate \
  && date -u +%Y-%m-%dT%H:%M:%SZ > /app/apps/api/.build-id \
  && chmod +x /usr/local/bin/issueflow-api-entrypoint

EXPOSE 13101

ENTRYPOINT ["issueflow-api-entrypoint"]

FROM nginx:1.27-alpine AS web

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 18080
