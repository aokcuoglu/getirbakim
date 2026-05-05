# Tami Payment Production Readiness

## Production Callback URL

The Tami payment callback URL for production must be:
```
https://getirbakim.com/api/payments/tami/callback
```

Register this URL with Tami as the success/fail callback endpoint.

## Required Environment Variables

| Variable | Description | Production Value |
|----------|-------------|-----------------|
| `TAMI_MERCHANT_NUMBER` | Merchant ID from Tami | Provided by Tami |
| `TAMI_TERMINAL_NUMBER` | Terminal ID from Tami | Provided by Tami |
| `TAMI_SECRET_KEY` | HMAC secret for PG-Auth-Token | Provided by Tami |
| `TAMI_JWK_KID` | JWK Key ID for security hash | Provided by Tami |
| `TAMI_JWK_K` | JWK Key for security hash (base64url) | Provided by Tami |
| `TAMI_PAYMENT_API_BASE_URL` | Payment API base URL | `https://paymentapi.tami.com.tr` |
| `TAMI_PORTAL_BASE_URL` | Portal base URL for hosted payments | `https://portal.tami.com.tr` |

## Server-Only Secrets

**NEVER expose these client-side:**
- `TAMI_SECRET_KEY`
- `TAMI_JWK_KID`
- `TAMI_JWK_K`
- `TAMI_MERCHANT_NUMBER` (only used server-side in auth tokens)

## Sandbox vs Production

The code defaults to sandbox URLs when `TAMI_PAYMENT_API_BASE_URL` and `TAMI_PORTAL_BASE_URL` are not set:
- Default payment API: `https://sandbox-paymentapi.tami.com.tr`
- Default portal: `https://sandbox-portal.tami.com.tr`

**For production, both URLs must be explicitly set in `.env.production`:**
```
TAMI_PAYMENT_API_BASE_URL=https://paymentapi.tami.com.tr
TAMI_PORTAL_BASE_URL=https://portal.tami.com.tr
```

The `bun run env:check:production` script validates that production uses the live Tami URLs.

## Payment Flow

### Direct Auth (Current Implementation)
1. User submits card details in checkout
2. `initializeTamiPaymentForOrder()` in `lib/payments/service.ts` calls `authorizeDirectPayment()`
3. Tami processes the payment and returns result with `securityHash`
4. `verifySecurityHash()` validates the HMAC-JWK response signature
5. Order is marked as succeeded, failed, or pending verification

### Hosted Payment (Available but Not Default)
- `createHostedToken()` and `buildHostedPaymentUrl()` in `lib/payments/tami.ts` support Tami's hosted payment page
- Redirect users to Tami's portal; callback returns to `/api/payments/tami/callback`

### Callback Handler
- Route: `app/api/payments/tami/callback/route.ts`
- Supports both GET and POST
- Extracts `orderId` from query params (GET) or form body (POST)
- Calls `finalizeTamiPaymentFromCallback()` which queries Tami to verify payment status
- Redirects user to `/{locale}/checkout/result?orderId=...&state=...`

## Amount Mismatch Handling

If the amount returned by Tami differs from the expected order total by more than 0.01:
- Direct auth: Payment is **failed** with message "Odeme tutari dogrulanamadi."
- Callback verification: Payment is **failed** with same message

This protects against amount tampering. The expected total comes from the database `orders.total_amount` field.

## Security Hash (HMAC-JWK)

All Tami API requests include a `securityHash` field computed as:
1. Header: `{"alg":"HS512","typ":"JWT","kid":"<JWK_KID>"}` — base64url encoded
2. Body: request payload (without `securityHash` field) — base64url encoded
3. Signature: HMAC-SHA512 of `<header>.<body>` using the JWK key — base64url encoded

Verification uses `crypto.timingSafeEqual` to prevent timing attacks.

## Payment States

| State | Meaning |
|-------|---------|
| `INITIATED` | Payment record created, awaiting provider |
| `PENDING` | Payment initiated, awaiting confirmation |
| `SUCCEEDED` | Payment confirmed by provider |
| `FAILED` | Payment declined or error |
| `PENDING_VERIFICATION` | Security hash invalid or result ambiguous |

## Test/Sandbox Cards

Contact Tami for sandbox test card numbers. Sandbox environment is at:
- `https://sandbox-paymentapi.tami.com.tr`
- `https://sandbox-portal.tami.com.tr`

## Production Switch Checklist

- [ ] `TAMI_PAYMENT_API_BASE_URL` set to `https://paymentapi.tami.com.tr`
- [ ] `TAMI_PORTAL_BASE_URL` set to `https://portal.tami.com.tr`
- [ ] `TAMI_MERCHANT_NUMBER` updated to production merchant ID
- [ ] `TAMI_TERMINAL_NUMBER` updated to production terminal ID
- [ ] `TAMI_SECRET_KEY` updated to production secret
- [ ] `TAMI_JWK_KID` updated to production JWK Key ID
- [ ] `TAMI_JWK_K` updated to production JWK Key
- [ ] Callback URL registered with Tami as `https://getirbakim.com/api/payments/tami/callback`
- [ ] `bun run env:check:production` passes without errors
- [ ] End-to-end test payment in sandbox with production-level config
- [ ] Verify 3DS/hosted redirect works through nginx/SSL
- [ ] Verify callback endpoint returns correct redirect URLs
- [ ] Check that `request.nextUrl.origin` in callback uses `https://getirbakim.com`

## Known Considerations

1. **Callback URL origin**: The Tami callback handler uses `request.nextUrl.origin` for building redirect URLs. In production behind nginx, this relies on the `x-forwarded-host` and `x-forwarded-proto` headers being set correctly by nginx.

2. **Duplicate env keys**: `.env.production` historically had duplicate `NEXT_PUBLIC_SITE_URL` entries. Ensure only one value exists: `NEXT_PUBLIC_SITE_URL=https://getirbakim.com`

3. **No rate limiting**: The callback endpoint `/api/payments/tami/callback` does not have rate limiting. Consider adding rate limiting at the nginx level if needed.

4. **Idempotency**: `finalizeTamiPaymentFromCallback` queries Tami by orderId each time. Multiple callbacks for the same order will re-query Tami and attempt to update the order state. The `markOrderPaymentSucceeded` / `markOrderPaymentFailed` functions should handle duplicate calls gracefully.