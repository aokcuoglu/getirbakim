# Production Security Checklist

## Admin Access

- [ ] Admin routes (`/admin`, `/{locale}/admin`) are protected by both middleware and server-side checks
- [ ] Middleware checks `user.user_metadata.role` and `user.app_metadata.role` — early deny for known non-ADMIN roles
- [ ] Server-side `requireAdminAuth()` in `lib/admin-auth.ts` checks `db.users.role === 'ADMIN'` — authoritative check
- [ ] No admin API routes (`/api/admin/*`) are accessible without admin auth
- [ ] Admin layout (`app/[locale]/admin/layout.tsx`) calls `requireAdminAuth()`
- [ ] Unknown role values in middleware are passed through (server-side is authoritative) — ensure this is intentional

## Secret Handling

- [ ] `.env.production` is gitignored (`.git`, `.env.production`, `.env.local`, `.env.bak-*` in `.gitignore`)
- [ ] `.env.example` contains only placeholder values, no real secrets
- [ ] No `NEXT_PUBLIC_` variable contains secret values (they are embedded in client bundles)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is only used server-side (in `lib/supabase/storage.ts`)
- [ ] No secrets appear in client-side JavaScript bundles (verify with browser DevTools Network tab)
- [ ] `TAMI_SECRET_KEY`, `TAMI_JWK_K`, `TAMI_JWK_KID` are only used server-side
- [ ] `DATABASE_URL` and `DIRECT_URL` are only used server-side (Prisma)
- [ ] `CRON_SECRET` protects internal API routes (`/api/internal/suppliers/*`)

## Environment Configuration

- [ ] `NODE_ENV=production` in `.env.production`
- [ ] `NEXT_PUBLIC_SITE_URL=https://getirbakim.com` (no trailing slash, no duplicate entries)
- [ ] `NEXT_PUBLIC_APP_URL` matches `NEXT_PUBLIC_SITE_URL`
- [ ] `NEXT_PUBLIC_ALLOW_INDEXING=true` in production (to enable search engine indexing)
- [ ] `TAMI_PAYMENT_API_BASE_URL=https://paymentapi.tami.com.tr` (not sandbox)
- [ ] `TAMI_PORTAL_BASE_URL=https://portal.tami.com.tr` (not sandbox)
- [ ] All required env vars are set (run `bun run env:check:production`)
- [ ] No `.env.production` file is committed to git (`git ls-files` should not list it)

## Security Headers

The application sets the following security headers via middleware (`middleware.ts`):

| Header | Value | Notes |
|--------|-------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Only set for non-localhost |
| `X-Content-Type-Options` | `nosniff` | Always set |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Always set |
| `X-Frame-Options` | `SAMEORIGIN` | Always set |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), browsing-topics=()` | Always set |
| `Content-Security-Policy` | See middleware code | See note below |
| `Cache-Control` | `public, s-maxage=300, stale-while-revalidate=900` | Anonymous GET/HEAD only |

### CSP Considerations

Current CSP includes `'unsafe-inline' 'unsafe-eval'` in `script-src` and `https:` sources. This is permissive but may be necessary for Next.js runtime and third-party scripts. Consider tightening in a future release:
- [ ] Audit which scripts require `unsafe-inline` and `unsafe-eval`
- [ ] Consider using nonce-based CSP for inline scripts
- [ ] Consider restricting `script-src https:` to specific domains

## Payment Endpoint Protection

- [ ] `/api/payments/tami/callback` is a public endpoint (Tami calls it)
- [ ] Callback validates payment status via `queryPaymentByOrderId` — does not trust callback payload alone
- [ ] Amount mismatch check (`Math.abs(actual - expected) > 0.01`) prevents amount tampering
- [ ] HMAC-JWK security hash verification (`verifySecurityHash`) validates response integrity
- [ ] No customer card data is stored server-side
- [ ] Consider adding rate limiting at nginx level for `/api/payments/tami/callback`

## Supplier Internal Endpoint Protection

- [ ] `/api/internal/suppliers/*` routes require `CRON_SECRET` via `x-cron-secret` header
- [ ] `CRON_SECRET` should be a long, randomly generated value in production
- [ ] Cron jobs on VPS include the secret header: `curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/internal/...`
- [ ] These endpoints should NOT be accessible from the public internet through nginx

## Backup and Rollback

- [ ] Database: Supabase manages automated backups — verify backup schedule
- [ ] `.env.production`: Keep a secure backup off the VPS (e.g., encrypted password manager)
- [ ] Git tags: Each release is tagged (`v0.1.2`, `v0.1.3`, etc.) for rollback
- [ ] Docker images: Previous build images remain until manually pruned
- [ ] Rollback procedure documented in `docs/OPERATIONS_RUNBOOK.md`

## Log Review

- [ ] Application logs: `docker compose logs app --tail=100 -f`
- [ ] Nginx access logs: `/var/log/nginx/getirbakim.com.access.log`
- [ ] Nginx error logs: `/var/log/nginx/getirbakim.com.error.log`
- [ ] Docker container logs: `docker inspect --format='{{.State.Health.Status}}' getirbakim-app`
- [ ] Review logs for: 4xx/5xx spikes, auth failures, payment errors, supplier sync errors

## Rate Limiting

- [ ] No application-level rate limiting is currently implemented
- [ ] nginx rate limiting should be considered for:
  - `/api/payments/tami/callback` — payment callbacks
  - `/api/internal/suppliers/*` — already protected by `CRON_SECRET`
  - `/auth/callback` — prevent auth abuse
- [ ] Consider adding `limit_req` zones in nginx config for sensitive endpoints

## Recommended nginx Rate Limiting

```nginx
# In http block
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=auth:10m rate=3r/s;

# In server block
location /api/payments/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://nextjs_app;
}

location /auth/callback {
    limit_req zone=auth burst=5 nodelay;
    proxy_pass http://nextjs_app;
}
```