import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  resolveAvailabilityStatus,
  resolveCTA,
  resolveDetailUrl,
  type AvailabilityStatus
} from './availability'
import { decimalToString } from '@/lib/pricing/public-pricing'

export type SearchDocumentAvailability =
  | 'PURCHASABLE'
  | 'REQUEST_PRICE'
  | 'VERIFY_FITMENT'
  | 'OUT_OF_STOCK'

export interface SearchDocument {
  id: string
  partId: string | null
  supplierProductId: number | null
  title: string
  brand: string | null
  supplierSku: string | null
  oemCodes: string[]
  eanCodes: string[]
  categorySlug: string | null
  categoryName: string | null
  price: number | null
  stockQty: number
  currency: string | null
  availabilityStatus: SearchDocumentAvailability
  cta: string
  providerName: string | null
  imageUrl: string | null
  detailUrl: string | null
  name: string
  brandName: string | null
  brandId: number | null
  categoryId: number | null
  articleLinkId: string
  hasPrice: boolean
  hasStock: boolean
  rankScore: number
  sourceType: 'part' | 'supplier_product'
  normalizedSearchText: string
  updatedAt: number
}

function normalizeSearchText(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^0-9a-z]+/g, ' ')
    .trim()
}

type SupplierRow = {
  sp_id: number
  sp_sku: string
  sp_brand: string | null
  sp_name: string | null
  sp_price: Prisma.Decimal | null
  sp_stock_qty: number
  sp_currency: string
  sp_image_url: string | null
  sp_supplier_name: string | null
  sp_normalized_name: string | null
  sp_barcode_1: string | null
  sp_barcode_2: string | null
  sp_barcode_3: string | null
  spm_part_id: bigint | null
  spm_match_reason: string | null
  spm_provider_id: number
  prv_code: string
  prv_name: string
  p_name: string | null
  p_article_link_id: bigint | null
  p_brand_id: number | null
  p_brand_name: string | null
  p_brand_logo_url: string | null
  p_category_id: number | null
  p_category_name: string | null
  p_category_url_key: string | null
  p_in_basket: boolean | null
  pi_computed_selling_price: Prisma.Decimal | null
  pi_supplier_price: Prisma.Decimal | null
  pi_supplier_stock_qty: number | null
  pi_reserved_stock_qty: number | null
  pi_currency: string | null
  ao_lock_price: boolean | null
  ao_selling_price_override: Prisma.Decimal | null
  part_price: Prisma.Decimal | null
  oem_codes: string[]
  ean_codes: string[]
}

type CatalogRow = {
  p_id: bigint
  p_name: string
  p_article_link_id: bigint
  p_in_basket: boolean
  p_brand_id: number
  p_brand_name: string
  p_brand_logo_url: string | null
  p_category_id: number
  p_category_name: string | null
  p_category_url_key: string | null
  p_price: Prisma.Decimal | null
  pi_supplier_price: Prisma.Decimal | null
  pi_computed_selling_price: Prisma.Decimal | null
  pi_supplier_stock_qty: number | null
  pi_reserved_stock_qty: number | null
  pi_currency: string | null
  pi_source_provider_id: number | null
  pi_source_supplier_product_id: number | null
  ao_lock_price: boolean | null
  ao_selling_price_override: Prisma.Decimal | null
  oem_codes: string[]
  ean_codes: string[]
  pi_count: number
}

export async function buildSearchDocumentsFromSupplier(
  limit: number = 50000
): Promise<{ documents: SearchDocument[]; total: number }> {
  const rows = await db.$queryRaw<SupplierRow[]>(Prisma.sql`
    SELECT
      sp.id AS sp_id,
      sp.supplier_sku AS sp_sku,
      sp.supplier_brand AS sp_brand,
      sp.supplier_name AS sp_name,
      sp.supplier_price AS sp_price,
      sp.supplier_stock_qty AS sp_stock_qty,
      sp.currency AS sp_currency,
      sp.image_url AS sp_image_url,
      sp.normalized_name AS sp_normalized_name,
      sp.barcode_1 AS sp_barcode_1,
      sp.barcode_2 AS sp_barcode_2,
      sp.barcode_3 AS sp_barcode_3,
      COALESCE(sp.supplier_name, prv.name) AS sp_supplier_name,
      spm.part_id AS spm_part_id,
      spm.match_reason AS spm_match_reason,
      spm.provider_id AS spm_provider_id,
      prv.code AS prv_code,
      prv.name AS prv_name,
      p.name AS p_name,
      p.article_link_id AS p_article_link_id,
      p.brand_id AS p_brand_id,
      pb.name AS p_brand_name,
      pb.logo_url AS p_brand_logo_url,
      p.category_id AS p_category_id,
      pc.name AS p_category_name,
      pc.url_key AS p_category_url_key,
      p.in_basket AS p_in_basket,
      pi.computed_selling_price_ex_vat AS pi_computed_selling_price,
      pi.supplier_price AS pi_supplier_price,
      pi.supplier_stock_qty AS pi_supplier_stock_qty,
      pi.reserved_stock_qty AS pi_reserved_stock_qty,
      pi.currency AS pi_currency,
      ao.lock_price AS ao_lock_price,
      ao.selling_price_override AS ao_selling_price_override,
      p.price AS part_price,
      COALESCE(
        (SELECT JSONB_AGG(sub.oem_code) FROM (
          SELECT spo.oem_code FROM supplier_product_oems spo
          WHERE spo.supplier_product_id = sp.id AND spo.is_active = true
          ORDER BY spo.updated_at DESC LIMIT 6
        ) sub), '[]'::jsonb
      ) AS oem_codes,
      COALESCE(
        (SELECT JSONB_AGG(pe.code)
         FROM part_eans pe
         WHERE pe.part_id = spm.part_id
         LIMIT 6), '[]'::jsonb
      ) AS ean_codes
    FROM supplier_products sp
    JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    JOIN supplier_providers prv ON prv.id = sp.provider_id AND prv.status = 'ACTIVE'
    LEFT JOIN parts p ON p.id = spm.part_id
    LEFT JOIN part_brands pb ON pb.id = p.brand_id
    LEFT JOIN part_categories pc ON pc.id = p.category_id
    LEFT JOIN part_pricing_inventory pi ON pi.part_id = p.id
    LEFT JOIN part_admin_overrides ao ON ao.part_id = p.id
    WHERE sp.supplier_stock_qty > 0 OR sp.supplier_price IS NOT NULL
    ORDER BY sp.supplier_stock_qty DESC, sp.last_seen_at DESC
    LIMIT ${limit}
  `)

  const documents: SearchDocument[] = rows.map((row) => {
    const partId = row.spm_part_id?.toString() ?? null
    const realPriceExVat =
      row.ao_lock_price && row.ao_selling_price_override
        ? row.ao_selling_price_override
        : row.pi_computed_selling_price ?? row.pi_supplier_price ?? row.part_price ?? row.sp_price
    const hasRealPrice = realPriceExVat != null
    const stockQty = Math.max(0, row.pi_supplier_stock_qty ?? row.sp_stock_qty ?? 0)
    const availableStock = Math.max(stockQty - (row.pi_reserved_stock_qty ?? 0), 0)
    const availability: SearchDocumentAvailability = resolveAvailabilityStatus({
      hasRealPrice,
      availableStock,
      hasSupplierOffer: true,
      hasPartId: Boolean(partId)
    })
    const cta = resolveCTA(availability)
    const detailUrl = resolveDetailUrl({
      partId,
      supplierProductId: row.sp_id
    })
    const brand = row.p_brand_name || row.sp_brand || null
    const name = row.p_name || row.sp_name || row.sp_sku
    const oemCodes = Array.isArray(row.oem_codes) ? row.oem_codes.slice(0, 12) : []
    const eanCodes = Array
      .isArray(row.ean_codes) ? row.ean_codes.slice(0, 12) : []
    const barcodes = [row.sp_barcode_1, row.sp_barcode_2, row.sp_barcode_3].filter(Boolean) as string[]
    const allEanCodes = Array.from(new Set([...eanCodes, ...barcodes])).slice(0, 12)

    const priceNumber = hasRealPrice
      ? Number(decimalToString(realPriceExVat))
      : null
    const priceSafe = priceNumber !== null && Number.isFinite(priceNumber) ? priceNumber : null

    const rankScore = availability === 'PURCHASABLE' ? 100 : availability === 'OUT_OF_STOCK' ? 50 : 25

    return {
      id: partId ? `part_${partId}` : `sp_${row.sp_id}`,
      partId,
      supplierProductId: row.sp_id,
      title: row.p_name || `${row.prv_code} ${row.sp_sku}`.trim(),
      brand,
      supplierSku: row.sp_sku,
      oemCodes,
      eanCodes: allEanCodes,
      categorySlug: row.p_category_url_key || null,
      categoryName: row.p_category_name || null,
      price: priceSafe,
      stockQty: availableStock,
      currency: row.pi_currency || row.sp_currency || 'TRY',
      availabilityStatus: availability,
      cta,
      providerName: row.prv_name || row.prv_code || null,
      imageUrl: row.sp_image_url || null,
      detailUrl,
      name,
      brandName: brand,
      brandId: row.p_brand_id ?? null,
      categoryId: row.p_category_id ?? null,
      articleLinkId: row.p_article_link_id?.toString() ?? row.sp_id.toString(),
      hasPrice: hasRealPrice,
      hasStock: availableStock > 0,
      rankScore,
      sourceType: 'supplier_product' as const,
      normalizedSearchText: normalizeSearchText(
        name, brand, row.sp_sku, row.p_category_name,
        ...oemCodes, ...allEanCodes, row.sp_normalized_name
      ),
      updatedAt: Date.now()
    }
  })

  return { documents, total: rows.length }
}

export async function buildSearchDocumentsFromCatalog(
  excludePartIds: Set<string>,
  limit: number = 30000
): Promise<{ documents: SearchDocument[]; total: number }> {
  const excludeIdList = excludePartIds.size > 0
    ? Array.from(excludePartIds).slice(0, 50000).map(id => BigInt(id))
    : []

  const excludeClause = excludeIdList.length > 0
    ? Prisma.sql`AND p.id NOT IN (${Prisma.join(excludeIdList)})`
    : Prisma.sql``

  const rows = await db.$queryRaw<CatalogRow[]>(Prisma.sql`
    SELECT
      p.id AS p_id,
      p.name AS p_name,
      p.article_link_id AS p_article_link_id,
      p.in_basket AS p_in_basket,
      p.brand_id AS p_brand_id,
      pb.name AS p_brand_name,
      pb.logo_url AS p_brand_logo_url,
      p.category_id AS p_category_id,
      pc.name AS p_category_name,
      pc.url_key AS p_category_url_key,
      p.price AS p_price,
      pi.supplier_price AS pi_supplier_price,
      pi.computed_selling_price_ex_vat AS pi_computed_selling_price,
      pi.supplier_stock_qty AS pi_supplier_stock_qty,
      pi.reserved_stock_qty AS pi_reserved_stock_qty,
      pi.currency AS pi_currency,
      pi.source_provider_id AS pi_source_provider_id,
      pi.source_supplier_product_id AS pi_source_supplier_product_id,
      ao.lock_price AS ao_lock_price,
      ao.selling_price_override AS ao_selling_price_override,
      COALESCE(
        (SELECT JSONB_AGG(po.code) FROM part_oens po WHERE po.part_id = p.id LIMIT 6),
        '[]'::jsonb
      ) AS oem_codes,
      COALESCE(
        (SELECT JSONB_AGG(pe.code) FROM part_eans pe WHERE pe.part_id = p.id LIMIT 6),
        '[]'::jsonb
      ) AS ean_codes,
      (SELECT COUNT(*) FROM supplier_part_mappings spm WHERE spm.part_id = p.id AND spm.status = 'APPROVED') AS pi_count
    FROM parts p
    JOIN part_brands pb ON pb.id = p.brand_id
    JOIN part_categories pc ON pc.id = p.category_id
    LEFT JOIN part_pricing_inventory pi ON pi.part_id = p.id
    LEFT JOIN part_admin_overrides ao ON ao.part_id = p.id
    WHERE p.id NOT IN (SELECT spm.part_id FROM supplier_part_mappings spm WHERE spm.part_id IS NOT NULL AND spm.status = 'APPROVED')
    ${excludeClause}
    ORDER BY p.updated_at DESC
    LIMIT ${limit}
  `)

  const documents: SearchDocument[] = rows.map((row) => {
    const partId = row.p_id.toString()
    const realPriceExVat =
      row.ao_lock_price && row.ao_selling_price_override
        ? row.ao_selling_price_override
        : row.pi_computed_selling_price ?? row.pi_supplier_price ?? row.p_price
    const hasRealPrice = realPriceExVat != null
    const stockQty = Math.max(0, row.pi_supplier_stock_qty ?? 0)
    const availableStock = Math.max(stockQty - (row.pi_reserved_stock_qty ?? 0), 0)
    const hasMapping = row.pi_count > 0
    const availability: SearchDocumentAvailability = resolveAvailabilityStatus({
      hasRealPrice,
      availableStock,
      hasSupplierOffer: hasMapping,
      hasPartId: true
    })
    const cta = resolveCTA(availability)
    const detailUrl = resolveDetailUrl({ partId })
    const oemCodes = Array.isArray(row.oem_codes) ? row.oem_codes.slice(0, 12) : []
    const eanCodes = Array.isArray(row.ean_codes) ? row.ean_codes.slice(0, 12) : []
    const priceNumber = hasRealPrice
      ? Number(decimalToString(realPriceExVat))
      : null
    const priceSafe = priceNumber !== null && Number.isFinite(priceNumber) ? priceNumber : null

    const rankScore = availability === 'PURCHASABLE' ? 100 : availability === 'OUT_OF_STOCK' ? 50 : 25

    return {
      id: `part_${partId}`,
      partId,
      supplierProductId: row.pi_source_supplier_product_id ?? null,
      title: row.p_name,
      brand: row.p_brand_name,
      supplierSku: null,
      oemCodes,
      eanCodes,
      categorySlug: row.p_category_url_key || null,
      categoryName: row.p_category_name || null,
      price: priceSafe,
      stockQty: availableStock,
      currency: row.pi_currency || 'TRY',
      availabilityStatus: availability,
      cta,
      providerName: null,
      imageUrl: null,
      detailUrl,
      name: row.p_name,
      brandName: row.p_brand_name,
      brandId: row.p_brand_id,
      categoryId: row.p_category_id,
      articleLinkId: row.p_article_link_id.toString(),
      hasPrice: hasRealPrice,
      hasStock: availableStock > 0,
      rankScore,
      sourceType: 'part' as const,
      normalizedSearchText: normalizeSearchText(
        row.p_name, row.p_brand_name, row.p_category_name,
        ...oemCodes, ...eanCodes
      ),
      updatedAt: Date.now()
    }
  })

  return { documents, total: rows.length }
}

export async function buildAllSearchDocumentsPaginated(
  batchSize: number = 1000,
  onBatch?: (docs: SearchDocument[], offset: number, total: number) => Promise<void>
): Promise<{ supplierCount: number; catalogCount: number; totalCount: number }> {
  const supplierResult = await buildSearchDocumentsFromSupplier(50000)
  if (onBatch) {
    await onBatch(supplierResult.documents, 0, supplierResult.total)
  }

  const supplierPartIds = new Set(
    supplierResult.documents
      .map((d) => d.partId)
      .filter((id): id is string => id !== null)
  )

  const catalogResult = await buildSearchDocumentsFromCatalog(supplierPartIds, 30000)
  if (onBatch) {
    await onBatch(catalogResult.documents, supplierResult.total, catalogResult.total)
  }

  return {
    supplierCount: supplierResult.total,
    catalogCount: catalogResult.total,
    totalCount: supplierResult.total + catalogResult.total
  }
}