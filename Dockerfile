# Stage 1: Install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY prisma/schema.prisma prisma/schema.prisma
COPY prisma.config.ts prisma.config.ts

ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

RUN bun install --frozen-lockfile
RUN bunx prisma generate

# Stage 2: Build the application (Node.js for native SWC/N-API compatibility)
FROM node:22 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars must be available at build time
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_MEILI_HOST
ARG NEXT_PUBLIC_MEILI_SEARCH_KEY
ARG NEXT_PUBLIC_ENABLE_COOKIEYES
ARG NEXT_PUBLIC_COOKIEYES_CLIENT_ID
ARG NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS
ARG NEXT_PUBLIC_BUILD_VERSION

# Sentry
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT

ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_MEILI_HOST=$NEXT_PUBLIC_MEILI_HOST
ENV NEXT_PUBLIC_MEILI_SEARCH_KEY=$NEXT_PUBLIC_MEILI_SEARCH_KEY
ENV NEXT_PUBLIC_ENABLE_COOKIEYES=$NEXT_PUBLIC_ENABLE_COOKIEYES
ENV NEXT_PUBLIC_COOKIEYES_CLIENT_ID=$NEXT_PUBLIC_COOKIEYES_CLIENT_ID
ENV NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS=$NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS
ENV NEXT_PUBLIC_BUILD_VERSION=$NEXT_PUBLIC_BUILD_VERSION

ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT

ENV NEXT_TELEMETRY_DISABLED=1

# Dummy DATABASE_URL for build-time page data collection (not used for actual queries)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

RUN npx next build

# Stage 3: Production runner
FROM node:22-slim AS runner
WORKDIR /app

# CA bundle + curl for container healthcheck (compose hits /api/health)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN chmod +x /usr/local/bin/bun
RUN npm install --os=linux --cpu=x64 sharp
ENV NEXT_SHARP_PATH=/app/node_modules/sharp

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN chown -R nextjs:nodejs /app/node_modules/@prisma || true

# Meilisearch operational scripts need source files and dependencies
COPY --from=builder /app/tsconfig.json /app/tsconfig.json
COPY --from=builder /app/scripts/ /app/scripts/
COPY --from=builder /app/lib/search/code-normalization.ts /app/lib/search/code-normalization.ts
COPY --from=builder /app/lib/search/search-document-types.ts /app/lib/search/search-document-types.ts
COPY --from=builder /app/lib/search/search-synonyms.ts /app/lib/search/search-synonyms.ts
COPY --from=builder /app/lib/search/availability.ts /app/lib/search/availability.ts
COPY --from=builder /app/lib/pricing/public-pricing.ts /app/lib/pricing/public-pricing.ts
COPY --from=builder /app/lib/pricing/calculate-selling-price.ts /app/lib/pricing/calculate-selling-price.ts
COPY --from=builder /app/lib/db.ts /app/lib/db.ts
COPY --from=builder /app/lib/matching/code-normalization.ts /app/lib/matching/code-normalization.ts
COPY --from=builder /app/prisma/schema.prisma /app/prisma/schema.prisma
COPY --from=builder /app/package.json /app/package.json

# Prisma client library for reindex scripts
COPY --from=builder /app/node_modules/.prisma/ /app/node_modules/.prisma/
COPY --from=builder /app/node_modules/@prisma/client/ /app/node_modules/@prisma/client/
COPY --from=builder /app/node_modules/@prisma/client-runtime-utils/ /app/node_modules/@prisma/client-runtime-utils/
COPY --from=builder /app/node_modules/@prisma/adapter-pg/ /app/node_modules/@prisma/adapter-pg/
COPY --from=builder /app/node_modules/@prisma/driver-adapter-utils/ /app/node_modules/@prisma/driver-adapter-utils/
COPY --from=builder /app/node_modules/@prisma/debug/ /app/node_modules/@prisma/debug/
COPY --from=builder /app/node_modules/meilisearch/ /app/node_modules/meilisearch/
COPY --from=builder /app/node_modules/dotenv/ /app/node_modules/dotenv/
COPY --from=builder /app/node_modules/pg/ /app/node_modules/pg/
COPY --from=builder /app/node_modules/postgres/ /app/node_modules/postgres/
COPY --from=builder /app/node_modules/undici/ /app/node_modules/undici/

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
