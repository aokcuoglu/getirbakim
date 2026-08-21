import { describe, expect, it } from 'bun:test'
import { parsePartnerVehicleTypeId } from './input'

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
