# Stage 1: Install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY prisma/schema.prisma prisma/schema.prisma
RUN bun install --frozen-lockfile
RUN bunx prisma generate

# Stage 2: Build the application
FROM oven/bun:1 AS builder
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

ENV NEXT_TELEMETRY_DISABLED=1

# Dummy DATABASE_URL for build-time page data collection (not used for actual queries)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

RUN bun run next build

# Stage 3: Production runner
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN npm install --os=linux --cpu=x64 sharp
ENV NEXT_SHARP_PATH=/app/node_modules/sharp

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
