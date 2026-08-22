import { describe, expect, it } from 'bun:test'
import { findBannedKeys, validateExactResponse } from './partner-contract-smoke'

function response() {
  return {
    source: 'part_no',
    products: [{
      contractVersion: '1.2',
      sourceProductId: '42',
      manufacturerPartNumber: { value: '103803', normalized: '103803' },
      exactFitment: { requestedVehicleTypeId: null, status: 'NOT_REQUESTED', matchedVehicleTypeIds: [] },
      offers: [{
        selectedOfferId: 'offer_1',
        supplierDisplayName: 'Presentation Name',
        informationalPriceKurus: 99530,
        currency: 'TRY',
        vatRateBps: 2000,
        availability: 'UNKNOWN',
        stockQty: null,
        lastSyncedAt: '2026-08-21T12:00:00.000Z'
      }]
    }]
  }
}

describe('partner contract smoke validation', () => {
  it('accepts the redacted v1.2 exact-offer allowlist', () => {
    expect(validateExactResponse(response())).toEqual({
      productIds: ['42'],
      offers: [response().products[0].offers[0]]
    })
  })

  it('detects confidential keys recursively', () => {
    expect(findBannedKeys({ products: [{ offers: [{ netCostTry: 10, supplierCode: 'x' }] }] }).sort())
      .toEqual(['netCostTry', 'supplierCode'])
  })

  it('requires a non-empty selected offer id', () => {
    const payload = response()
    payload.products[0].offers[0].selectedOfferId = ''
    let message = ''
    try {
      validateExactResponse(payload)
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message).toBe('FAIL selected_offer_id')
  })

  it('rejects fields outside the offer presentation allowlist', () => {
    const payload = response()
    Object.assign(payload.products[0].offers[0], { supplierId: 'secret' })
    let message = ''
    try {
      validateExactResponse(payload)
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message).toBe('FAIL offer_allowlist_only')
  })
})
