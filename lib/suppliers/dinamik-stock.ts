export type DinamikRegionalStockKey =
  | 'istanbul'
  | 'ankara'
  | 'sakarya'
  | 'kayseri'

export type DinamikRegionalStockStatus = 'VAR' | 'YOK'

export interface DinamikRegionalStockEntry {
  status: DinamikRegionalStockStatus | null
  hasStock: boolean
  qty: number
}

export type DinamikRegionalStock = Record<
  DinamikRegionalStockKey,
  DinamikRegionalStockEntry
>

export interface DinamikNormalizedStockItemBase {
  stokKodu: string
  stokAdi: string | null
  marka: string | null
  fiyat: number | null
  campaignRate: number
  stokAdedi: number
  barkod1: string | null
  barkod2: string | null
  barkod3: string | null
  regionalStock: DinamikRegionalStock | null
  raw: Record<string, unknown>
}

const REGIONAL_STOCK_FIELDS: Array<{
  rawField: 'varyok1' | 'varyok2' | 'varyok3' | 'varyok4'
  key: DinamikRegionalStockKey
}> = [
  { rawField: 'varyok1', key: 'istanbul' },
  { rawField: 'varyok2', key: 'ankara' },
  { rawField: 'varyok3', key: 'sakarya' },
  { rawField: 'varyok4', key: 'kayseri' }
]

export const DINAMIK_REGIONAL_STOCK_ORDER = REGIONAL_STOCK_FIELDS.map(
  (item) => item.key
) as DinamikRegionalStockKey[]

export const DINAMIK_REGIONAL_STOCK_LABELS: Record<
  DinamikRegionalStockKey,
  string
> = {
  istanbul: 'Istanbul',
  ankara: 'Ankara',
  sakarya: 'Sakarya',
  kayseri: 'Kayseri'
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function normalizeRegionalStatus(
  value: unknown
): DinamikRegionalStockStatus | null {
  if (value == null) return null

  const normalized = String(value).trim().toLocaleUpperCase('tr')
  if (normalized === 'VAR') return 'VAR'
  if (normalized === 'YOK') return 'YOK'
  return null
}

function buildRegionalStockEntry(
  status: DinamikRegionalStockStatus | null
): DinamikRegionalStockEntry {
  return {
    status,
    hasStock: status === 'VAR',
    qty: status === 'VAR' ? 5 : 0
  }
}

export function parseDinamikRegionalStock(
  raw: unknown
): DinamikRegionalStock | null {
  const record = toRecord(raw)
  if (!record) return null

  let hasRegionalData = false
  const entries = {} as DinamikRegionalStock

  for (const field of REGIONAL_STOCK_FIELDS) {
    const status = normalizeRegionalStatus(record[field.rawField])
    if (status !== null) {
      hasRegionalData = true
    }
    entries[field.key] = buildRegionalStockEntry(status)
  }

  return hasRegionalData ? entries : null
}

function normalizeLegacyStockQty(candidates: unknown[]): number {
  for (const candidate of candidates) {
    const stripped = String(candidate ?? '').replace(/[^0-9-]/g, '')
    const value = Number(stripped)
    if (Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value))
    }
  }

  return 0
}

export function deriveDinamikStockContext(
  raw: unknown,
  fallbackCandidates: unknown[]
): { regionalStock: DinamikRegionalStock | null; stockQty: number } {
  const regionalStock = parseDinamikRegionalStock(raw)

  if (regionalStock) {
    const stockQty = DINAMIK_REGIONAL_STOCK_ORDER.reduce(
      (sum, key) => sum + regionalStock[key].qty,
      0
    )
    return { regionalStock, stockQty }
  }

  return {
    regionalStock: null,
    stockQty: normalizeLegacyStockQty(fallbackCandidates)
  }
}

export function mergeDinamikItemsBySku<
  T extends DinamikNormalizedStockItemBase
>(stockRows: T[], priceRows: T[]): T[] {
  const merged = new Map<string, T>()

  for (const row of stockRows) {
    merged.set(row.stokKodu, row)
  }

  for (const row of priceRows) {
    const existing = merged.get(row.stokKodu)

    if (existing) {
      merged.set(row.stokKodu, {
        ...existing,
        fiyat: row.fiyat ?? existing.fiyat,
        raw: {
          ...existing.raw,
          ...row.raw
        }
      } as T)
      continue
    }

    merged.set(row.stokKodu, {
      ...row,
      stokAdedi: 0,
      regionalStock: null
    } as T)
  }

  return Array.from(merged.values())
}
