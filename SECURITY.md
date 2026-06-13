# Security Policy

## Secrets and Credentials

### Never commit secrets

This repository must not contain real credentials, API keys, or secrets in tracked files.

- **`.env`**, **`.env.production`**, and **`.env*.local`** are gitignored and must never be committed.
- **`.env.example`** uses placeholder values only — replace them with real values locally.
- All secrets are injected at runtime via environment variables in production/staging.

### Payment secrets (Tami)

- `TAMI_SECRET_KEY`, `TAMI_JWK_KID`, and `TAMI_JWK_K` are payment-signing secrets.
- They must remain server-side only and are never exposed to the browser.
- Unit tests use deterministic fake fixtures (see `lib/payments/__fixtures__/tami-test-fixtures.ts`).
- Tests must not depend on real Tami credentials or the `.env` file.

### Upstash Redis token

- `UPSTASH_REDIS_REST_TOKEN` is a REST API token. Keep it server-side only.

### Database URL

- `DATABASE_URL` and `DIRECT_URL` contain database credentials.
- Keep them server-side only; never expose to the browser.

### Supplier API keys (Dinamik, SETA, Parts2World)

- All supplier API keys (`DINAMIK_APIKEY`, `DINAMIK_SECRETKEY`, `SETA_XAPIKEY`, `SETA_SECRETKEY`, etc.) must stay in `.env` files or CI secrets.
- Proxy credentials in `DINAMIK_PROXY_URL` are sensitive — do not log or commit them.

### Meilisearch

- `MEILI_MASTER_KEY` and `MEILI_ADMIN_KEY` are admin-level keys and must not be committed.
- `NEXT_PUBLIC_MEILI_SEARCH_KEY` is a public search-only key and is safe for the browser.

### GHCR private container images

- Docker images are hosted on GitHub Container Registry (ghcr.io) and may require authentication.
- Do not embed GHCR tokens or PATs in the repository.

## Secret Rotation

If a secret is accidentally committed:

1. **Immediately rotate** the exposed secret in the provider dashboard.
2. Remove the secret from Git history using `git filter-repo` or equivalent.
3. Update all environments (local, staging, production) with the new value.
4. Audit any access logs for the compromised time window.

## Vulnerability Disclosure

Please report security vulnerabilities privately to the repository maintainer.
Do not file public issues for security bugs.

## Code Review Checklist

Before merging any PR, verify:

- [ ] No real credentials in the diff
- [ ] No `.env` files tracked
- [ ] No hardcoded API keys, tokens, or passwords
- [ ] `.env.example` values are placeholders, not real
- [ ] Payment-related tests use fake fixtures only