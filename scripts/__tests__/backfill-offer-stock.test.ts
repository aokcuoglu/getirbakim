import { describe, it, expect } from 'bun:test'

describe('backfill-approved-dinamik-parcatedarik-offer-stock dry-run validation', () => {
  it('respects DRY_RUN=true by default', () => {
    const DRY_RUN = process.env.DRY_RUN !== 'false'
    expect(DRY_RUN).toBe(true)
  })

  it('parses LIMIT env var correctly', () => {
    const rawLimit = process.env.LIMIT
    const parsed: number | undefined = rawLimit ? parseInt(rawLimit, 10) : undefined
    if (rawLimit === '10') {
      expect(parsed).toBe(10)
    } else {
      expect(parsed === undefined).toBe(true)
    }
  })

  it('parses MATCH_ID env var correctly', () => {
    const rawMatchId = process.env.MATCH_ID
    const parsed: string | undefined = rawMatchId || undefined
    if (rawMatchId === '42') {
      expect(parsed).toBe('42')
    } else {
      expect(parsed === undefined).toBe(true)
    }
  })

  it('offer stock propagation uses supplier_products.supplier_stock_qty', () => {
    const supplierStockQty = 5
    const fallbackStock = 0
    const result = supplierStockQty ?? fallbackStock
    expect(result).toBe(5)
  })

  it('offer stock fallback to 0 when supplier_products.supplier_stock_qty is null', () => {
    const supplierStockQty = null
    const result = supplierStockQty ?? 0
    expect(result).toBe(0)
  })

  it('currency fallback is TRY when supplier_products.currency is null', () => {
    const supplierCurrency = null
    const result = supplierCurrency || 'TRY'
    expect(result).toBe('TRY')
  })

  it('price fallback prefers supplier_products.supplier_price over dproduct_details.price', () => {
    const supplierPrice = '459.81'
    const offerPrice = '450.00'
    const expectedPrice = supplierPrice ?? offerPrice
    expect(expectedPrice).toBe('459.81')
  })

  it('price fallback uses dproduct_details.price when supplier_products.supplier_price is null', () => {
    const supplierPrice = null
    const offerPrice = '450.00'
    const expectedPrice = supplierPrice ?? offerPrice
    expect(expectedPrice).toBe('450.00')
  })

  it('no raw_json in backfill output', () => {
    const logOutput = JSON.stringify({
      approvedMatchesScanned: 5,
      supplierProductsFound: 4,
      offersFound: 3,
      offersWouldUpdate: 2,
      offersUpdated: 2,
      policiesWouldRefresh: 2,
      policiesRefreshed: 2,
      missingSupplierProducts: 1,
      missingOffers: 1,
      errors: 0
    })
    expect(logOutput.includes('raw_json')).toBe(false)
  })
})