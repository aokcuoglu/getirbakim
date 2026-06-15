# Production Secret Management

This project is set up for:

- local development via `.env.local`
- a separate Vercel staging project
- a separate Vercel production project
- full secret isolation between staging and production

Do not store staging or production secrets in repo-tracked files.

## Environment model

### Local

- File-based env is allowed only in `.env.local`
- Recommended Tami endpoint: `https://sandbox-paymentapi.tami.com.tr`
- Recommended domain: `http://localhost:3000`

### Staging

- Vercel project: `zupv2-staging`
- Recommended domain: `https://staging.getirbakim.com`
- Tami endpoint: `https://sandbox-paymentapi.tami.com.tr`
- Tami portal: `https://sandbox-portal.tami.com.tr`
- Separate DB, cron secret, and supplier credentials

### Production

- Vercel project: `zupv2-prod`
- Canonical domain: `https://www.getirbakim.com`
- Tami endpoint: `https://paymentapi.tami.com.tr`
- Tami portal: `https://portal.tami.com.tr`
- Separate DB, cron secret, and supplier credentials

## Required environment variables

### Public runtime values

These are safe to expose to the client bundle.

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_ENABLE_COOKIEYES`
- `NEXT_PUBLIC_COOKIEYES_CLIENT_ID`
- `NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS`
- `NEXT_PUBLIC_MEILI_HOST`
- `NEXT_PUBLIC_MEILI_SEARCH_KEY`

### Server-only secrets

These must exist only in Vercel server runtime or local `.env.local`.

- `DATABASE_URL`
- `DIRECT_URL`
- `POSTGRES_PASSWORD`
- `NEXTAUTH_SECRET`
- `TAMI_MERCHANT_NUMBER`
- `TAMI_TERMINAL_NUMBER`
- `TAMI_SECRET_KEY`
- `TAMI_JWK_KID`
- `TAMI_JWK_K`
- `TAMI_PAYMENT_API_BASE_URL`
- `TAMI_PORTAL_BASE_URL`
- `DINAMIK_BASE`
- `DINAMIK_APIKEY`
- `DINAMIK_SECRETKEY`
- `DINAMIK_PROXY_URL`
- `CRON_SECRET`
- `MEILI_MASTER_KEY`
- `UPSTASH_REDIS_REST_TOKEN`

Rule:

- Never create `NEXT_PUBLIC_` variants of server-only secrets.
- `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, Tami secrets, DB URLs, and cron secrets must remain server-only.

## Vercel setup

Create two separate Vercel projects:

1. `zupv2-staging`
2. `zupv2-prod`

Recommended git mapping:

- `staging` branch -> `zupv2-staging`
- `main` branch -> `zupv2-prod`

This keeps sandbox credentials out of production and reduces cutover mistakes.

## How to add secrets

Use the Vercel dashboard or CLI.

Example flow:

```bash
vercel link
vercel env add DATABASE_URL
vercel env add DIRECT_URL
vercel env add POSTGRES_PASSWORD
vercel env add NEXTAUTH_SECRET
vercel env add TAMI_SECRET_KEY
vercel env add CRON_SECRET
```

Repeat for staging and production with different values.

After any secret change:

1. update the value in the correct Vercel project
2. redeploy that project
3. run environment validation and smoke checks

## Validation commands

Run before deploy or immediately after updating env:

```bash
bun run env:check:local
bun run env:check:staging
bun run env:check:production
```

What the validator checks:

- core DB, NextAuth, Tami, and cron envs exist
- `NEXT_PUBLIC_*` values are valid URLs
- staging points to Tami sandbox
- production points to Tami live
- obviously secret-like values are not exposed through `NEXT_PUBLIC_*`

## Service-specific notes

### Database

- `DATABASE_URL` and `DIRECT_URL` both point to local Docker PostgreSQL (`postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-getirbakim}`)
- No external connection pooler needed — direct PrismaPg connections to the `postgres` service within the Docker network
- `POSTGRES_PASSWORD` secures the local PostgreSQL instance
- Rotate `POSTGRES_PASSWORD` and redeploy both the postgres and app containers

### Auth (NextAuth.js)

- `NEXTAUTH_SECRET` signs and encrypts JWT session tokens — must be server-only
- `NEXTAUTH_URL` must match the production domain
- User credentials are stored in the `users` table with bcryptjs-hashed passwords

### Tami

- staging must use sandbox merchant credentials and sandbox base URLs
- production must use live merchant credentials and live base URLs
- rotate these values together:
  - `TAMI_MERCHANT_NUMBER`
  - `TAMI_TERMINAL_NUMBER`
  - `TAMI_SECRET_KEY`
  - `TAMI_JWK_KID`
  - `TAMI_JWK_K`

### Cron and suppliers

- `CRON_SECRET` must differ across staging and production
- supplier credentials and proxy settings should also be isolated
- if supplier IP whitelisting is used, register staging and production separately

## Deployment checklist

### Before staging deploy

- `bun run env:check:staging`
- staging domain is configured
- staging Tami is sandbox
- staging DB and cron secret are isolated

### Before production deploy

- `bun run env:check:production`
- production domain is configured
- production Tami uses live credentials and live endpoints
- production DB URLs are correct
- `NEXTAUTH_URL` and `NEXTAUTH_SECRET` are set for production

### After staging deploy

- confirm NextAuth login works
- confirm checkout success and failure flows against Tami sandbox
- confirm internal cron rejects invalid secret and accepts the correct one

### After production deploy

- confirm site URLs render correctly
- confirm auth works
- confirm DB connectivity
- confirm Tami points to live endpoints
- run a small real payment smoke test and verify `/payment/auth` and `/payment/query`
