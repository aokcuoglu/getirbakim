import { describe, expect, it } from 'bun:test'
import {
  buildPartnerPartNoFilter,
  normalizePartnerPartNo,
  parsePartnerVehicleTypeId
} from './input'

describe('normalizePartnerPartNo', () => {
  it('normalizes separator and case variants to the exact catalog key', () => {
    expect(normalizePartnerPartNo(' 10-38.03 ')).toBe('103803')
    expect(normalizePartnerPartNo('gdb/1330')).toBe('GDB1330')
  })

  it('rejects an absent or empty matching key', () => {
    expect(normalizePartnerPartNo(null)).toBeNull()
    expect(normalizePartnerPartNo('   ')).toBeNull()
  })

  it('builds an ACTIVE exact-equality filter rather than a prefix query', () => {
    expect(buildPartnerPartNoFilter('10-38.03')).toEqual({
      status: 'ACTIVE',
      part_no_norm: '103803'
    })
    expect(buildPartnerPartNoFilter('')).toBeNull()
  })
})

describe('parsePartnerVehicleTypeId', () => {
  it('accepts absent and positive Int32 ids', () => {
    expect(parsePartnerVehicleTypeId(null)).toEqual({ valid: true, value: null })
    expect(parsePartnerVehicleTypeId('2147483647')).toEqual({ valid: true, value: 2147483647 })
  })

  it('rejects malformed and out-of-range ids', () => {
    for (const value of ['', '0', '-1', '1.5', '1e3', ' 1', '2147483648']) {
      expect(parsePartnerVehicleTypeId(value).valid).toBe(false)
    }
  })
})
