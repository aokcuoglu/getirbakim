import { Prisma } from '@prisma/client'
import {
  decimalToString,
  resolvePublicPriceAndPurchasability
} from '@/lib/pricing/public-pricing'
import { stripLeadingBrandPrefix } from '@/lib/product-display-name'
import {
  resolveAvailabilityStatus,
  resolveCTA
} from '@/lib/search/availability'
import type { SearchHit } from '@/lib/types/search'
import type { V0DpmatchProductRow } from '@/lib/v0/types'

function parsePrice(value: string | null | undefined): Prisma.Decimal | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  try {
    return new Prisma.Decimal(parsed)
  } catch {
    return null
  }
}

function resolveProductName(row: V0DpmatchProductRow, brandName: string): string {
  const rawName =
    row.ptTitle?.trim() ||
    row.dinamikStockName?.trim() ||
    row.dinamikStockCode?.trim() ||
    row.ptModel?.trim() ||
    'Product'

  return stripLeadingBrandPrefix(rawName, brandName)
}

function collectOemCodes(row: V0DpmatchProductRow): string[] {
  return [
    row.dinamikPartNo,
    row.dinamikBarcode1,
    row.dinamikBarcode2,
    row.dinamikBarcode3,
    row.ptModel,
    row.part_no,
    row.dinamikStockCode
  ].filter((value): value is string => Boolean(value?.trim()))
}

function resolveBrandName(row: V0DpmatchProductRow): string {
  return (
    row.matchedBrandName?.trim() ||
    row.dinamikBrand?.trim() ||
    row.ptManufacturerName?.trim() ||
    'Unknown'
  )
}

function resolveV0DpmatchDetailUrl(row: V0DpmatchProductRow): string {
  return `/part/${row.matchId}`
}

export function mapDpmatchRowToSearchHit(row: V0DpmatchProductRow): SearchHit {
  const realPriceExVat = parsePrice(row.ptPrice ?? row.dinamikPrice)
  const pricing = resolvePublicPriceAndPurchasability({
    realPriceExVat,
    stockQty: row.dinamikStockQty ?? 0
  })
  const hasRealPrice = realPriceExVat != null
  const stockQty = pricing.stockQty
  const detailUrl = resolveV0DpmatchDetailUrl(row)
  const availabilityStatus = resolveAvailabilityStatus({
    hasRealPrice,
    availableStock: stockQty,
    hasSupplierOffer: hasRealPrice,
    hasPartId: false
  })

  const brandName = resolveBrandName(row)

  const name = resolveProductName(row, brandName)

  const image = row.ptImageUrl?.trim() || null
  const hitId = String(row.matchId)

  return {
    id: hitId,
    name,
    articleLinkId:
      row.dinamikStockCode?.trim() ||
      row.ptRefNo?.trim() ||
      hitId,
    dedupeKey: `v0-dpprd:${row.matchId}`,
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
    formattedCompatibility: row.part_no ? [row.part_no] : [],
    searchableText: [name, brandName, row.dinamikStockCode, row.ptModel]
      .filter(Boolean)
      .join(' '),
    images: [{ image, thumb: image }],
    properties: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceType: 'supplier_product',
    providerCode: 'dinamik',
    supplierSku: row.dinamikStockCode,
    matchType: row.ptprdId && row.dnprdId ? 'approved_oem_mapping' : undefined,
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
