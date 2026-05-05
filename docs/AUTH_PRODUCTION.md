# Auth Production Readiness

## Supabase Dashboard Settings

### Site URL
Set the Supabase project **Site URL** to:
```
https://getirbakim.com
```

### Redirect URLs
Add the following **Redirect URLs** in the Supabase dashboard (Authentication > URL Configuration):

- `https://getirbakim.com/auth/callback`
- `https://getirbakim.com/tr/auth/callback` (if locale-specific callbacks are added)
- `https://getirbakim.com/en/auth/callback` (if locale-specific callbacks are added)
- `http://localhost:3000/auth/callback` (for local development only)

For **www** subdomain support:
- `https://www.getirbakim.com/auth/callback`

### Email Templates
Verify that Supabase auth email templates (confirmation, password reset) use the correct `{{ .SiteURL }}` or `{{ .ConfirmationURL }}` placeholders pointing to `https://getirbakim.com`.

## Auth Flow

### Sign-up
1. User submits email + password via `SignUpForm.tsx`
2. Server action `signUp` in `lib/actions/auth-actions.ts` calls `supabase.auth.signUp` with `emailRedirectTo: ${siteUrl}/auth/callback`
3. Supabase sends confirmation email with link to `/auth/callback`
4. User clicks link, auth code exchange happens in `app/auth/callback/route.ts`
5. Callback redirects to home page

### Sign-in
1. User submits email + password via `LoginForm.tsx`
2. Server action `signIn` in `lib/actions/auth-actions.ts` calls `supabase.auth.signInWithPassword`
3. Session cookie is set, user is redirected

### Auth Callback (`/auth/callback`)
- Located at `app/auth/callback/route.ts`
- Handles auth code exchange from email confirmation links
- In production, uses `x-forwarded-host` header to construct redirect URL
- In development, uses `request.url` origin (localhost)

### Middleware Session Refresh
- `middleware.ts` refreshes Supabase session cookies on every page load
- Only refreshes when auth cookies exist or on session-relevant paths (`/account`, `/checkout`, `/orders`, `/admin`)

### Admin Access
1. **Edge (middleware)**: Checks `user.user_metadata.role` and `user.app_metadata.role`
   - Immediately redirects known non-ADMIN roles to home
   - Allows unknown roles through (server-side check is authoritative)
2. **Server-side (`lib/admin-auth.ts`)**: `requireAdminAuth()` checks `db.users.role === 'ADMIN'`
   - Redirects non-ADMIN users to home
   - Used in admin page layout

## Server-Only Keys

**NEVER expose these keys client-side:**

- `SUPABASE_SERVICE_ROLE_KEY` — bypasses Row Level Security; server-only
- `DATABASE_URL` / `DIRECT_URL` — database connection strings
- `TAMI_SECRET_KEY` — payment HMAC key
- `TAMI_JWK_K` — payment JWK key
- `CRON_SECRET` — internal API auth
- `UPSTASH_REDIS_REST_TOKEN` — Redis access
- `MEILI_MASTER_KEY` — Meilisearch admin
- `DINAMIK_SECRETKEY` — supplier API
- `SETA_SECRETKEY` — supplier API
- `SETA_XAPIKEY` — supplier API

The `NEXT_PUBLIC_*` prefix means the value is embedded in client bundles. Verify that no secret values appear in `NEXT_PUBLIC_` variables.

## Production Checklist

- [ ] Supabase Site URL set to `https://getirbakim.com`
- [ ] Redirect URLs include `https://getirbakim.com/auth/callback`
- [ ] Redirect URLs include `https://www.getirbakim.com/auth/callback`
- [ ] `NEXT_PUBLIC_SITE_URL=https://getirbakim.com` (or `https://www.getirbakim.com`)
- [ ] `NEXT_PUBLIC_APP_URL` matches `NEXT_PUBLIC_SITE_URL`
- [ ] No duplicate `NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_APP_URL` entries in `.env.production`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` not in any `NEXT_PUBLIC_` variable
- [ ] Admin user has `role = 'ADMIN'` in `users` table
- [ ] Email confirmation flow tested end-to-end
- [ ] Password reset flow tested
- [ ] Auth callback returns 200 and redirects correctly at `https://getirbakim.com/auth/callback`
- [ ] Logout clears session and redirects to home
- [ ] Non-admin users cannot access `/admin` routes (redirected to home)

## Test Checklist

1. Sign up with a new email — confirm email link arrives and works
2. Log in with existing user — session persists across page refreshes
3. Access `/admin` as admin user — allowed
4. Access `/admin` as non-admin user — redirected to home
5. Access `/admin` without login — redirected to home
6. Auth callback URL `https://getirbakim.com/auth/callback?code=xxx` — processes correctly
7. Logout — session cleared, redirected to home
8. Middleware sets security headers on all responses