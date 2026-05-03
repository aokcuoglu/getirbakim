FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat ca-certificates && update-ca-certificates
WORKDIR /app

COPY package.json package-lock.json ./

# Supplier CA certificates (for servers with incomplete chains)
COPY src/suppliers/certs/ /app/certs/

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM base AS runner
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]