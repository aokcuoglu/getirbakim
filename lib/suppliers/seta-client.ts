import 'server-only'

const DEFAULT_TIMEOUT_MS = 25_000

export type SetaSyncMode = 'full' | 'delta'

export interface SetaProductItem {
  sku: string
  name: string | null
  brand: string | null
  price: number | null
  stockQty: number
  currency: string
  barcode1: string | null
  barcode2: string | null
  barcode3: string | null
  partNo: string | null
  oemCodes: string[]
  raw: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function normalizeInt(value: unknown): number {
  const numeric = normalizeNumber(value)
  if (numeric == null) return 0
  return Math.max(0, Math.trunc(numeric))
}

function splitCodes(value: unknown): string[] {
  if (value == null) return []
  if (typeof value === 'string') {
    return value
      .split(/[,\n;|]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitCodes(item))
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      splitCodes(item)
    )
  }
  return []
}

function pickString(raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = normalizeText(raw[key])
    if (value) return value
  }
  return null
}

function pickNumber(raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = normalizeNumber(raw[key])
    if (value != null) return value
  }
  return null
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []

  const firstLevelCandidates = [
    payload.data,
    payload.items,
    payload.products,
    payload.result,
    payload.rows,
    payload.list,
    payload.payload,
    payload.response
  ]

  for (const candidate of firstLevelCandidates) {
    if (Array.isArray(candidate)) return candidate
  }

  for (const candidate of firstLevelCandidates) {
    if (!isRecord(candidate)) continue
    const nested = [
      candidate.data,
      candidate.items,
      candidate.products,
      candidate.result,
      candidate.rows,
      candidate.list
    ]
    for (const value of nested) {
      if (Array.isArray(value)) return value
    }
  }

  let fallbackArray: unknown[] = []
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      if (value.some((item) => isRecord(item))) return value
      if (fallbackArray.length === 0) fallbackArray = value
      continue
    }
    if (!isRecord(value)) continue
    for (const nested of Object.values(value)) {
      if (Array.isArray(nested)) {
        if (nested.some((item) => isRecord(item))) return nested
        if (fallbackArray.length === 0) fallbackArray = nested
      }
    }
  }

  return fallbackArray
}

function normalizeSetaRow(rawUnknown: unknown): SetaProductItem | null {
  if (!rawUnknown || typeof rawUnknown !== 'object' || Array.isArray(rawUnknown)) {
    return null
  }

  const raw = rawUnknown as Record<string, unknown>
  const sku = pickString(raw, [
    'product_no',
    'productNo',
    'stokKodu',
    'stok_kodu',
    'stokkodu',
    'stock_code',
    'stockcode',
    'stockCode',
    'stock_no',
    'stockNo',
    'sku',
    'code',
    'code_no',
    'urunKodu',
    'urun_kodu',
    'product_code',
    'productCode'
  ])

  if (!sku) return null

  const oemCodes = Array.from(
    new Set(
      [
        ...splitCodes(raw.oemListe),
        ...splitCodes(raw.oem),
        ...splitCodes(raw.oem_codes),
        ...splitCodes(raw.oemCodes),
        ...splitCodes(raw.oem_kodlari),
        ...splitCodes(raw.oemKodlari),
        ...splitCodes(raw.oem_list),
        ...splitCodes(raw.oems),
        ...splitCodes(raw.OEM),
        ...splitCodes(raw.oemNo),
        ...splitCodes(raw.oem_no)
      ]
        .map((item) => normalizeText(item))
        .filter((item): item is string => Boolean(item))
    )
  ).slice(0, 120)

  return {
    sku,
    name: pickString(raw, [
      'stokAdi',
      'stock_name',
      'stockName',
      'name',
      'urunAdi',
      'urun_adi',
      'product_name',
      'title'
    ]),
    brand: pickString(raw, ['marka', 'brand', 'brand_name', 'brandName', 'manufacturer']),
    price: pickNumber(raw, ['fiyat', 'price', 'salePrice', 'listPrice', 'netPrice', 'unit_price']),
    stockQty: normalizeInt(
      pickNumber(raw, [
        'stokAdedi',
        'stock_qty',
        'stock',
        'quantity',
        'qty',
        'quantity_available',
        'availableQty'
      ]) ?? 0
    ),
    currency: pickString(raw, ['currency', 'doviz', 'curr']) || 'TRY',
    barcode1: pickString(raw, ['barkod1', 'barcode_1', 'barcode1', 'ean']),
    barcode2: pickString(raw, ['barkod2', 'barcode_2', 'barcode2', 'ean13']),
    barcode3: pickString(raw, ['barkod3', 'barcode_3', 'barcode3', 'gtin']),
    partNo: pickString(raw, [
      'part_no',
      'partNo',
      'part_number',
      'partNumber',
      'product_no',
      'productNo',
      'referans',
      'reference'
    ]),
    oemCodes,
    raw
  }
}

export async function getSetaProducts(mode: SetaSyncMode): Promise<SetaProductItem[]> {
  const baseUrl =
    process.env.SETA_PRODUCTS_URL?.trim() ||
    'https://b2b-api.ismyazilim.com/seta/products'

  const url = new URL(baseUrl)
  if (mode === 'delta') {
    url.searchParams.set('mode', 'delta')
  }

  const headers = new Headers({
    Accept: 'application/json'
  })

  const bearerToken = process.env.SETA_API_KEY?.trim()
  if (bearerToken) {
    headers.set('Authorization', `Bearer ${bearerToken}`)
  }

  const xApiKey = process.env.SETA_XAPIKEY?.trim() || process.env.SETA_APIKEY?.trim()
  const secretKey = process.env.SETA_SECRETKEY?.trim()
  if (xApiKey) {
    headers.set('XApiKey', xApiKey)
    headers.set('X-Api-Key', xApiKey)
    headers.set('ApiKey', xApiKey)
  }
  if (secretKey) {
    headers.set('SecretKey', secretKey)
    headers.set('X-Secret-Key', secretKey)
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    cache: 'no-store'
  })

  if (!response.ok) {
    const body = await response.text()
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'SETA auth failed (401/403). SETA_XAPIKEY (tercih edilen) veya SETA_API_KEY / SETA_APIKEY + SETA_SECRETKEY env değerlerini kontrol edin.'
      )
    }
    throw new Error(`SETA products request failed (${response.status}): ${body.slice(0, 500)}`)
  }

  const payload = await response.json()
  const rows = extractRows(payload)

  const normalized = rows
    .map((row) => normalizeSetaRow(row))
    .filter((row): row is SetaProductItem => Boolean(row))

  if (normalized.length === 0 && rows.length > 0) {
    const sample = rows[0]
    const keys = isRecord(sample) ? Object.keys(sample).slice(0, 20).join(', ') : typeof sample
    throw new Error(`SETA rows parsed but SKU normalize failed. First row keys/type: ${keys}`)
  }

  return normalized
}
