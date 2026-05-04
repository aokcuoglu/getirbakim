# TAMI Hosted 4003 Diagnostic Guide

## Summary
Checkout now uses the direct auth flow (`/payment/auth`) in the main application.  
This note only remains as a legacy troubleshooting reference for hosted token experiments and older diagnostics.  
`4003` (`reference 9011`) indicates a `PG-Auth-Token` mismatch and should be diagnosed at header/credential level.

## Flow Separation
| Flow | Endpoint | Card data in payload | `securityHash` in request |
|---|---|---|---|
| Direct Auth | `/payment/auth` | Yes | Required |
| Hosted | `/hosted/create-one-time-hosted-token` | No | Not sent |

`https://dev.tami.com.tr/tami-satis-islemi` includes an API request example for `POST /payment/auth`, not for hosted token creation.

## NodeJS vs Current Implementation Matrix
| Check | NodeJS Sample | Project Implementation | Status |
|---|---|---|---|
| PG-Auth formula | `sha256(merchant+terminal+secret)` base64 in `common_lib.js` | Same formula in `lib/payments/tami.ts` (`buildPgAuthToken`) | Aligned |
| Header keys | `PG-Api-Version`, `PG-Auth-Token`, `correlationId`, `Accept-Language` | Same keys in `buildHeaders` | Aligned |
| JWK signature generation | `securityHashV3.js` (`HS512`, `kid`, base64url `k`) | Same in `buildSecurityHash` | Aligned |
| Hosted request `securityHash` | Not shown in sales direct-auth sample | Explicitly disabled for hosted call | Aligned with hosted behavior |

Reference files:
- `/Users/aokcuoglu/Downloads/tami-nodejs/NODEJS/src/common_lib.js`
- `/Users/aokcuoglu/Downloads/tami-nodejs/NODEJS/src/securityHashV3.js`
- `/Users/aokcuoglu/www/zupv2/lib/payments/tami.ts`

## A/B Probe Command
Run from project root with runtime env loaded:

```bash
bun run tami:diag:hosted4003
```

The script probes both:
- `https://sandbox-paymentapi.tami.com.tr/hosted/create-one-time-hosted-token`
- `https://paymentapi.tami.com.tr/hosted/create-one-time-hosted-token`

Output fields:
- `timestampUtc`
- `endpoint`
- `correlationId`
- `merchant`
- `terminal`
- `httpStatus`
- `errorCode`
- `errorMessage`
- masked `pgAuthTokenPrefix`

## Support Ticket Template
Use the generated correlation IDs and send:

1. Merchant number
2. Terminal number
3. Endpoint(s) tested
4. UTC timestamps
5. Correlation IDs
6. Error details (`4003`, `reference 9011`)

Request TAMI to verify:
- Merchant/terminal/secret mapping
- Terminal API authorization per environment
- Secret rotation propagation state
