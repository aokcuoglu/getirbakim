import { afterEach, describe, expect, it } from 'bun:test'
import {
  buildPgAuthToken,
  buildHostedPaymentUrl,
  buildSecurityHash,
  verifySecurityHash
} from '@/lib/payments/tami'
import {
  TEST_TAMI_MERCHANT_NUMBER,
  TEST_TAMI_TERMINAL_NUMBER,
  TEST_TAMI_SECRET_KEY,
  TEST_TAMI_JWK_KID,
  TEST_TAMI_JWK_K,
  TEST_TAMI_PORTAL_BASE_URL,
  TEST_TAMI_PAYMENT_API_BASE_URL,
  EXPECTED_PG_AUTH_TOKEN,
  EXPECTED_SECURITY_HASH
} from '@/lib/payments/__fixtures__/tami-test-fixtures'

const originalEnv = {
  merchant: process.env.TAMI_MERCHANT_NUMBER,
  terminal: process.env.TAMI_TERMINAL_NUMBER,
  secret: process.env.TAMI_SECRET_KEY,
  kid: process.env.TAMI_JWK_KID,
  key: process.env.TAMI_JWK_K,
  portal: process.env.TAMI_PORTAL_BASE_URL,
  api: process.env.TAMI_PAYMENT_API_BASE_URL
}

function seedEnv() {
  process.env.TAMI_MERCHANT_NUMBER = TEST_TAMI_MERCHANT_NUMBER
  process.env.TAMI_TERMINAL_NUMBER = TEST_TAMI_TERMINAL_NUMBER
  process.env.TAMI_SECRET_KEY = TEST_TAMI_SECRET_KEY
  process.env.TAMI_JWK_KID = TEST_TAMI_JWK_KID
  process.env.TAMI_JWK_K = TEST_TAMI_JWK_K
  process.env.TAMI_PORTAL_BASE_URL = TEST_TAMI_PORTAL_BASE_URL
  process.env.TAMI_PAYMENT_API_BASE_URL = TEST_TAMI_PAYMENT_API_BASE_URL
}

afterEach(() => {
  process.env.TAMI_MERCHANT_NUMBER = originalEnv.merchant
  process.env.TAMI_TERMINAL_NUMBER = originalEnv.terminal
  process.env.TAMI_SECRET_KEY = originalEnv.secret
  process.env.TAMI_JWK_KID = originalEnv.kid
  process.env.TAMI_JWK_K = originalEnv.key
  process.env.TAMI_PORTAL_BASE_URL = originalEnv.portal
  process.env.TAMI_PAYMENT_API_BASE_URL = originalEnv.api
})

describe('tami helpers', () => {
  it('builds pg auth token using sha256+base64', () => {
    seedEnv()
    expect(buildPgAuthToken()).toBe(EXPECTED_PG_AUTH_TOKEN)
  })

  it('signs and verifies request payload security hash', () => {
    seedEnv()
    const payload = {
      orderId: 'orderquery',
      isTransactionDetail: true
    }

    const signature = buildSecurityHash(payload)

    expect(signature).toBe(EXPECTED_SECURITY_HASH)
    expect(verifySecurityHash({ ...payload, securityHash: signature }, signature)).toBe(true)
  })

  it('builds hosted payment page url from token', () => {
    seedEnv()
    expect(buildHostedPaymentUrl('abc123')).toBe(
      'https://sandbox-portal.tami.com.tr/hostedPaymentPage?token=abc123'
    )
  })

  it('rejects tampered security hash', () => {
    seedEnv()
    const payload = { orderId: 'orderquery', isTransactionDetail: true }
    const signature = buildSecurityHash(payload)
    const tampered = { ...payload, orderId: 'tampered', securityHash: signature }
    expect(verifySecurityHash(tampered, signature)).toBe(false)
  })

  it('rejects invalid security hash format', () => {
    seedEnv()
    expect(verifySecurityHash({ orderId: 'x' }, 'not-a-jwt')).toBe(false)
  })
})