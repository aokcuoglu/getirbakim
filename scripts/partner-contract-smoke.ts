import { parsePartnerKeys } from '../lib/partner/auth'

const REFERENCE_PART_NO = '103803'
const BASE_URL = 'http://localhost:3000'
const OFFER_KEYS = [
  'availability',
  'currency',
  'informationalPriceKurus',
  'lastSyncedAt',
  'selectedOfferId',
  'stockQty',
  'supplierDisplayName',
  'vatRateBps'
] as const
const ALLOWED_AVAILABILITY = new Set(['IN_STOCK', 'SUPPLYABLE', 'UNKNOWN'])
const BANNED_KEYS = new Set([
  'cost', 'costtry', 'netcost', 'netcosttry', 'margin', 'campaign',
  'campaignrate', 'pricingpolicy', 'supplierid', 'suppliercode', 'suppliersku',
  'stockbreakdown', 'provenance'
])

type JsonRecord = Record<string, unknown>

function fail(name: string): never {
  throw new Error(`FAIL ${name}`)
}

function assert(name: string, condition: unknown): asserts condition {
  if (!condition) fail(name)
  console.log(`PASS ${name}`)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

export function findBannedKeys(value: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) findBannedKeys(item, found)
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (BANNED_KEYS.has(normalizedKey(key))) found.add(key)
      findBannedKeys(child, found)
    }
  }
  return [...found]
}

export function validateExactResponse(value: unknown): {
  productIds: string[]
  offers: JsonRecord[]
} {
  assert('response_object', isRecord(value))
  assert('source_part_no', value.source === 'part_no')
  assert('products_array_0_to_n', Array.isArray(value.products))

  const products = value.products as unknown[]
  assert('reference_resolves_active_product', products.length > 0)
  const productIds: string[] = []
  const offers: JsonRecord[] = []

  for (const product of products) {
    assert('product_shape', isRecord(product))
    assert('contract_version_1_2', product.contractVersion === '1.2')
    assert('stable_source_product_id', typeof product.sourceProductId === 'string' && product.sourceProductId.length > 0)
    productIds.push(product.sourceProductId as string)
    assert('normalized_part_number_103803', isRecord(product.manufacturerPartNumber) && product.manufacturerPartNumber.normalized === REFERENCE_PART_NO)
    assert('fitment_not_requested', isRecord(product.exactFitment) && product.exactFitment.requestedVehicleTypeId === null && product.exactFitment.status === 'NOT_REQUESTED')
    assert('offers_array', Array.isArray(product.offers))
    for (const offer of product.offers as unknown[]) {
      assert('offer_shape', isRecord(offer))
      assert('offer_allowlist_only', Object.keys(offer).sort().join(',') === [...OFFER_KEYS].sort().join(','))
      assert('selected_offer_id', typeof offer.selectedOfferId === 'string' && offer.selectedOfferId.length > 0)
      assert('safe_supplier_display_name', typeof offer.supplierDisplayName === 'string' && offer.supplierDisplayName.trim().length > 0)
      assert('informational_price_allowlist', offer.informationalPriceKurus === null || (typeof offer.informationalPriceKurus === 'number' && Number.isInteger(offer.informationalPriceKurus) && offer.informationalPriceKurus > 0))
      assert('offer_currency_try', offer.currency === 'TRY')
      assert('offer_vat_allowlist', offer.vatRateBps === 2000)
      assert('availability_allowlist', typeof offer.availability === 'string' && ALLOWED_AVAILABILITY.has(offer.availability))
      assert('stock_allowlist', offer.stockQty === null || (typeof offer.stockQty === 'number' && Number.isInteger(offer.stockQty) && offer.stockQty >= 0))
      assert('freshness_allowlist', offer.lastSyncedAt === null || (typeof offer.lastSyncedAt === 'string' && Number.isFinite(Date.parse(offer.lastSyncedAt))))
      if (offer.availability === 'UNKNOWN') assert('unknown_stock_is_null', offer.stockQty === null)
      offers.push(offer)
    }
  }

  assert('active_supplier_offer_present', offers.length > 0)
  assert('positive_informational_price_present', offers.some((offer) => typeof offer.informationalPriceKurus === 'number' && offer.informationalPriceKurus > 0))
  assert('no_confidential_key_leakage', findBannedKeys(value).length === 0)
  return { productIds, offers }
}

function resolveBakimxKey(raw: string | undefined): string {
  for (const [key, code] of parsePartnerKeys(raw)) {
    if (code.toLowerCase() === 'bakimx') return key
  }
  fail('bakimx_runtime_credential_resolved')
}

async function request(token: string, partNo: string): Promise<JsonRecord> {
  const url = new URL('/api/partner/v1/products', BASE_URL)
  url.searchParams.set('partNo', partNo)
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store'
  })
  assert('authenticated_request_succeeds', response.ok)
  const body: unknown = await response.json()
  assert('authenticated_response_json', isRecord(body))
  return body
}

async function validateDatabaseSemantics(productIds: string[], responseOffers: JsonRecord[]): Promise<void> {
  const { db } = await import('../lib/db')
  try {
    const ids = productIds.map((id) => BigInt(id))
    const products = await db.products.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      select: {
        id: true,
        product_offers: {
          where: { is_active: true, supplier: { is: { is_active: true } } },
          select: {
            id: true,
            supplier_code: true,
            selling_price_try: true,
            stock_qty: true,
            supplier: { select: { name: true } }
          }
        }
      }
    })
    assert('all_products_active_in_database', products.length === ids.length)

    const bestByProductSupplier = new Map<string, (typeof products)[number]['product_offers'][number]>()
    for (const product of products) {
      for (const offer of product.product_offers) {
        const key = `${product.id}:${offer.supplier_code}`
        const current = bestByProductSupplier.get(key)
        const better = !current
          || Number(offer.stock_qty > 0) > Number(current.stock_qty > 0)
          || (Number(offer.stock_qty > 0) === Number(current.stock_qty > 0)
            && (current.selling_price_try == null
              || (offer.selling_price_try != null && (offer.selling_price_try.lessThan(current.selling_price_try)
                || (offer.selling_price_try.equals(current.selling_price_try) && offer.id < current.id)))))
        if (better) bestByProductSupplier.set(key, offer)
      }
    }

    const expected = [...bestByProductSupplier.values()].map((offer) => ({
        name: offer.supplier.name,
        price: offer.selling_price_try == null
          ? null
          : Math.round(Number(offer.selling_price_try.toString()) * 100),
        unknown: offer.supplier_code === 'basbug'
      }))

    assert('active_offer_count_matches_database', responseOffers.length === expected.length)
    const unmatched = [...responseOffers]
    for (const item of expected) {
      const index = unmatched.findIndex((offer) => offer.supplierDisplayName === item.name && offer.informationalPriceKurus === item.price)
      assert('offer_price_matches_zero_bps_selling_price', index >= 0)
      const [matched] = unmatched.splice(index, 1)
      if (item.unknown) assert('unreliable_supplier_stock_unknown_null', matched.availability === 'UNKNOWN' && matched.stockQty === null)
    }
    assert('zero_bps_offer_set_complete', unmatched.length === 0)
  } finally {
    await db.$disconnect()
  }
}

async function validateUnreliableStockSemantics(token: string): Promise<void> {
  const { db } = await import('../lib/db')
  try {
    const candidate = await db.products.findFirst({
      where: {
        status: 'ACTIVE',
        product_offers: {
          some: { is_active: true, supplier_code: 'basbug', supplier: { is: { is_active: true } } }
        }
      },
      orderBy: { id: 'asc' },
      select: {
        part_no_norm: true,
        product_offers: {
          where: { is_active: true, supplier_code: 'basbug', supplier: { is: { is_active: true } } },
          take: 1,
          select: { supplier: { select: { name: true } } }
        }
      }
    })
    assert('unreliable_stock_candidate_present', candidate != null && candidate.product_offers.length > 0)
    const body = await request(token, candidate.part_no_norm)
    assert('unreliable_stock_lookup_products', Array.isArray(body.products) && body.products.length > 0)
    const supplierName = candidate.product_offers[0]!.supplier.name
    const matchingOffers = (body.products as unknown[])
      .filter(isRecord)
      .flatMap((product) => Array.isArray(product.offers) ? product.offers.filter(isRecord) : [])
      .filter((offer) => offer.supplierDisplayName === supplierName)
    assert('unreliable_supplier_offer_present', matchingOffers.length > 0)
    assert('unreliable_supplier_stock_unknown_null', matchingOffers.every((offer) => offer.availability === 'UNKNOWN' && offer.stockQty === null))
  } finally {
    await db.$disconnect()
  }
}

async function main(): Promise<void> {
  console.log('Partner contract smoke (redacted assertions only)')
  const token = resolveBakimxKey(process.env.PARTNER_API_KEYS)
  assert('bakimx_runtime_credential_resolved', token.length > 0)

  const exact = await request(token, REFERENCE_PART_NO)
  const validated = validateExactResponse(exact)
  await validateDatabaseSemantics(validated.productIds, validated.offers)
  await validateUnreliableStockSemantics(token)

  const noMatchPartNo = `SMOKENOMATCH${Date.now()}`
  const noMatch = await request(token, noMatchPartNo)
  assert('dynamic_no_match_source_part_no', noMatch.source === 'part_no')
  assert('dynamic_no_match_empty_products', Array.isArray(noMatch.products) && noMatch.products.length === 0)
  assert('dynamic_no_match_no_leakage', findBannedKeys(noMatch).length === 0)
  console.log('PASS partner_contract_smoke_complete')
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error && /^FAIL [a-z0-9_]+$/i.test(error.message)
      ? error.message
      : 'FAIL partner_contract_smoke_internal_error'
    console.error(message)
    process.exit(1)
  })
}
