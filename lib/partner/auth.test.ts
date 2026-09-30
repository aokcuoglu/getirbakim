import { describe, expect, it } from 'bun:test'
import {
  extractBearerToken,
  parsePartnerKeys,
  resolvePartner,
  resolveScopedPartner,
  MIN_PARTNER_KEY_LENGTH
} from './auth'

const KEY = 'sk_partner_bakimx_0123456789'
const OTHER_KEY = 'sk_partner_other_9876543210'

describe('parsePartnerKeys', () => {
  it('parses comma separated code:key pairs', () => {
    const map = parsePartnerKeys(`bakimx:${KEY}, other:${OTHER_KEY}`)
    expect(map.get(KEY)).toBe('bakimx')
    expect(map.get(OTHER_KEY)).toBe('other')
  })

  it('returns an empty map for missing or blank config', () => {
    expect(parsePartnerKeys(undefined).size).toBe(0)
    expect(parsePartnerKeys('').size).toBe(0)
    expect(parsePartnerKeys('   ').size).toBe(0)
  })

  it('drops entries whose key is shorter than the minimum', () => {
    const short = 'a'.repeat(MIN_PARTNER_KEY_LENGTH - 1)
    expect(parsePartnerKeys(`bakimx:${short}`).size).toBe(0)
  })

  it('drops malformed entries but keeps the valid ones', () => {
    const map = parsePartnerKeys(`nocolon, :${KEY}, bakimx:${OTHER_KEY}`)
    expect(map.size).toBe(1)
    expect(map.get(OTHER_KEY)).toBe('bakimx')
  })

  it('keeps a key that itself contains a colon', () => {
    const colonKey = 'sk:with:colons:0123456789'
    expect(parsePartnerKeys(`bakimx:${colonKey}`).get(colonKey)).toBe('bakimx')
  })

  it('lets the first definition win when a key is listed twice', () => {
    expect(parsePartnerKeys(`first:${KEY},second:${KEY}`).get(KEY)).toBe('first')
  })
})

describe('partner scope', () => {
  it('keeps a catalog credential out of every binding order endpoint', () => {
    const catalog = `bakimx:${KEY}`
    const orders = `bakimx:${OTHER_KEY}`
    expect(resolveScopedPartner(`Bearer ${KEY}`, 'catalog', catalog, orders)).toEqual({ code: 'bakimx' })
    expect(resolveScopedPartner(`Bearer ${KEY}`, 'orders', catalog, orders)).toBeNull()
    expect(resolveScopedPartner(`Bearer ${OTHER_KEY}`, 'orders', catalog, orders)).toEqual({ code: 'bakimx' })
    expect(resolveScopedPartner(`Bearer ${OTHER_KEY}`, 'catalog', catalog, orders)).toBeNull()
    expect(resolveScopedPartner(`Bearer ${KEY}`, 'orders', catalog, undefined)).toBeNull()
    expect(resolveScopedPartner(`Bearer ${KEY}`, 'orders', catalog, catalog)).toBeNull()
  })
})

describe('extractBearerToken', () => {
  it('reads the token regardless of scheme casing', () => {
    expect(extractBearerToken(`Bearer ${KEY}`)).toBe(KEY)
    expect(extractBearerToken(`bearer ${KEY}`)).toBe(KEY)
  })

  it('returns null for a missing or non-bearer header', () => {
    expect(extractBearerToken(null)).toBeNull()
    expect(extractBearerToken('')).toBeNull()
    expect(extractBearerToken(KEY)).toBeNull()
    expect(extractBearerToken('Basic abc')).toBeNull()
    expect(extractBearerToken('Bearer   ')).toBeNull()
  })
})

describe('resolvePartner', () => {
  const config = `bakimx:${KEY},other:${OTHER_KEY}`

  it('resolves a valid key to its partner code', () => {
    expect(resolvePartner(`Bearer ${KEY}`, config)).toEqual({ code: 'bakimx' })
    expect(resolvePartner(`Bearer ${OTHER_KEY}`, config)).toEqual({ code: 'other' })
  })

  it('rejects an unknown key', () => {
    expect(resolvePartner('Bearer sk_not_a_real_key_00000', config)).toBeNull()
  })

  it('rejects every request when no keys are configured', () => {
    expect(resolvePartner(`Bearer ${KEY}`, undefined)).toBeNull()
    expect(resolvePartner(`Bearer ${KEY}`, '')).toBeNull()
  })

  it('rejects a request with no Authorization header', () => {
    expect(resolvePartner(null, config)).toBeNull()
  })

  // Sözleşmenin çekirdeği: CRON_SECRET bu kapıyı AÇMAZ. Partner anahtarı
  // listesinde yer almayan hiçbir sır kabul edilmez.
  it('does not accept a secret that is not in the partner list', () => {
    expect(resolvePartner('Bearer cron-secret-value-123456', config)).toBeNull()
  })
})
