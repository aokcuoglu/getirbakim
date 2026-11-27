FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY . .
ARG SITE_URL=https://getirbakim.com
ARG APP_ENV=production
ARG BUILD_VERSION=development
ENV SITE_URL=$SITE_URL APP_ENV=$APP_ENV BUILD_VERSION=$BUILD_VERSION
RUN npm run build

FROM dependencies AS operations
COPY . .
# RDS CA bundle: DATABASE_URL on AWS uses sslmode=verify-full&sslrootcert=/app/rds-global-bundle.pem (RDS enforces TLS).
# The checksum pins the bundle (AWS global-bundle.pem, 114 certificates, fetched 2026-11-12); when AWS rotates it,
# re-hash the new file (shasum -a 256) and update both ADD lines in the same change.
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-global-bundle.pem
USER node
CMD ["node", "--import", "tsx", "scripts/setup.ts"]

# Node 24: AsyncLocalStorage runs on AsyncContextFrame by default. On Node 22 (async_hooks-based ALS) every promise kept
# in an in-process cache pinned its request's context (Next/React request stores), and prod tasks hit the V8 heap cap
# every 1-4 h (#1278, #1461). Docker crawl at 2 GB / 1 vCPU: heapUsed ~350 MB median on Node 22 -> ~230 MB on Node 24.
FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
# glibc opens up to 8 malloc arenas per core and fragments native memory; two are enough for one event loop plus the
# libuv/sharp pool. Docker crawl at 2 GB / 1 vCPU on the Node 22 image (#1278): native memory at the end of 6 rounds
# ~400 MB -> ~220 MB.
ENV MALLOC_ARENA_MAX=2
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./static-build
COPY --from=builder --chown=node:node /app/public ./public
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-global-bundle.pem
RUN mkdir -p .next/static && chown node:node .next/static
USER node
EXPOSE 3000
# Hashed assets of earlier releases stay served (production mounts a volume here): a page opened just
# before a deploy still finds its CSS/JS instead of rendering unstyled. Files older than 14 days are dropped.
CMD ["sh", "-c", "cp -R static-build/. .next/static/ && find .next/static -type f -mtime +14 -delete; exec node server.js"]
