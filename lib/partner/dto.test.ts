import { describe, expect, it } from 'bun:test'
import { Prisma } from '@prisma/client'
import { toPartnerProductDto, type PartnerProductRow } from './dto'

function row(overrides: Partial<PartnerProductRow> = {}): PartnerProductRow {
  return {
    id: BigInt(42),
    part_no: 'GDB1330',
    part_no_norm: 'GDB1330',
    name: 'Fren Balatası Ön',
    primary_image_url: 'https://cdn.example/1.jpg',
    min_selling_price_try: new Prisma.Decimal('200.00'),
    total_stock_qty: 7,
    brand: { brand: 'TRW', display_name: null },
    category: { name: 'Brake Pads', name_tr: 'Fren Balatası' },
    product_oems: [
      { code: '77362261', code_norm: '77362261', oem_brand: 'FIAT' },
      { code: '9948080', code_norm: '9948080', oem_brand: '' }
    ],
    product_vehicle_types: [{ vehicle_type_id: 16573 }],
    product_overrides: null,
    product_offers: [
      {
        net_cost_try: new Prisma.Decimal('120.00'),
        last_synced_at: new Date('2026-08-19T10:00:00Z')
      }
    ],
    ...overrides
  }
}

describe('toPartnerProductDto', () => {
  it('maps a catalog row to the partner contract', () => {
    const dto = toPartnerProductDto(row(), { discountBps: 1000 })
    expect(dto.id).toBe('42')
    expect(dto.sourceProductId).toBe('42')
    expect(dto.contractVersion).toBe('1.1')
    expect(dto.manufacturerPartNumber).toEqual({ value: 'GDB1330', normalized: 'GDB1330' })
    expect(dto.references[0]).toEqual({ type: 'OEM', value: '77362261', normalized: '77362261', brand: 'FIAT' })
    expect(dto.exactFitment.status).toBe('NOT_REQUESTED')
    expect(dto.partNo).toBe('GDB1330')
    expect(dto.name).toBe('Fren Balatası Ön')
    expect(dto.brandName).toBe('TRW')
    expect(dto.categoryName).toBe('Fren Balatası')
    expect(dto.oemNumbers).toEqual(['77362261', '9948080'])
    expect(dto.listPriceKurus).toBe(20000)
    expect(dto.b2bPriceKurus).toBe(18000)
    expect(dto.stockQty).toBe(7)
    expect(dto.availability).toBe('IN_STOCK')
    expect(dto.lastSyncedAt).toBe('2026-08-19T10:00:00.000Z')
  })

  it('confirms only the exact requested vehicle type id', () => {
    expect(toPartnerProductDto(row(), { discountBps: 0, vehicleTypeId: 16573 }).exactFitment).toEqual({
      requestedVehicleTypeId: 16573,
      status: 'CONFIRMED',
      matchedVehicleTypeIds: [16573]
    })
    expect(toPartnerProductDto(row({ product_vehicle_types: [] }), {
      discountBps: 0,
      vehicleTypeId: 99999
    }).exactFitment).toEqual({
      requestedVehicleTypeId: 99999,
      status: 'NOT_CONFIRMED',
      matchedVehicleTypeIds: []
    })
  })

  it('never leaks internal cost or supplier fields', () => {
    const dto = toPartnerProductDto(row(), { discountBps: 0 })
    const keys = Object.keys(dto)
    for (const banned of ['netCost', 'net_cost_try', 'supplierCode', 'listPrice', 'stockBreakdown']) {
      expect(keys.includes(banned)).toBe(false)
    }
  })

  it('prefers the brand display name when set', () => {
    const dto = toPartnerProductDto(
      row({ brand: { brand: 'BLUEPRINT', display_name: 'Blue Print' } }),
      { discountBps: 0 }
    )
    expect(dto.brandName).toBe('Blue Print')
  })

  it('lets a locked price override beat the rollup price', () => {
    const dto = toPartnerProductDto(
      row({
        product_overrides: {
          name_override: 'Fren Balatası (Kampanya)',
          selling_price_override: new Prisma.Decimal('150.00'),
          lock_price: true
        }
      }),
      { discountBps: 0 }
    )
    expect(dto.listPriceKurus).toBe(15000)
    expect(dto.name).toBe('Fren Balatası (Kampanya)')
  })

  it('ignores an override price that is not locked', () => {
    const dto = toPartnerProductDto(
      row({
        product_overrides: {
          name_override: null,
          selling_price_override: new Prisma.Decimal('150.00'),
          lock_price: false
        }
      }),
      { discountBps: 0 }
    )
    expect(dto.listPriceKurus).toBe(20000)
  })

  it('floors the B2B price at the lowest active offer cost', () => {
    const dto = toPartnerProductDto(
      row({
        product_offers: [
          { net_cost_try: new Prisma.Decimal('180.00'), last_synced_at: new Date('2026-08-18T00:00:00Z') },
          { net_cost_try: new Prisma.Decimal('160.00'), last_synced_at: new Date('2026-08-20T00:00:00Z') }
        ]
      }),
      { discountBps: 5000 }
    )
    expect(dto.b2bPriceKurus).toBe(16000)
    // En TAZE senkron anı raporlanır.
    expect(dto.lastSyncedAt).toBe('2026-08-20T00:00:00.000Z')
  })

  it('reports a priced product with no stock as supplyable, not unavailable', () => {
    const dto = toPartnerProductDto(row({ total_stock_qty: 0 }), { discountBps: 0 })
    expect(dto.availability).toBe('SUPPLYABLE')
  })

  it('reports an unpriced product as unavailable with null prices', () => {
    const dto = toPartnerProductDto(
      row({ min_selling_price_try: null, total_stock_qty: 3 }),
      { discountBps: 1500 }
    )
    expect(dto.listPriceKurus).toBeNull()
    expect(dto.b2bPriceKurus).toBeNull()
    expect(dto.availability).toBe('UNAVAILABLE')
  })

  it('returns a null lastSyncedAt when there is no active offer', () => {
    const dto = toPartnerProductDto(row({ product_offers: [] }), { discountBps: 0 })
    expect(dto.lastSyncedAt).toBeNull()
  })

  it('falls back to the untranslated category name', () => {
    const dto = toPartnerProductDto(
      row({ category: { name: 'Brake Pads', name_tr: null } }),
      { discountBps: 0 }
    )
    expect(dto.categoryName).toBe('Brake Pads')
  })
})
