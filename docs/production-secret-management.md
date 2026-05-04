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
- Separate Supabase project, DB, cron secret, and supplier credentials

### Production

- Vercel project: `zupv2-prod`
- Canonical domain: `https://www.getirbakim.com`
- Tami endpoint: `https://paymentapi.tami.com.tr`
- Tami portal: `https://portal.tami.com.tr`
- Separate Supabase project, DB, cron secret, and supplier credentials

## Required environment variables

### Public runtime values

These are safe to expose to the client bundle.

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_ENABLE_COOKIEYES`
- `NEXT_PUBLIC_COOKIEYES_CLIENT_ID`
- `NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS`
- `NEXT_PUBLIC_MEILI_HOST`
- `NEXT_PUBLIC_MEILI_SEARCH_KEY`

### Server-only secrets

These must exist only in Vercel server runtime or local `.env.local`.

- `DATABASE_URL`
- `DIRECT_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
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
- `SUPABASE_SERVICE_ROLE_KEY`, Tami secrets, DB URLs, and cron secrets must remain server-only.

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
vercel env add SUPABASE_SERVICE_ROLE_KEY
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

- core DB, Supabase, Tami, and cron envs exist
- `NEXT_PUBLIC_*` values are valid URLs
- staging points to Tami sandbox
- production points to Tami live
- obviously secret-like values are not exposed through `NEXT_PUBLIC_*`

## Service-specific notes

### Database

- `DATABASE_URL` should use the pooled runtime connection
- `DIRECT_URL` should use the direct migration connection
- rotate both together
- run production migrations only against the production DB

### Supabase/Auth

- use separate Supabase projects for staging and production
- configure auth callback URLs per environment
- keep `SUPABASE_SERVICE_ROLE_KEY` server-only

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
- staging Supabase callback URLs are configured
- staging Tami is sandbox
- staging DB and cron secret are isolated

### Before production deploy

- `bun run env:check:production`
- production domain is configured
- production Supabase callback URLs are configured
- production Tami uses live credentials and live endpoints
- production DB URLs are correct

### After staging deploy

- confirm login callback works
- confirm checkout success and failure flows against Tami sandbox
- confirm internal cron rejects invalid secret and accepts the correct one

### After production deploy

- confirm site URLs render correctly
- confirm auth callback works
- confirm DB connectivity
- confirm Tami points to live endpoints
- run a small real payment smoke test and verify `/payment/auth` and `/payment/query`
