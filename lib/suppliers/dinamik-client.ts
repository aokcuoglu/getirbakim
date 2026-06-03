import 'server-only'
import { dinamikFetch } from '@/lib/dinamik'
import {
  deriveDinamikStockContext,
  type DinamikNormalizedStockItemBase,
  type DinamikRegionalStock
} from '@/lib/suppliers/dinamik-stock'

const DEFAULT_TIMEOUT_MS = 25_000
const MAX_RETRIES = 3

type RetryableMethod = 'GET' | 'POST'

export class SupplierApiError extends Error {
  readonly status: number | null
  readonly code: string
  readonly details?: string

  constructor(message: string, options?: { status?: number | null; code?: string; details?: string }) {
    super(message)
    this.name = 'SupplierApiError'
    this.status = options?.status ?? null
    this.code = options?.code ?? 'SUPPLIER_API_ERROR'
    this.details = options?.details
  }
}

export interface DinamikBrandItem {
  brand: string
}

export interface DinamikStockOrPriceItem {
  stokKodu?: string
  stokAdi?: string
  ingilizceAdi?: string
  marka?: string
  varyok1?: string
  varyok2?: string
  varyok3?: string
  varyok4?: string
  kull1s?: string | number
  kull3s?: string | number
  kull7s?: string | number
  kull8s?: string | number
  resimUrl?: string
  fiyat?: string | number
  kampanyaOrani?: string | number
  kampanya_orani?: string | number
  campaignRate?: string | number
  barkod1?: string
  barkod2?: string
  barkod3?: string
  [key: string]: unknown
}

export interface DinamikStockItem extends DinamikNormalizedStockItemBase {
  raw: DinamikStockOrPriceItem
  regionalStock: DinamikRegionalStock | null
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

function normalizeRate(value: unknown): number {
  if (value == null || value === '') return 0

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0
    const normalized = value > 1 ? value / 100 : value
    return Math.min(1, Math.max(0, normalized))
  }

  const text = String(value)
    .replace('%', '')
    .replace(',', '.')
    .trim()
  if (!text) return 0

  const numeric = Number(text)
  if (!Number.isFinite(numeric)) return 0
  const normalized = numeric > 1 ? numeric / 100 : numeric
  return Math.min(1, Math.max(0, normalized))
}

function shouldRetry(status: number | null): boolean {
  if (status == null) return true
  return status === 408 || status === 429 || status >= 500
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  options?: { timeoutMs?: number; method?: RetryableMethod }
): Promise<T> {
  const method = options?.method ?? 'GET'
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let lastError: unknown = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await dinamikFetch(path, init, { timeoutMs })
      const rawBody = await response.text()
      const contentType = response.headers.get('content-type') || ''

      if (!response.ok) {
        throw new SupplierApiError(`Dinamik API hatası (${response.status})`, {
          status: response.status,
          code: `DINAMIK_HTTP_${response.status}`,
          details: rawBody.slice(0, 1000)
        })
      }

      if (!contentType.includes('application/json')) {
        throw new SupplierApiError('Dinamik API JSON dönmedi.', {
          status: response.status,
          code: 'DINAMIK_INVALID_CONTENT_TYPE',
          details: rawBody.slice(0, 300)
        })
      }

      try {
        return JSON.parse(rawBody) as T
      } catch {
        throw new SupplierApiError('Dinamik API JSON parse hatası.', {
          status: response.status,
          code: 'DINAMIK_JSON_PARSE_ERROR',
          details: rawBody.slice(0, 1000)
        })
      }
    } catch (error) {
      lastError = error
      const status = error instanceof SupplierApiError ? error.status : null

      if (!shouldRetry(status) || attempt === MAX_RETRIES) {
        break
      }

      const delay = 250 * attempt
      await sleep(delay)
    }
  }

  if (lastError instanceof SupplierApiError) {
    throw lastError
  }

  throw new SupplierApiError('Dinamik API isteği başarısız.', {
    code: 'DINAMIK_REQUEST_FAILED',
    details: lastError instanceof Error ? lastError.message : String(lastError)
  })
}

function assertArray<T>(payload: unknown, fieldName: string): T[] {
  if (!Array.isArray(payload)) {
    throw new SupplierApiError(`${fieldName} yanıtı dizi değil.`, {
      code: 'DINAMIK_INVALID_PAYLOAD'
    })
  }
  return payload as T[]
}

export async function getBrandList(): Promise<DinamikBrandItem[]> {
  const payload = await requestJson<Array<{ brand?: unknown }>>('/api/Dnmk_Customer/getBrandList', {
    method: 'GET'
  })

  const brands = assertArray<{ brand?: unknown }>(payload, 'getBrandList')
  const unique = new Set<string>()

  for (const item of brands) {
    const brand = normalizeText(item.brand)
    if (brand) unique.add(brand)
  }

  return Array.from(unique)
    .sort((a, b) => a.localeCompare(b, 'tr'))
    .map((brand) => ({ brand }))
}

export function normalizeDinamikStockOrPriceRows(
  rows: DinamikStockOrPriceItem[]
): DinamikStockItem[] {
  const normalized: DinamikStockItem[] = []

  for (const item of rows) {
    const stokKodu = normalizeText(item.stokKodu)
    if (!stokKodu) continue

    const stockContext = deriveDinamikStockContext(item, [
      item.kull8s,
      item.kull7s,
      item.kull3s,
      item.kull1s,
      0
    ])

    normalized.push({
      stokKodu,
      stokAdi: normalizeText(item.stokAdi),
      marka: normalizeText(item.marka),
      fiyat: normalizeNumber(item.fiyat),
      campaignRate: normalizeRate(
        item.kampanyaOrani ?? item.kampanya_orani ?? item.campaignRate
      ),
      stokAdedi: stockContext.stockQty,
      barkod1: normalizeText(item.barkod1),
      barkod2: normalizeText(item.barkod2),
      barkod3: normalizeText(item.barkod3),
      regionalStock: stockContext.regionalStock,
      raw: item
    })
  }

  return normalized
}

export async function getStockList(brand: string): Promise<DinamikStockItem[]> {
  const safeBrand = brand.trim()
  if (!safeBrand) {
    throw new SupplierApiError('getStockList için brand zorunludur.', {
      code: 'DINAMIK_BRAND_REQUIRED'
    })
  }

  const encodedBrand = encodeURIComponent(safeBrand)
  const payload = await requestJson<DinamikStockOrPriceItem[]>(
    `/api/Dnmk_Customer/getStockList/${encodedBrand}`,
    {
      method: 'GET'
    }
  )

  return normalizeDinamikStockOrPriceRows(
    assertArray<DinamikStockOrPriceItem>(payload, 'getStockList')
  )
}

export async function getPriceList(brand: string): Promise<DinamikStockItem[]> {
  const safeBrand = brand.trim()
  if (!safeBrand) {
    throw new SupplierApiError('getPriceList için brand zorunludur.', {
      code: 'DINAMIK_BRAND_REQUIRED'
    })
  }

  const encodedBrand = encodeURIComponent(safeBrand)
  const payload = await requestJson<DinamikStockOrPriceItem[]>(
    `/api/Dnmk_Customer/getPriceList/${encodedBrand}`,
    {
      method: 'GET'
    }
  )

  return normalizeDinamikStockOrPriceRows(
    assertArray<DinamikStockOrPriceItem>(payload, 'getPriceList')
  )
}

export async function getStockBySku(stockCode: string): Promise<DinamikStockItem | null> {
  const sku = stockCode.trim()
  if (!sku) {
    throw new SupplierApiError('getStock için STOK_KODU zorunludur.', {
      code: 'DINAMIK_STOK_KODU_REQUIRED'
    })
  }

  const payload = await requestJson<DinamikStockOrPriceItem[] | DinamikStockOrPriceItem>(
    '/api/Dnmk_Customer/getStock',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ STOK_KODU: sku })
    },
    { method: 'POST' }
  )

  const list = Array.isArray(payload) ? payload : [payload]
  const normalized = normalizeDinamikStockOrPriceRows(list)

  return normalized.find((item) => item.stokKodu === sku) || normalized[0] || null
}
