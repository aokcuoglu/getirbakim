import type { SearchHit } from '@/lib/types/search'

export type CatalogHitSortOption =
  | 'popularity'
  | 'price-asc'
  | 'price-desc'
  | 'name'

function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseBigIntSafe(value: string): bigint | null {
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function resolveCanonicalKey(hit: SearchHit): string {
  const key = hit.canonicalKey?.trim()
  if (key) return key

  const resolvedPartId = hit.resolvedPartId?.trim()
  if (resolvedPartId) return `part:${resolvedPartId}`

  return `part:${hit.id}`
}

function compareByRecency(left: SearchHit, right: SearchHit): number {
  const leftTime = Date.parse(left.updatedAt || left.createdAt || '')
  const rightTime = Date.parse(right.updatedAt || right.createdAt || '')
  const safeLeft = Number.isFinite(leftTime) ? leftTime : 0
  const safeRight = Number.isFinite(rightTime) ? rightTime : 0
  return safeRight - safeLeft
}

function compareByStableIdDesc(left: SearchHit, right: SearchHit): number {
  const leftId = parseBigIntSafe(left.id)
  const rightId = parseBigIntSafe(right.id)
  if (leftId != null && rightId != null) {
    if (leftId === rightId) return 0
    return leftId > rightId ? -1 : 1
  }

  return right.id.localeCompare(left.id)
}

function compareHitsForSelection(left: SearchHit, right: SearchHit): number {
  const leftRank = left.rankBucket ?? (left.sourceType === 'supplier_product' ? 2 : 1)
  const rightRank = right.rankBucket ?? (right.sourceType === 'supplier_product' ? 2 : 1)
  if (leftRank !== rightRank) return leftRank - rightRank

  if (left.isPurchasable !== right.isPurchasable) {
    return left.isPurchasable ? -1 : 1
  }

  if (left.priceSource !== right.priceSource) {
    return left.priceSource === 'real' ? -1 : 1
  }

  if (left.stockQty !== right.stockQty) {
    return right.stockQty - left.stockQty
  }

  const recency = compareByRecency(left, right)
  if (recency !== 0) return recency

  return compareByStableIdDesc(left, right)
}

function mergeSupplierMetadata(base: SearchHit, supplier: SearchHit): SearchHit {
  const mergedProperties = [...(base.properties || [])]

  if (
    supplier.providerCode &&
    !mergedProperties.some((item) => item.key === 'SUPPLIER_PROVIDER')
  ) {
    mergedProperties.unshift({
      key: 'SUPPLIER_PROVIDER',
      value: supplier.providerCode
    })
  }

  if (
    supplier.supplierSku &&
    !mergedProperties.some((item) => item.key === 'SUPPLIER_SKU')
  ) {
    mergedProperties.unshift({
      key: 'SUPPLIER_SKU',
      value: supplier.supplierSku
    })
  }

  return {
    ...base,
    supplierProductId: base.supplierProductId ?? supplier.supplierProductId ?? null,
    providerCode: base.providerCode ?? supplier.providerCode ?? null,
    supplierSku: base.supplierSku ?? supplier.supplierSku ?? null,
    matchType: base.matchType ?? supplier.matchType,
    properties: mergedProperties.slice(0, 8)
  }
}

function selectCanonicalHit(current: SearchHit, next: SearchHit): SearchHit {
  const selected = compareHitsForSelection(current, next) <= 0 ? current : next
  const other = selected === current ? next : current

  if (selected.sourceType !== 'supplier_product' && other.sourceType === 'supplier_product') {
    return mergeSupplierMetadata(selected, other)
  }

  return selected
}

function compareForSort(
  left: SearchHit,
  right: SearchHit,
  sort: CatalogHitSortOption
): number {
  if (sort === 'name') {
    const byName = left.name.localeCompare(right.name, 'tr')
    if (byName !== 0) return byName
  } else if (sort === 'price-asc' || sort === 'price-desc') {
    const leftPrice = parsePrice(left.price)
    const rightPrice = parsePrice(right.price)

    if (leftPrice == null && rightPrice != null) return 1
    if (leftPrice != null && rightPrice == null) return -1
    if (leftPrice != null && rightPrice != null && leftPrice !== rightPrice) {
      return sort === 'price-asc' ? leftPrice - rightPrice : rightPrice - leftPrice
    }
  }

  const byRank = (left.rankBucket ?? 1) - (right.rankBucket ?? 1)
  if (byRank !== 0) return byRank

  const byRecency = compareByRecency(left, right)
  if (byRecency !== 0 && sort === 'popularity') return byRecency

  return compareByStableIdDesc(left, right)
}

export function mergeCatalogHitsPage(input: {
  partHits: SearchHit[]
  supplierHits: SearchHit[]
  sort: CatalogHitSortOption
  limit: number
}): SearchHit[] {
  const byCanonical = new Map<string, SearchHit>()

  for (const hit of [...input.partHits, ...input.supplierHits]) {
    const key = resolveCanonicalKey(hit)
    const existing = byCanonical.get(key)
    if (!existing) {
      byCanonical.set(key, hit)
      continue
    }

    byCanonical.set(key, selectCanonicalHit(existing, hit))
  }

  return Array.from(byCanonical.values())
    .sort((left, right) => compareForSort(left, right, input.sort))
    .slice(0, Math.max(1, input.limit))
}
