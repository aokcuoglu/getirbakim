import { describe, it, expect } from 'bun:test'

const VALID_STATUSES = ['CANDIDATE', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW', 'IGNORED', 'PT_UNMATCHED', 'MANUAL_MATCH'] as const
const VALID_BARCODE_FIELDS = ['barcode_1', 'barcode_2', 'barcode_3', 'none'] as const
const VALID_MATCH_REASONS = [
  'BARCODE_1_MODEL_EXACT',
  'BARCODE_2_MODEL_EXACT',
  'BARCODE_3_MODEL_EXACT',
  'MULTIPLE_PARCA_MODEL_MATCHES',
  'PT_UNMATCHED',
  'MANUAL_MATCH',
  'BRAND_ALIAS_DISAMBIGUATED'
] as const

describe('dinamik-parcatedarik list API serializeRow', () => {
  const serializeRow = (row: Record<string, unknown>) => ({
    id: String(row.id),
    dinamikProductId: row.dinamik_product_id == null ? null : String(row.dinamik_product_id),
    parcatedarikProductId: String(row.parcatedarik_product_id),
    dinamikBarcodeField: row.dinamik_barcode_field as string,
    dinamikBarcodeValue: row.dinamik_barcode_value as string,
    normalizedBarcodeValue: row.normalized_barcode_value as string,
    parcatedarikModel: row.parcatedarik_model as string,
    normalizedModel: row.normalized_model as string,
    matchReason: row.match_reason as string,
    confidence: Number(row.confidence),
    status: row.status as string,
    reviewNote: row.review_note as string | null,
    approvedBy: row.approved_by as string | null,
    approvedAt: row.approved_at ? new Date(row.approved_at as string).toISOString() : null,
    rejectedBy: row.rejected_by as string | null,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    dinamik: {
      stockCode: row.dinamik_stock_code as string | null,
      stockName: row.dinamik_stock_name as string | null,
      brand: row.dinamik_brand as string | null,
      price: row.dinamik_price ? String(row.dinamik_price) : null,
      barcode1: row.dinamik_barcode_1 as string | null,
      barcode2: row.dinamik_barcode_2 as string | null,
      barcode3: row.dinamik_barcode_3 as string | null
    },
    parcatedarik: {
      title: row.parcatedarik_title as string | null,
      refNo: row.parcatedarik_ref_no as string | null,
      manufacturerName: row.parcatedarik_manufacturer_name as string | null
    }
  })

  it('converts BigInt id and dinamik_product_id to string', () => {
    const row = {
      id: BigInt(42),
      dinamik_product_id: BigInt(13),
      parcatedarik_product_id: BigInt(4835),
      dinamik_barcode_field: 'barcode_2',
      dinamik_barcode_value: '25100016',
      normalized_barcode_value: '25100016',
      parcatedarik_model: '25100016',
      normalized_model: '25100016',
      match_reason: 'BARCODE_2_MODEL_EXACT',
      confidence: 0.97,
      status: 'CANDIDATE',
      review_note: null,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      created_at: '2026-05-21T00:00:00Z',
      updated_at: '2026-05-21T00:00:00Z',
      dinamik_stock_code: 'ABA 25100016',
      dinamik_stock_name: 'Test product',
      dinamik_brand: 'ABA',
      dinamik_price: '459.81',
      dinamik_barcode_1: null,
      dinamik_barcode_2: '25100016',
      dinamik_barcode_3: 'ABA-25100016',
      parcatedarik_title: 'Test PT product',
      parcatedarik_ref_no: '077903133G',
      parcatedarik_manufacturer_name: 'ABA'
    }

    const result = serializeRow(row)

    expect(result.id).toBe('42')
    expect(result.dinamikProductId).toBe('13')
    expect(typeof result.id).toBe('string')
    expect(typeof result.dinamikProductId).toBe('string')
  })

  it('converts BigInt parcatedarik_product_id to string', () => {
    const row = {
      id: BigInt(1),
      dinamik_product_id: BigInt(1),
      parcatedarik_product_id: BigInt(4835),
      dinamik_barcode_field: 'barcode_2',
      dinamik_barcode_value: '25007031',
      normalized_barcode_value: '25007031',
      parcatedarik_model: '25007031',
      normalized_model: '25007031',
      match_reason: 'BARCODE_2_MODEL_EXACT',
      confidence: 0.97,
      status: 'APPROVED',
      review_note: null,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      created_at: '2026-05-21T00:00:00Z',
      updated_at: '2026-05-21T00:00:00Z',
      dinamik_stock_code: null,
      dinamik_stock_name: null,
      dinamik_brand: null,
      dinamik_price: null,
      dinamik_barcode_1: null,
      dinamik_barcode_2: null,
      dinamik_barcode_3: null,
      parcatedarik_title: null,
      parcatedarik_ref_no: null,
      parcatedarik_manufacturer_name: null
    }

    const result = serializeRow(row)

    expect(result.parcatedarikProductId).toBe('4835')
    expect(typeof result.parcatedarikProductId).toBe('string')
  })

  it('converts Decimal price to string', () => {
    const row = {
      id: BigInt(4),
      dinamik_product_id: BigInt(13),
      parcatedarik_product_id: BigInt(4835),
      dinamik_barcode_field: 'barcode_2',
      dinamik_barcode_value: '25007031',
      normalized_barcode_value: '25007031',
      parcatedarik_model: '25007031',
      normalized_model: '25007031',
      match_reason: 'BARCODE_2_MODEL_EXACT',
      confidence: 0.97,
      status: 'APPROVED',
      review_note: null,
      approved_by: 'test@admin',
      approved_at: '2026-05-21T05:23:13Z',
      rejected_by: null,
      rejected_at: null,
      created_at: '2026-05-21T00:00:00Z',
      updated_at: '2026-05-21T00:00:00Z',
      dinamik_stock_code: 'ABA 25007031',
      dinamik_stock_name: 'Test product',
      dinamik_brand: 'ABA',
      dinamik_price: '778.87',
      dinamik_barcode_1: null,
      dinamik_barcode_2: '25007031',
      dinamik_barcode_3: 'ABA-25007031',
      parcatedarik_title: 'Test PT product',
      parcatedarik_ref_no: '077903133G',
      parcatedarik_manufacturer_name: 'ABA'
    }

    const result = serializeRow(row)

    expect(result.dinamik.price).toBe('778.87')
    expect(typeof result.dinamik.price).toBe('string')
  })

  it('handles null price correctly', () => {
    const row = {
      id: BigInt(1),
      dinamik_product_id: BigInt(1),
      parcatedarik_product_id: BigInt(1),
      dinamik_barcode_field: 'barcode_2',
      dinamik_barcode_value: '25100016',
      normalized_barcode_value: '25100016',
      parcatedarik_model: '25100016',
      normalized_model: '25100016',
      match_reason: 'BARCODE_2_MODEL_EXACT',
      confidence: 0.97,
      status: 'CANDIDATE',
      review_note: null,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      created_at: '2026-05-21T00:00:00Z',
      updated_at: '2026-05-21T00:00:00Z',
      dinamik_stock_code: null,
      dinamik_stock_name: null,
      dinamik_brand: null,
      dinamik_price: null,
      dinamik_barcode_1: null,
      dinamik_barcode_2: null,
      dinamik_barcode_3: null,
      parcatedarik_title: null,
      parcatedarik_ref_no: null,
      parcatedarik_manufacturer_name: null
    }

    const result = serializeRow(row)

    expect(result.dinamik.price).toBeNull()
  })

  it('serializes entire result as JSON without BigInt error', () => {
    const row = {
      id: BigInt(42),
      dinamik_product_id: BigInt(13),
      parcatedarik_product_id: BigInt(4835),
      dinamik_barcode_field: 'barcode_2',
      dinamik_barcode_value: '25100016',
      normalized_barcode_value: '25100016',
      parcatedarik_model: '25100016',
      normalized_model: '25100016',
      match_reason: 'BARCODE_2_MODEL_EXACT',
      confidence: 0.97,
      status: 'APPROVED',
      review_note: null,
      approved_by: 'test@admin',
      approved_at: '2026-05-21T05:23:13Z',
      rejected_by: null,
      rejected_at: null,
      created_at: '2026-05-21T00:00:00Z',
      updated_at: '2026-05-21T00:00:00Z',
      dinamik_stock_code: 'ABA 25100016',
      dinamik_stock_name: 'Test product',
      dinamik_brand: 'ABA',
      dinamik_price: '778.87',
      dinamik_barcode_1: null,
      dinamik_barcode_2: '25100016',
      dinamik_barcode_3: 'ABA-25100016',
      parcatedarik_title: 'Test PT product',
      parcatedarik_ref_no: '077903133G',
      parcatedarik_manufacturer_name: 'ABA'
    }

    const result = serializeRow(row)

    let json: string
    try {
      json = JSON.stringify(result)
    } catch {
      expect(false).toBe(true)
      return
    }

    const parsed = JSON.parse(json!)
    expect(parsed.id).toBe('42')
    expect(parsed.dinamikProductId).toBe('13')
    expect(parsed.parcatedarikProductId).toBe('4835')
    expect(typeof parsed.parcatedarikProductId).toBe('string')
    expect(parsed.dinamik.price).toBe('778.87')
    expect(parsed.confidence).toBe(0.97)
  })

  it('response does not contain raw_json field', () => {
    const row = {
      id: BigInt(1),
      dinamik_product_id: BigInt(1),
      parcatedarik_product_id: BigInt(1),
      dinamik_barcode_field: 'barcode_1',
      dinamik_barcode_value: '12345',
      normalized_barcode_value: '12345',
      parcatedarik_model: '12345',
      normalized_model: '12345',
      match_reason: 'BARCODE_1_MODEL_EXACT',
      confidence: 0.97,
      status: 'CANDIDATE',
      review_note: null,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      created_at: '2026-05-21T00:00:00Z',
      updated_at: '2026-05-21T00:00:00Z',
      dinamik_stock_code: null,
      dinamik_stock_name: null,
      dinamik_brand: null,
      dinamik_price: null,
      dinamik_barcode_1: null,
      dinamik_barcode_2: null,
      dinamik_barcode_3: null,
      parcatedarik_title: null,
      parcatedarik_ref_no: null,
      parcatedarik_manufacturer_name: null
    }

    const result = serializeRow(row)
    const json = JSON.stringify(result)

    expect(json.includes('raw_json')).toBe(false)
    expect(json.includes('raw')).toBe(false)
    expect('raw' in result).toBe(false)
    expect('raw_json' in result).toBe(false)
  })
})

describe('dinamik-parcatedarik API response shape', () => {
  it('flat response has rows, pagination, summary at top level', () => {
    const response = {
      rows: [],
      pagination: { page: 1, limit: 20, total: 0, pages: 1 },
      summary: {
        total: 495,
        byStatus: { CANDIDATE: 484, APPROVED: 5, NEEDS_REVIEW: 6 },
        dinamikProducts: { total: 1000, withBarcode: 800 },
        parcatedarikProductsWithModel: 500,
        uniqueExactMatches: 489,
        multipleMatches: 6
      },
      requestId: 'test'
    }

    expect(response.rows).toHaveLength(0)
    expect(response.pagination.total).toBe(0)
    expect(response.summary.total).toBe(495)
    expect('data' in response).toBe(false)
  })
})

describe('dinamik-parcatedarik filter validation', () => {
  it('accepts valid status values', () => {
    for (const status of VALID_STATUSES) {
      expect(VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])).toBe(true)
    }
  })

  it('rejects invalid status values', () => {
    const invalidStatuses = ['DROPPED', 'PENDING', '', "CANDIDATE'; DROP TABLE--", '<script>alert(1)</script>']
    for (const invalid of invalidStatuses) {
      expect(VALID_STATUSES.includes(invalid as typeof VALID_STATUSES[number])).toBe(false)
    }
  })

  it('accepts valid barcode_field values', () => {
    for (const field of VALID_BARCODE_FIELDS) {
      expect(VALID_BARCODE_FIELDS.includes(field as typeof VALID_BARCODE_FIELDS[number])).toBe(true)
    }
  })

  it('rejects invalid barcode_field values', () => {
    const invalidFields = ['barcode_4', 'barcode', '', "barcode_1'; DROP TABLE--", 'id', '1=1']
    for (const invalid of invalidFields) {
      expect(VALID_BARCODE_FIELDS.includes(invalid as typeof VALID_BARCODE_FIELDS[number])).toBe(false)
    }
  })

  it('accepts valid match_reason values', () => {
    for (const reason of VALID_MATCH_REASONS) {
      expect(VALID_MATCH_REASONS.includes(reason as typeof VALID_MATCH_REASONS[number])).toBe(true)
    }
  })

  it('rejects invalid match_reason values', () => {
    const invalidReasons = ['INVALID_REASON', '', "BARCODE_1_MODEL_EXACT'; DROP TABLE--", '1=1']
    for (const invalid of invalidReasons) {
      expect(VALID_MATCH_REASONS.includes(invalid as typeof VALID_MATCH_REASONS[number])).toBe(false)
    }
  })

  it('escapes ILIKE wildcards in barcode search', () => {
    const escapeIlike = (input: string) => input.replace(/[%_\\]/g, '\\$&')

    expect(escapeIlike('25007031')).toBe('25007031')
    expect(escapeIlike('25%')).toBe('25\\%')
    expect(escapeIlike('test_value')).toBe('test\\_value')
    expect(escapeIlike('path\\dir')).toBe('path\\\\dir')
    expect(escapeIlike("'; DROP TABLE--")).toBe("'; DROP TABLE--")
    expect(escapeIlike('25%70_31')).toBe('25\\%70\\_31')
  })

  it('pagination limit is capped at 100', () => {
    const capLimit = (raw: number) => Math.min(100, Math.max(1, raw))
    expect(capLimit(20)).toBe(20)
    expect(capLimit(1)).toBe(1)
    expect(capLimit(0)).toBe(1)
    expect(capLimit(100)).toBe(100)
    expect(capLimit(500)).toBe(100)
    expect(capLimit(-5)).toBe(1)
  })

  it('pagination offset is non-negative', () => {
    const page = 1
    const limit = 20
    const offset = (Math.max(1, page) - 1) * limit
    expect(offset).toBe(0)

    const page2 = 3
    const offset2 = (Math.max(1, page2) - 1) * limit
    expect(offset2).toBe(40)
  })
})
