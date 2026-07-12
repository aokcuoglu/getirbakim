import { Prisma } from '@prisma/client'

/**
 * Display-side helpers for the canonical `catalog` schema, shared by the
 * storefront and the admin catalog screens. Prices in catalog.* are stored
 * ex-VAT (see lib/pricing/calculate-selling-price.ts); the storefront adds
 * VAT at display time, mirroring lib/product-card-state.ts.
 */

export const CATALOG_VAT_RATE = 0.2

/**
 * Storefront availability for a catalog product, derived from the offer
 * rollup cache. A priced product with no live stock is SUPPLYABLE
 * ("tedarik edilebilir") rather than OUT_OF_STOCK — it can still be ordered,
 * just with a longer lead time. This is intentionally a catalog-local type
 * so it does not disturb the parts-based AvailabilityStatus in
 * lib/search/availability.ts.
 */
export type CatalogAvailability = 'IN_STOCK' | 'SUPPLYABLE' | 'UNAVAILABLE'

export function resolveCatalogAvailability(input: {
  hasPrice: boolean
  totalStockQty: number
}): CatalogAvailability {
  if (!input.hasPrice) return 'UNAVAILABLE'
  if (input.totalStockQty > 0) return 'IN_STOCK'
  return 'SUPPLYABLE'
}

export function decimalToNumber(
  value: Prisma.Decimal | number | string | null | undefined
): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Prisma.Decimal) {
    const n = Number(value.toString())
    return Number.isFinite(n) ? n : null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export interface CatalogPriceView {
  exVat: number | null
  incVat: number | null
  /** VAT-inclusive, formatted as tr-TR TRY. Null when there is no real price. */
  formatted: string | null
  formattedExVat: string | null
}

export function formatTry(value: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
}

export function buildCatalogPrice(
  exVat: Prisma.Decimal | number | string | null | undefined
): CatalogPriceView {
  const ex = decimalToNumber(exVat)
  if (ex == null) {
    return { exVat: null, incVat: null, formatted: null, formattedExVat: null }
  }
  const inc = ex * (1 + CATALOG_VAT_RATE)
  return {
    exVat: ex,
    incVat: inc,
    formatted: formatTry(inc),
    formattedExVat: formatTry(ex)
  }
}

/** Admin/override-aware display name: name_override wins over the raw name. */
export function resolveCatalogName(
  name: string,
  nameOverride: string | null | undefined
): string {
  const override = nameOverride?.trim()
  return override && override.length > 0 ? override : name
}

/** Canonical storefront detail URL for a catalog product. */
export function catalogProductHref(slug: string): string {
  return `/urun/${slug}`
}
