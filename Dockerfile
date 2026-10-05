FROM node:22-bookworm-slim AS dependencies
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
USER node
CMD ["node", "--import", "tsx", "scripts/setup.ts"]

FROM node:22-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
