import { Prisma } from '@prisma/client'
import {
  decimalToString,
  resolvePublicPriceAndPurchasability
} from '@/lib/pricing/public-pricing'
import type {
  PartHero,
  PartMetadata,
  PartTabsData
} from '@/lib/actions/getPartById'
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

function resolveProductName(row: V0DpmatchProductRow): string {
  return (
    row.ptTitle?.trim() ||
    row.dinamikStockName?.trim() ||
    row.dinamikStockCode?.trim() ||
    row.ptModel?.trim() ||
    'Product'
  )
}

function resolveBrandName(row: V0DpmatchProductRow): string {
  return row.dinamikBrand?.trim() || row.ptManufacturerName?.trim() || 'Unknown'
}

function resolveArticleNumber(row: V0DpmatchProductRow): string | null {
  return row.dinamikStockCode?.trim() || row.ptRefNo?.trim() || null
}

function buildProperties(row: V0DpmatchProductRow): { key: string; value: string }[] {
  const properties: { key: string; value: string }[] = []

  if (row.dinamikStockCode?.trim()) {
    properties.push({ key: 'Stock Code', value: row.dinamikStockCode.trim() })
  }
  if (row.dinamikPartNo?.trim()) {
    properties.push({ key: 'Part No', value: row.dinamikPartNo.trim() })
  }
  if (row.ptModel?.trim()) {
    properties.push({ key: 'Model', value: row.ptModel.trim() })
  }
  if (row.part_no?.trim()) {
    properties.push({ key: 'Normalized', value: row.part_no.trim() })
  }
  if (row.matchMethod?.trim()) {
    properties.push({ key: 'Match Method', value: row.matchMethod.trim() })
  }

  return properties
}

function buildOems(row: V0DpmatchProductRow): { brand: string; code: string }[] {
  const brandName = resolveBrandName(row)
  const codes = [
    row.dinamikPartNo,
    row.dinamikBarcode1,
    row.dinamikBarcode2,
    row.dinamikBarcode3,
    row.ptRefNo,
    row.ptModel,
    row.part_no
  ].filter((value): value is string => Boolean(value?.trim()))

  const seen = new Set<string>()
  const oems: { brand: string; code: string }[] = []

  for (const code of codes) {
    const normalized = code.trim().toUpperCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    oems.push({ brand: brandName, code: code.trim() })
  }

  return oems
}

function buildCrossReferences(row: V0DpmatchProductRow) {
  const refs: {
    brandName: string
    articleNumber: string
    supplierProductId?: number | null
    partId?: number | null
  }[] = []

  if (row.dinamikStockCode?.trim() && row.dinamikBrand?.trim()) {
    refs.push({
      brandName: row.dinamikBrand.trim(),
      articleNumber: row.dinamikStockCode.trim()
    })
  }
  if (row.ptRefNo?.trim() && row.ptManufacturerName?.trim()) {
    refs.push({
      brandName: row.ptManufacturerName.trim(),
      articleNumber: row.ptRefNo.trim()
    })
  }

  return refs
}

function resolvePricing(row: V0DpmatchProductRow) {
  const realPriceExVat = parsePrice(row.ptPrice ?? row.dinamikPrice)
  return resolvePublicPriceAndPurchasability({
    realPriceExVat,
    stockQty: row.dinamikStockQty ?? 0
  })
}

export function mapDpmatchToPartHero(row: V0DpmatchProductRow): PartHero {
  const pricing = resolvePricing(row)
  const image = row.ptImageUrl?.trim() || null
  const name = resolveProductName(row)
  const brandName = resolveBrandName(row)

  return {
    id: row.matchId,
    name,
    articleNumber: resolveArticleNumber(row),
    price: decimalToString(pricing.resolvedPriceExVat),
    stockQty: pricing.stockQty,
    priceSource: pricing.priceSource,
    isPlaceholderPrice: pricing.isPlaceholderPrice,
    isPurchasable: pricing.isPurchasable,
    brand: {
      id: 0,
      name: brandName,
      logoUrl: row.brandLogoUrl
    },
    category: {
      id: 0,
      name: 'Auto Parts',
      urlKey: ''
    },
    images: image ? [{ image, thumb: image }] : [],
    properties: buildProperties(row),
    eans: [row.dinamikBarcode1, row.dinamikBarcode2, row.dinamikBarcode3]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim())
  }
}

export function mapDpmatchToPartMetadata(row: V0DpmatchProductRow): PartMetadata {
  const image = row.ptImageUrl?.trim() || null

  return {
    id: row.matchId,
    name: resolveProductName(row),
    brandName: resolveBrandName(row),
    categoryName: 'Auto Parts',
    imageUrl: image,
    eans: [row.dinamikBarcode1, row.dinamikBarcode2, row.dinamikBarcode3]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim())
  }
}

export function mapDpmatchToPartTabsData(
  row: V0DpmatchProductRow
): PartTabsData {
  const infos: string[] = []
  if (row.dinamikStockName?.trim()) {
    infos.push(row.dinamikStockName.trim())
  }
  if (row.ptTitle?.trim() && row.ptTitle.trim() !== resolveProductName(row)) {
    infos.push(row.ptTitle.trim())
  }

  return {
    properties: buildProperties(row),
    infos,
    oens: buildOems(row),
    crossReferences: buildCrossReferences(row),
    compatibleVehicles: []
  }
}
