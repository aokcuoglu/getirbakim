import { stripLeadingBrandPrefix } from '@/lib/product-display-name'
import type { SearchHit } from '@/lib/types/search'
import type { V0DpmatchProductRow } from '@/lib/v0/types'

function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function decimalToString(value: number | null): string {
  if (value == null) return ''
  return value.toFixed(2)
}

function resolvePublicPriceAndPurchasability(options: {
  realPriceExVat: number | null
  stockQty: number
}): {
  resolvedPriceExVat: number | null
  stockQty: number
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
} {
  const { realPriceExVat, stockQty } = options
  if (realPriceExVat != null && realPriceExVat > 0) {
    return { resolvedPriceExVat: realPriceExVat, stockQty, priceSource: 'real', isPlaceholderPrice: false, isPurchasable: stockQty > 0 }
  }
  return { resolvedPriceExVat: null, stockQty, priceSource: 'placeholder', isPlaceholderPrice: true, isPurchasable: false }
}

function resolveAvailabilityStatus(options: {
  hasRealPrice: boolean
  availableStock: number
  hasSupplierOffer: boolean
  hasPartId: boolean
}): 'PURCHASABLE' | 'REQUEST_PRICE' | 'OUT_OF_STOCK' | 'VERIFY_FITMENT' {
  if (options.availableStock > 0 && options.hasRealPrice) return 'PURCHASABLE'
  if (options.hasSupplierOffer) return 'REQUEST_PRICE'
  return 'OUT_OF_STOCK'
}

function resolveCTA(availabilityStatus: string): 'add_to_cart' | 'request_price' | 'verify_fitment' | 'notify_or_request_price' {
  if (availabilityStatus === 'PURCHASABLE') return 'add_to_cart'
  if (availabilityStatus === 'REQUEST_PRICE') return 'request_price'
  return 'notify_or_request_price'
}

function resolveProductName(row: V0DpmatchProductRow, brandName: string): string {
  const rawName = row.ptTitle?.trim() || row.dinamikStockName?.trim() || row.dinamikStockCode?.trim() || row.ptModel?.trim() || 'Product'
  return stripLeadingBrandPrefix(rawName, brandName)
}

function collectOemCodes(row: V0DpmatchProductRow): string[] {
  return [row.dinamikPartNo, row.dinamikBarcode1, row.dinamikBarcode2, row.dinamikBarcode3, row.ptModel, row.normalized, row.dinamikStockCode]
    .filter((value): value is string => Boolean(value?.trim()))
}

function resolveBrandName(row: V0DpmatchProductRow): string {
  return row.matchedBrandName?.trim() || row.dinamikBrand?.trim() || row.ptManufacturerName?.trim() || 'Unknown'
}

export function mapDpmatchRowToSearchHit(row: V0DpmatchProductRow): SearchHit {
  const realPriceExVat = parsePrice(row.ptPrice ?? row.dinamikPrice)
  const pricing = resolvePublicPriceAndPurchasability({ realPriceExVat, stockQty: row.dinamikStockQty ?? 0 })
  const hasRealPrice = realPriceExVat != null
  const stockQty = pricing.stockQty
  const detailUrl = `/part/${row.matchId}`
  const availabilityStatus = resolveAvailabilityStatus({ hasRealPrice, availableStock: stockQty, hasSupplierOffer: hasRealPrice, hasPartId: false })
  const brandName = resolveBrandName(row)
  const name = resolveProductName(row, brandName)
  const image = row.ptImageUrl?.trim() || null
  const hitId = String(row.matchId)

  return {
    id: hitId,
    name,
    articleLinkId: row.dinamikStockCode?.trim() || row.ptRefNo?.trim() || hitId,
    dedupeKey: `v0-dpmatch:${row.matchId}`,
    price: decimalToString(pricing.resolvedPriceExVat),
    stockQty,
    priceSource: pricing.priceSource,
    isPlaceholderPrice: pricing.isPlaceholderPrice,
    isPurchasable: pricing.isPurchasable,
    inBasket: false,
    brandId: 0,
    brandName,
    brandLogo: row.brandLogoUrl,
    categoryId: 0,
    categoryName: null,
    categoryNameTr: null,
    oemCodes: collectOemCodes(row),
    oemBrands: [],
    vehicleTypes: [],
    vehicleIds: [],
    vehicleNames: [],
    formattedCompatibility: row.normalized ? [row.normalized] : [],
    searchableText: [name, brandName, row.dinamikStockCode, row.ptModel].filter(Boolean).join(' '),
    images: [{ image, thumb: image }],
    properties: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceType: 'supplier_product',
    providerCode: 'dinamik',
    supplierSku: row.dinamikStockCode,
    matchType: row.ptproductsId && row.dproductsId ? ('approved_oem_mapping' as const) : undefined,
    availabilityStatus,
    cta: resolveCTA(availabilityStatus),
    detailUrl,
    documentType: 'supplier_offer',
    matchStatus: 'APPROVED',
    matchReason: row.matchMethod,
    hasSupplierOffer: hasRealPrice,
    offerCount: hasRealPrice ? 1 : 0,
    referenceNumbers: row.ptRefNo?.trim() ? [row.ptRefNo.trim()] : []
  }
}

export function mapDpmatchRowsToSearchHits(rows: V0DpmatchProductRow[]): SearchHit[] {
  return rows.map(mapDpmatchRowToSearchHit)
}
