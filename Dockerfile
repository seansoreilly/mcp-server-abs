# syntax=docker/dockerfile:1

# ---- build stage -----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# `prepare` runs `npm run build`, which needs the sources; skip it here and
# build explicitly once they are in place.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies so the runtime stage can copy node_modules as-is.
RUN npm prune --omit=dev --ignore-scripts

# ---- runtime stage ---------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# `src/config.ts` defaults the cache next to the build output and
# `src/utils/logger.ts` creates its log dir at import time; /app is read-only
# for the unprivileged `node` user, so point both at a writable volume.
ENV ABS_CACHE_FILE=/data/dataflows.json \
    ABS_LOG_DIR=/data/logs

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./

RUN mkdir -p /data/logs && chown -R node:node /data
VOLUME ["/data"]

USER node

# stdio transport: stdin/stdout carry JSON-RPC, so there is nothing to EXPOSE
# and no HTTP endpoint to health-check. Run with `docker run -i --rm`.
ENTRYPOINT ["node", "build/index.js"]
