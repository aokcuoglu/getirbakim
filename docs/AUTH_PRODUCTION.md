# Auth Production Readiness

## NextAuth.js Configuration

### Site URL
Set the `NEXTAUTH_URL` environment variable to:
```
https://getirbakim.com
```

### NextAuth Configuration
NextAuth.js v5 (Auth.js) is configured with the Credentials provider. Authentication is handled entirely within the application — no external auth dashboard configuration required.

- Provider: Credentials (email + password)
- Password hashing: bcryptjs
- User storage: `users` table in PostgreSQL (via Prisma)
- Session: JWT-based sessions managed by NextAuth

## Auth Flow

### Sign-up
1. User submits email + password via `SignUpForm.tsx`
2. Server action `signUp` in `lib/actions/auth-actions.ts` hashes password with bcryptjs and creates a `users` record in PostgreSQL
3. User is automatically signed in after successful registration

### Sign-in
1. User submits email + password via `LoginForm.tsx`
2. Server action `signIn` in `lib/actions/auth-actions.ts` calls NextAuth's credentials provider
3. NextAuth verifies the password against the bcryptjs hash stored in the `users` table
4. JWT session cookie is set, user is redirected

### Session Handling
- NextAuth manages JWT session tokens automatically
- Middleware (`middleware.ts`) validates the NextAuth session on every request
- Session is refreshed on page loads for protected paths (`/account`, `/checkout`, `/orders`, `/admin`)

### Admin Access
1. **Edge (middleware)**: Checks the NextAuth session token and user role from the JWT payload
   - Immediately redirects known non-ADMIN roles to home
   - Allows unknown roles through (server-side check is authoritative)
2. **Server-side (`lib/admin-auth.ts`)**: `requireAdminAuth()` checks `db.users.role === 'ADMIN'`
   - Redirects non-ADMIN users to home
   - Used in admin page layout

## Server-Only Keys

**NEVER expose these keys client-side:**

- `NEXTAUTH_SECRET` — signs and encrypts NextAuth JWTs; server-only
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

- [ ] `NEXTAUTH_URL=https://getirbakim.com`
- [ ] `NEXTAUTH_SECRET` is set to a strong random value (server-only)
- [ ] `NEXT_PUBLIC_SITE_URL=https://getirbakim.com` (or `https://www.getirbakim.com`)
- [ ] `NEXT_PUBLIC_APP_URL` matches `NEXT_PUBLIC_SITE_URL`
- [ ] No duplicate `NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_APP_URL` entries in `.env.production`
- [ ] `NEXTAUTH_SECRET` not in any `NEXT_PUBLIC_` variable
- [ ] Admin user has `role = 'ADMIN'` in `users` table
- [ ] Sign-up flow tested end-to-end
- [ ] Sign-in flow tested end-to-end
- [ ] Logout clears session and redirects to home
- [ ] Non-admin users cannot access `/admin` routes (redirected to home)

## Test Checklist

1. Sign up with a new email — account created and session established
2. Log in with existing user — session persists across page refreshes
3. Access `/admin` as admin user — allowed
4. Access `/admin` as non-admin user — redirected to home
5. Access `/admin` without login — redirected to home
6. Logout — session cleared, redirected to home
7. Middleware sets security headers on all responses