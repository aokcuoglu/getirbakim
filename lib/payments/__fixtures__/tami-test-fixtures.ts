/**
 * Tami test fixtures — non-sensitive deterministic values for unit tests.
 *
 * These values are fake and must never be used in production.
 * They produce deterministic outputs so assertions remain meaningful.
 */

export const TEST_TAMI_MERCHANT_NUMBER = 'TEST_MERCHANT'
export const TEST_TAMI_TERMINAL_NUMBER = 'TEST_TERMINAL'
export const TEST_TAMI_SECRET_KEY = 'test-tami-secret-key-00000000-0000-0000-0000-000000000001'
export const TEST_TAMI_JWK_KID = 'test-tami-jwk-kid-00000000-0000-0000-0000-000000000001'
// Base64url-encoded 32-byte zero key (valid JWK shape, obviously fake)
export const TEST_TAMI_JWK_K = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
export const TEST_TAMI_PORTAL_BASE_URL = 'https://sandbox-portal.tami.com.tr'
export const TEST_TAMI_PAYMENT_API_BASE_URL = 'https://sandbox-paymentapi.tami.com.tr'

// Pre-computed expected values for assertions (generated from the constants above)
export const EXPECTED_PG_AUTH_TOKEN =
  'TEST_MERCHANT:TEST_TERMINAL:GHZoX138WOQ+uvUw4RPMPhjoUJWB6Xu4Xh4T5RTz3HA='

export const EXPECTED_SECURITY_HASH =
  'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3QtdGFtaS1qd2sta2lkLTAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMSJ9.eyJvcmRlcklkIjoib3JkZXJxdWVyeSIsImlzVHJhbnNhY3Rpb25EZXRhaWwiOnRydWV9.8-sOqsCbA0a6j8SiDhWQMlpk56h8a-Q7_dC9ay_D_QhER-e0842qHRr-1aqmLDjb8xWOIjR-VM9qHUUToI82PQ'