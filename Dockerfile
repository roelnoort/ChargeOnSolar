# syntax=docker/dockerfile:1

# ChargeOnSolar: one Node 24 process that serves the API and the built web app.
# Node runs the server's TypeScript directly, so the runtime image holds the
# server and shared sources, their production dependencies and the web build.

FROM node:24-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# better-sqlite3 downloads a prebuilt binary when one exists for this Node
# version, and compiles from source otherwise.
FROM base AS toolchain
RUN apt-get update \
  && apt-get install --yes --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/

# Install scripts are skipped (the root `prepare` sets up git hooks) and only
# the native modules are built.
FROM toolchain AS build
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild better-sqlite3 esbuild
COPY tsconfig.base.json ./
COPY packages packages
RUN pnpm --filter @charge-on-solar/web run build

FROM toolchain AS prod-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@charge-on-solar/server..." \
  && pnpm rebuild better-sqlite3

FROM base AS runtime
ENV NODE_ENV=production \
  DATA_DIR=/data \
  PORT=3000
RUN mkdir /data && chown node:node /data
COPY package.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=prod-deps /app/packages/server/node_modules packages/server/node_modules
COPY --from=build /app/packages/web/dist packages/web/dist
USER node
EXPOSE 3000
CMD ["node", "packages/server/src/main.ts"]
