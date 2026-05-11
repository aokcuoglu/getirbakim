import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  resolveAvailabilityStatus,
  resolveCTA,
  resolveDetailUrl,
  type AvailabilityStatus
} from './availability'
import { decimalToString } from '@/lib/pricing/public-pricing'
import {
  type CanonicalSearchDocument,
  type DocumentType,
  type MatchStatus,
  type SearchDocumentAvailability,
  MAX_OEM_CODES,
  MAX_EAN_CODES,
  MAX_CROSS_REFERENCES,
  MAX_REFERENCE_NUMBERS,
  MAX_VEHICLE_FIELDS,
  MAX_ENGINE_CODES,
  MAX_SEARCH_KEYWORDS
} from './search-document-types'
import { buildSynonymsText } from './search-synonyms'

export type { SearchDocumentAvailability }
export type { CanonicalSearchDocument as SearchDocument }
export type { DocumentType }
export type { MatchStatus }

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

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    've', 'and', 'ile', 'for', 'icin', 'bir', 'the', 'a', 'an',
    'of', 'da', 'de', 'li', 'lu', 'su', 'set', 'kit'
  ])
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^0-9a-z]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w))
  return [...new Set(words)].slice(0, MAX_SEARCH_KEYWORDS)
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
  sp_normalized_name: string | null
  sp_barcode_1: string | null
  sp_barcode_2: string | null
  sp_barcode_3: string | null
  spm_part_id: bigint | null
  spm_match_reason: string | null
  spm_confidence: Prisma.Decimal | null
  spm_status: string | null
  spm_is_manual: boolean | null
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
  p_category_name_tr: string | null
  p_category_url_key: string | null
  p_in_basket: boolean | null
  pi_computed_selling_price: Prisma.Decimal | null
  pi_supplier_price: Prisma.Decimal | null
  pi_supplier_stock_qty: number | null
  pi_reserved_stock_qty: number | null
  pi_currency: string | null
  pi_source_provider_id: number | null
  pi_source_supplier_product_id: number | null
  ao_lock_price: boolean | null
  ao_selling_price_override: Prisma.Decimal | null
  part_price: Prisma.Decimal | null
  oem_codes: string[]
  ean_codes: string[]
  cross_refs: string[]
  ref_numbers: string[]
  offer_count: number
  best_provider_name: string | null
  best_offer_sp_id: number | null
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
  p_category_name_tr: string | null
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
  cross_refs: string[]
  ref_numbers: string[]
  offer_count: number
  best_provider_name: string | null
  best_offer_sp_id: number | null
  vehicle_brand_names: string[]
  vehicle_model_names: string[]
  vehicle_type_names: string[]
  vehicle_years: string[]
  engine_codes: string[]
  fitment_count: number
}

export async function buildSearchDocumentsFromSupplier(
  limit: number = 50000
): Promise<{ documents: CanonicalSearchDocument[]; total: number }> {
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
      spm.part_id AS spm_part_id,
      spm.match_reason AS spm_match_reason,
      spm.confidence AS spm_confidence,
      spm.status AS spm_status,
      spm.is_manual AS spm_is_manual,
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
      pc.name_tr AS p_category_name_tr,
      pc.url_key AS p_category_url_key,
      p.in_basket AS p_in_basket,
      pi.computed_selling_price_ex_vat AS pi_computed_selling_price,
      pi.supplier_price AS pi_supplier_price,
      pi.supplier_stock_qty AS pi_supplier_stock_qty,
      pi.reserved_stock_qty AS pi_reserved_stock_qty,
      pi.currency AS pi_currency,
      pi.source_provider_id AS pi_source_provider_id,
      pi.source_supplier_product_id AS pi_source_supplier_product_id,
      ao.lock_price AS ao_lock_price,
      ao.selling_price_override AS ao_selling_price_override,
      p.price AS part_price,
      COALESCE(
        (SELECT JSONB_AGG(sub.oem_code) FROM (
          SELECT spo.oem_code FROM supplier_product_oems spo
          WHERE spo.supplier_product_id = sp.id AND spo.is_active = true
          ORDER BY spo.updated_at DESC LIMIT ${MAX_OEM_CODES}
        ) sub), '[]'::jsonb
      ) AS oem_codes,
      COALESCE(
        (SELECT JSONB_AGG(pe.code)
         FROM part_eans pe
         WHERE pe.part_id = spm.part_id
         LIMIT ${MAX_EAN_CODES}), '[]'::jsonb
      ) AS ean_codes,
      COALESCE(
        (SELECT JSONB_AGG(sub.article_number) FROM (
          SELECT pcr.article_number FROM part_cross_references pcr
          WHERE pcr.part_id = spm.part_id
          ORDER BY pcr.id LIMIT ${MAX_CROSS_REFERENCES}
        ) sub), '[]'::jsonb
      ) AS cross_refs,
      COALESCE(
        (SELECT JSONB_AGG(sub.article_number) FROM (
          SELECT pcr.article_number FROM part_cross_references pcr
          WHERE pcr.part_id = spm.part_id AND pcr.brand_name = pb.name
          ORDER BY pcr.id LIMIT ${MAX_REFERENCE_NUMBERS}
        ) sub), '[]'::jsonb
      ) AS ref_numbers,
      (SELECT COUNT(*) FROM part_supplier_offers pso2
       WHERE pso2.part_id = spm.part_id AND pso2.is_active = true) AS offer_count,
      (SELECT prv2.name FROM part_supplier_offers pso2
       JOIN supplier_providers prv2 ON prv2.id = pso2.provider_id
       WHERE pso2.part_id = spm.part_id AND pso2.is_active = true
       ORDER BY pso2.supplier_stock_qty DESC, pso2.supplier_price ASC
       LIMIT 1) AS best_provider_name,
      (SELECT pso2.supplier_product_id FROM part_supplier_offers pso2
       WHERE pso2.part_id = spm.part_id AND pso2.is_active = true
       ORDER BY pso2.supplier_stock_qty DESC, pso2.supplier_price ASC
       LIMIT 1) AS best_offer_sp_id
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

  const documents: CanonicalSearchDocument[] = rows.map((row) => {
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
    const oemCodes = Array.isArray(row.oem_codes) ? row.oem_codes.slice(0, MAX_OEM_CODES) : []
    const eanCodes = Array.isArray(row.ean_codes)
      ? row.ean_codes.slice(0, MAX_EAN_CODES)
      : []
    const barcodes = [row.sp_barcode_1, row.sp_barcode_2, row.sp_barcode_3].filter(Boolean) as string[]
    const allEanCodes = Array.from(new Set([...eanCodes, ...barcodes])).slice(0, MAX_EAN_CODES)
    const crossReferences = Array.isArray(row.cross_refs)
      ? row.cross_refs.slice(0, MAX_CROSS_REFERENCES)
      : []
    const referenceNumbers = Array.isArray(row.ref_numbers)
      ? row.ref_numbers.slice(0, MAX_REFERENCE_NUMBERS)
      : []

    const priceNumber = hasRealPrice ? Number(decimalToString(realPriceExVat)) : null
    const priceSafe = priceNumber !== null && Number.isFinite(priceNumber) ? priceNumber : null

    const matchStatus: MatchStatus = row.spm_status === 'APPROVED' ? 'APPROVED' : row.spm_is_manual ? 'MANUAL' : row.spm_status === 'CANDIDATE' ? 'CANDIDATE' : 'QUEUE'

    const rankScore = computeRankScore(availability, Boolean(partId), row.offer_count)

    const synonyms = buildSynonymsText({
      categoryName: row.p_category_name,
      title: name
    })

    const normalizedText = normalizeSearchText(
      name, brand, row.sp_sku, row.p_category_name,
      row.p_category_name_tr,
      ...oemCodes, ...allEanCodes, ...crossReferences,
      row.sp_normalized_name, synonyms
    )

    const keywords = extractKeywords(normalizedText)

    return {
      id: partId ? `part_${partId}` : `sp_${row.sp_id}`,
      documentType: 'supplier_offer' as DocumentType,
      partId,
      supplierProductId: row.sp_id,
      canonicalPartId: partId,
      title: row.p_name || `${row.prv_code} ${row.sp_sku}`.trim(),
      titleTr: null,
      brand,
      categoryId: row.p_category_id ?? null,
      categoryName: row.p_category_name || null,
      categoryNameTr: row.p_category_name_tr || null,
      categorySlug: row.p_category_url_key || null,
      supplierSku: row.sp_sku,
      providerCode: row.prv_code || null,
      providerName: row.prv_name || row.prv_code || null,
      oemCodes,
      eanCodes: allEanCodes,
      crossReferences,
      referenceNumbers,
      normalizedSearchText: normalizedText,
      searchKeywords: keywords,
      synonymsText: synonyms,
      price: priceSafe,
      stockQty: availableStock,
      currency: row.pi_currency || row.sp_currency || 'TRY',
      hasPrice: hasRealPrice,
      hasStock: availableStock > 0,
      hasSupplierOffer: true,
      offerCount: Number(row.offer_count) || 1,
      bestOfferProvider: row.best_provider_name || row.prv_name || null,
      bestOfferSupplierProductId: row.best_offer_sp_id || row.sp_id,
      availabilityStatus: availability,
      cta,
      matchStatus,
      matchConfidence: row.spm_confidence ? Number(row.spm_confidence) : null,
      matchReason: row.spm_match_reason || null,
      vehicleBrandNames: [],
      vehicleModelNames: [],
      vehicleTypeNames: [],
      vehicleYears: [],
      engineCodes: [],
      fitmentCount: 0,
      detailUrl,
      imageUrl: row.sp_image_url || null,
      updatedAt: Date.now(),
      rankScore,
      name,
      brandName: brand,
      brandId: row.p_brand_id ?? null,
      articleLinkId: row.p_article_link_id?.toString() ?? row.sp_id.toString(),
      sourceType: 'supplier_product' as const
    }
  })

  return { documents, total: rows.length }
}

export async function buildSearchDocumentsFromCatalog(
  excludePartIds: Set<string>,
  limit: number = 30000,
  options?: { includeFitment?: boolean }
): Promise<{ documents: CanonicalSearchDocument[]; total: number }> {
  const excludeIdList = excludePartIds.size > 0
    ? Array.from(excludePartIds).slice(0, 50000).map(id => BigInt(id))
    : []

  const excludeClause = excludeIdList.length > 0
    ? Prisma.sql`AND p.id NOT IN (${Prisma.join(excludeIdList)})`
    : Prisma.sql``

  const includeFitment = options?.includeFitment ?? (process.env.MEILI_REINDEX_INCLUDE_FITMENT !== 'false')

  if (includeFitment) {
    return buildCatalogDocumentsWithFitment(excludeClause, limit)
  }
  return buildCatalogDocumentsWithoutFitment(excludeClause, limit)
}

async function buildCatalogDocumentsWithFitment(
  excludeClause: Prisma.Sql,
  limit: number
): Promise<{ documents: CanonicalSearchDocument[]; total: number }> {
  const FITMENT_LIMIT = parseInt(process.env.MEILI_REINDEX_FITMENT_LIMIT_PER_PART || '50', 10)

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
      pc.name_tr AS p_category_name_tr,
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
        (SELECT JSONB_AGG(po.code) FROM part_oens po WHERE po.part_id = p.id LIMIT ${MAX_OEM_CODES}),
        '[]'::jsonb
      ) AS oem_codes,
      COALESCE(
        (SELECT JSONB_AGG(pe.code) FROM part_eans pe WHERE pe.part_id = p.id LIMIT ${MAX_EAN_CODES}),
        '[]'::jsonb
      ) AS ean_codes,
      COALESCE(
        (SELECT JSONB_AGG(sub.article_number) FROM (
          SELECT pcr.article_number FROM part_cross_references pcr
          WHERE pcr.part_id = p.id
          ORDER BY pcr.id LIMIT ${MAX_CROSS_REFERENCES}
        ) sub), '[]'::jsonb
      ) AS cross_refs,
      COALESCE(
        (SELECT JSONB_AGG(sub.article_number) FROM (
          SELECT pcr.article_number FROM part_cross_references pcr
          WHERE pcr.part_id = p.id AND pcr.brand_name = pb.name
          ORDER BY pcr.id LIMIT ${MAX_REFERENCE_NUMBERS}
        ) sub), '[]'::jsonb
      ) AS ref_numbers,
      (SELECT COUNT(*) FROM part_supplier_offers pso WHERE pso.part_id = p.id AND pso.is_active = true) AS offer_count,
      (SELECT prv2.name FROM part_supplier_offers pso2
       JOIN supplier_providers prv2 ON prv2.id = pso2.provider_id
       WHERE pso2.part_id = p.id AND pso2.is_active = true
       ORDER BY pso2.supplier_stock_qty DESC, pso2.supplier_price ASC
       LIMIT 1) AS best_provider_name,
      (SELECT pso2.supplier_product_id FROM part_supplier_offers pso2
       WHERE pso2.part_id = p.id AND pso2.is_active = true
       ORDER BY pso2.supplier_stock_qty DESC, pso2.supplier_price ASC
       LIMIT 1) AS best_offer_sp_id,
      COALESCE(
        (SELECT JSONB_AGG(DISTINCT vb.name) FROM (
          SELECT DISTINCT vb2.name FROM part_vehicle_types pvt2
          JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
          JOIN vehicle_models vm2 ON vm2.id = vt2.model_id
          JOIN vehicle_brands vb2 ON vb2.id = vm2.brand_id
          WHERE pvt2.part_id = p.id
          LIMIT ${MAX_VEHICLE_FIELDS}
        ) vb), '[]'::jsonb
      ) AS vehicle_brand_names,
      COALESCE(
        (SELECT JSONB_AGG(DISTINCT vm.name) FROM (
          SELECT DISTINCT vm2.name FROM part_vehicle_types pvt2
          JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
          JOIN vehicle_models vm2 ON vm2.id = vt2.model_id
          WHERE pvt2.part_id = p.id
          LIMIT ${MAX_VEHICLE_FIELDS}
        ) vm), '[]'::jsonb
      ) AS vehicle_model_names,
      COALESCE(
        (SELECT JSONB_AGG(DISTINCT vt.name) FROM (
          SELECT DISTINCT vt2.name FROM part_vehicle_types pvt2
          JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
          WHERE pvt2.part_id = p.id
          LIMIT ${MAX_VEHICLE_FIELDS}
        ) vt), '[]'::jsonb
      ) AS vehicle_type_names,
      COALESCE(
        (SELECT JSONB_AGG(DISTINCT vy.year) FROM (
          SELECT DISTINCT COALESCE(vt2.year_of_constr_from, vt2.year_of_constr_to) AS year
          FROM part_vehicle_types pvt2
          JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
          WHERE pvt2.part_id = p.id AND vt2.year_of_constr_from IS NOT NULL
          LIMIT ${MAX_VEHICLE_FIELDS}
        ) vy), '[]'::jsonb
      ) AS vehicle_years,
      COALESCE(
        (SELECT JSONB_AGG(DISTINCT vtm.motor_type) FROM (
          SELECT DISTINCT vtm2.motor_type FROM part_vehicle_types pvt2
          JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
          LEFT JOIN vehicle_type_modifications vtm2 ON vtm2.vehicle_type_id = vt2.id
          WHERE pvt2.part_id = p.id AND vtm2.motor_type IS NOT NULL
          LIMIT ${MAX_ENGINE_CODES}
        ) vtm), '[]'::jsonb
      ) AS engine_codes,
      (SELECT COUNT(*) FROM part_vehicle_types pvt WHERE pvt.part_id = p.id) AS fitment_count
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

  return { documents: rows.map(mapCatalogRow), total: rows.length }
}

async function buildCatalogDocumentsWithoutFitment(
  excludeClause: Prisma.Sql,
  limit: number
): Promise<{ documents: CanonicalSearchDocument[]; total: number }> {
  type CatalogRowNoFitment = {
    p_id: bigint
    p_name: string
    p_article_link_id: bigint
    p_in_basket: boolean
    p_brand_id: number
    p_brand_name: string
    p_brand_logo_url: string | null
    p_category_id: number
    p_category_name: string | null
    p_category_name_tr: string | null
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
    cross_refs: string[]
    ref_numbers: string[]
    offer_count: number
    best_provider_name: string | null
    best_offer_sp_id: number | null
  }

  const rows = await db.$queryRaw<CatalogRowNoFitment[]>(Prisma.sql`
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
      pc.name_tr AS p_category_name_tr,
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
        (SELECT JSONB_AGG(po.code) FROM part_oens po WHERE po.part_id = p.id LIMIT ${MAX_OEM_CODES}),
        '[]'::jsonb
      ) AS oem_codes,
      COALESCE(
        (SELECT JSONB_AGG(pe.code) FROM part_eans pe WHERE pe.part_id = p.id LIMIT ${MAX_EAN_CODES}),
        '[]'::jsonb
      ) AS ean_codes,
      COALESCE(
        (SELECT JSONB_AGG(sub.article_number) FROM (
          SELECT pcr.article_number FROM part_cross_references pcr
          WHERE pcr.part_id = p.id
          ORDER BY pcr.id LIMIT ${MAX_CROSS_REFERENCES}
        ) sub), '[]'::jsonb
      ) AS cross_refs,
      COALESCE(
        (SELECT JSONB_AGG(sub.article_number) FROM (
          SELECT pcr.article_number FROM part_cross_references pcr
          WHERE pcr.part_id = p.id AND pcr.brand_name = pb.name
          ORDER BY pcr.id LIMIT ${MAX_REFERENCE_NUMBERS}
        ) sub), '[]'::jsonb
      ) AS ref_numbers,
      (SELECT COUNT(*) FROM part_supplier_offers pso WHERE pso.part_id = p.id AND pso.is_active = true) AS offer_count,
      (SELECT prv2.name FROM part_supplier_offers pso2
       JOIN supplier_providers prv2 ON prv2.id = pso2.provider_id
       WHERE pso2.part_id = p.id AND pso2.is_active = true
       ORDER BY pso2.supplier_stock_qty DESC, pso2.supplier_price ASC
       LIMIT 1) AS best_provider_name,
      (SELECT pso2.supplier_product_id FROM part_supplier_offers pso2
       WHERE pso2.part_id = p.id AND pso2.is_active = true
       ORDER BY pso2.supplier_stock_qty DESC, pso2.supplier_price ASC
       LIMIT 1) AS best_offer_sp_id
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

  const documents: CanonicalSearchDocument[] = rows.map((row) => {
    const partId = row.p_id.toString()
    const realPriceExVat =
      row.ao_lock_price && row.ao_selling_price_override
        ? row.ao_selling_price_override
        : row.pi_computed_selling_price ?? row.pi_supplier_price ?? row.p_price
    const hasRealPrice = realPriceExVat != null
    const stockQty = Math.max(0, row.pi_supplier_stock_qty ?? 0)
    const availableStock = Math.max(stockQty - (row.pi_reserved_stock_qty ?? 0), 0)
    const hasMapping = row.offer_count > 0
    const availability: SearchDocumentAvailability = resolveAvailabilityStatus({
      hasRealPrice,
      availableStock,
      hasSupplierOffer: hasMapping,
      hasPartId: true
    })
    const cta = resolveCTA(availability)
    const detailUrl = resolveDetailUrl({ partId })
    const oemCodes = Array.isArray(row.oem_codes) ? row.oem_codes.slice(0, MAX_OEM_CODES) : []
    const eanCodes = Array.isArray(row.ean_codes) ? row.ean_codes.slice(0, MAX_EAN_CODES) : []
    const crossReferences = Array.isArray(row.cross_refs)
      ? row.cross_refs.slice(0, MAX_CROSS_REFERENCES)
      : []
    const referenceNumbers = Array.isArray(row.ref_numbers)
      ? row.ref_numbers.slice(0, MAX_REFERENCE_NUMBERS)
      : []
    const priceNumber = hasRealPrice ? Number(decimalToString(realPriceExVat)) : null
    const priceSafe = priceNumber !== null && Number.isFinite(priceNumber) ? priceNumber : null

    const matchStatus: MatchStatus = hasMapping ? 'APPROVED' : 'UNMAPPED'
    const rankScore = computeRankScore(availability, true, Number(row.offer_count))

    const synonyms = buildSynonymsText({
      categoryName: row.p_category_name,
      title: row.p_name
    })

    const normalizedText = normalizeSearchText(
      row.p_name, row.p_brand_name, row.p_category_name,
      row.p_category_name_tr,
      ...oemCodes, ...eanCodes, ...crossReferences,
      synonyms
    )

    const keywords = extractKeywords(normalizedText)

    return {
      id: `part_${partId}`,
      documentType: 'canonical_part' as DocumentType,
      partId,
      supplierProductId: row.pi_source_supplier_product_id ?? null,
      canonicalPartId: partId,
      title: row.p_name,
      titleTr: null,
      brand: row.p_brand_name,
      categoryId: row.p_category_id,
      categoryName: row.p_category_name || null,
      categoryNameTr: row.p_category_name_tr || null,
      categorySlug: row.p_category_url_key || null,
      supplierSku: null,
      providerCode: null,
      providerName: row.best_provider_name || null,
      oemCodes,
      eanCodes,
      crossReferences,
      referenceNumbers,
      normalizedSearchText: normalizedText,
      searchKeywords: keywords,
      synonymsText: synonyms,
      price: priceSafe,
      stockQty: availableStock,
      currency: row.pi_currency || 'TRY',
      hasPrice: hasRealPrice,
      hasStock: availableStock > 0,
      hasSupplierOffer: hasMapping,
      offerCount: Number(row.offer_count) || 0,
      bestOfferProvider: row.best_provider_name || null,
      bestOfferSupplierProductId: row.best_offer_sp_id || null,
      availabilityStatus: availability,
      cta,
      matchStatus,
      matchConfidence: null,
      matchReason: null,
      vehicleBrandNames: [],
      vehicleModelNames: [],
      vehicleTypeNames: [],
      vehicleYears: [],
      engineCodes: [],
      fitmentCount: 0,
      detailUrl,
      imageUrl: null,
      updatedAt: Date.now(),
      rankScore,
      name: row.p_name,
      brandName: row.p_brand_name,
      brandId: row.p_brand_id,
      articleLinkId: row.p_article_link_id.toString(),
      sourceType: 'part' as const
    }
  })

  return { documents, total: rows.length }
}

function mapCatalogRow(row: CatalogRow): CanonicalSearchDocument {
    const partId = row.p_id.toString()
    const realPriceExVat =
      row.ao_lock_price && row.ao_selling_price_override
        ? row.ao_selling_price_override
        : row.pi_computed_selling_price ?? row.pi_supplier_price ?? row.p_price
    const hasRealPrice = realPriceExVat != null
    const stockQty = Math.max(0, row.pi_supplier_stock_qty ?? 0)
    const availableStock = Math.max(stockQty - (row.pi_reserved_stock_qty ?? 0), 0)
    const hasMapping = row.offer_count > 0
    const availability: SearchDocumentAvailability = resolveAvailabilityStatus({
      hasRealPrice,
      availableStock,
      hasSupplierOffer: hasMapping,
      hasPartId: true
    })
    const cta = resolveCTA(availability)
    const detailUrl = resolveDetailUrl({ partId })
    const oemCodes = Array.isArray(row.oem_codes) ? row.oem_codes.slice(0, MAX_OEM_CODES) : []
    const eanCodes = Array.isArray(row.ean_codes) ? row.ean_codes.slice(0, MAX_EAN_CODES) : []
    const crossReferences = Array.isArray(row.cross_refs)
      ? row.cross_refs.slice(0, MAX_CROSS_REFERENCES)
      : []
    const referenceNumbers = Array.isArray(row.ref_numbers)
      ? row.ref_numbers.slice(0, MAX_REFERENCE_NUMBERS)
      : []
    const priceNumber = hasRealPrice ? Number(decimalToString(realPriceExVat)) : null
    const priceSafe = priceNumber !== null && Number.isFinite(priceNumber) ? priceNumber : null

    const matchStatus: MatchStatus = hasMapping ? 'APPROVED' : 'UNMAPPED'
    const rankScore = computeRankScore(availability, true, Number(row.offer_count))

    const vehicleBrandNames = Array.isArray(row.vehicle_brand_names)
      ? row.vehicle_brand_names.slice(0, MAX_VEHICLE_FIELDS)
      : []
    const vehicleModelNames = Array.isArray(row.vehicle_model_names)
      ? row.vehicle_model_names.slice(0, MAX_VEHICLE_FIELDS)
      : []
    const vehicleTypeNames = Array.isArray(row.vehicle_type_names)
      ? row.vehicle_type_names.slice(0, MAX_VEHICLE_FIELDS)
      : []
    const vehicleYears = Array.isArray(row.vehicle_years)
      ? row.vehicle_years.slice(0, MAX_VEHICLE_FIELDS)
      : []
    const engineCodes = Array.isArray(row.engine_codes)
      ? row.engine_codes.slice(0, MAX_ENGINE_CODES)
      : []

    const synonyms = buildSynonymsText({
      categoryName: row.p_category_name,
      title: row.p_name
    })

    const normalizedText = normalizeSearchText(
      row.p_name, row.p_brand_name, row.p_category_name,
      row.p_category_name_tr,
      ...oemCodes, ...eanCodes, ...crossReferences,
      ...vehicleBrandNames, ...vehicleModelNames, ...vehicleTypeNames,
      ...engineCodes,
      synonyms
    )

    const keywords = extractKeywords(normalizedText)

    return {
      id: `part_${partId}`,
      documentType: 'canonical_part' as DocumentType,
      partId,
      supplierProductId: row.pi_source_supplier_product_id ?? null,
      canonicalPartId: partId,
      title: row.p_name,
      titleTr: null,
      brand: row.p_brand_name,
      categoryId: row.p_category_id,
      categoryName: row.p_category_name || null,
      categoryNameTr: row.p_category_name_tr || null,
      categorySlug: row.p_category_url_key || null,
      supplierSku: null,
      providerCode: null,
      providerName: row.best_provider_name || null,
      oemCodes,
      eanCodes,
      crossReferences,
      referenceNumbers,
      normalizedSearchText: normalizedText,
      searchKeywords: keywords,
      synonymsText: synonyms,
      price: priceSafe,
      stockQty: availableStock,
      currency: row.pi_currency || 'TRY',
      hasPrice: hasRealPrice,
      hasStock: availableStock > 0,
      hasSupplierOffer: hasMapping,
      offerCount: Number(row.offer_count) || 0,
      bestOfferProvider: row.best_provider_name || null,
      bestOfferSupplierProductId: row.best_offer_sp_id || null,
      availabilityStatus: availability,
      cta,
      matchStatus,
      matchConfidence: null,
      matchReason: null,
      vehicleBrandNames,
      vehicleModelNames,
      vehicleTypeNames,
      vehicleYears,
      engineCodes,
      fitmentCount: Number(row.fitment_count) || 0,
      detailUrl,
      imageUrl: null,
      updatedAt: Date.now(),
      rankScore,
      name: row.p_name,
      brandName: row.p_brand_name,
      brandId: row.p_brand_id,
      articleLinkId: row.p_article_link_id.toString(),
      sourceType: 'part' as const
    }
  }

type OrphanRow = {
  sp_id: number
  sp_provider_id: number
  sp_sku: string
  sp_brand: string | null
  sp_name: string | null
  sp_normalized_name: string | null
  sp_barcode_1: string | null
  sp_barcode_2: string | null
  sp_barcode_3: string | null
  sp_price: Prisma.Decimal | null
  sp_stock_qty: number
  sp_currency: string
  sp_image_url: string | null
  prv_code: string
  prv_name: string
  oem_codes: string[]
}

export async function buildOrphanSupplierDocuments(
  limit: number = 10000,
  offset: number = 0
): Promise<{ documents: CanonicalSearchDocument[]; total: number }> {
  const rows = await db.$queryRaw<OrphanRow[]>(Prisma.sql`
    SELECT
      sp.id AS sp_id,
      sp.provider_id AS sp_provider_id,
      sp.supplier_sku AS sp_sku,
      sp.supplier_brand AS sp_brand,
      sp.supplier_name AS sp_name,
      sp.normalized_sku AS sp_normalized_name,
      sp.barcode_1 AS sp_barcode_1,
      sp.barcode_2 AS sp_barcode_2,
      sp.barcode_3 AS sp_barcode_3,
      sp.supplier_price AS sp_price,
      sp.supplier_stock_qty AS sp_stock_qty,
      sp.currency AS sp_currency,
      sp.image_url AS sp_image_url,
      prv.code AS prv_code,
      prv.name AS prv_name,
      COALESCE(
        (SELECT JSONB_AGG(sub.oem_code) FROM (
          SELECT spo.oem_code FROM supplier_product_oems spo
          WHERE spo.supplier_product_id = sp.id AND spo.is_active = true
          ORDER BY spo.updated_at DESC LIMIT ${MAX_OEM_CODES}
        ) sub), '[]'::jsonb
      ) AS oem_codes
    FROM supplier_products sp
    JOIN supplier_providers prv ON prv.id = sp.provider_id AND prv.status = 'ACTIVE'
    WHERE NOT EXISTS (
      SELECT 1 FROM supplier_part_mappings spm
      WHERE spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM part_supplier_offers pso
      WHERE pso.supplier_product_id = sp.id AND pso.is_active = true
    )
    ORDER BY sp.supplier_stock_qty DESC, sp.last_seen_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const documents: CanonicalSearchDocument[] = rows.map((row) => {
    const hasRealPrice = row.sp_price != null
    const availableStock = Math.max(0, row.sp_stock_qty ?? 0)
    const availability: SearchDocumentAvailability = resolveAvailabilityStatus({
      hasRealPrice,
      availableStock,
      hasSupplierOffer: false,
      hasPartId: false
    })
    const cta = resolveCTA(availability)
    const detailUrl = resolveDetailUrl({ supplierProductId: row.sp_id })

    const oemCodes = Array.isArray(row.oem_codes) ? row.oem_codes.slice(0, MAX_OEM_CODES) : []
    const barcodes = [row.sp_barcode_1, row.sp_barcode_2, row.sp_barcode_3].filter(Boolean) as string[]
    const eanCodes = barcodes.slice(0, MAX_EAN_CODES)

    const priceNumber = hasRealPrice ? Number(decimalToString(row.sp_price)) : null
    const priceSafe = priceNumber !== null && Number.isFinite(priceNumber) ? priceNumber : null

    const name = row.sp_name || row.sp_sku
    const brand = row.sp_brand || null

    const rankScore = computeRankScore(availability, false, 0)

    const synonyms = buildSynonymsText({ title: name })

    const normalizedText = normalizeSearchText(
      name, brand, row.sp_sku, row.prv_name,
      row.sp_normalized_name, ...oemCodes, ...eanCodes, synonyms
    )

    const keywords = extractKeywords(normalizedText)

    return {
      id: `sp_${row.sp_id}`,
      documentType: 'orphan_supplier_product' as DocumentType,
      partId: null,
      supplierProductId: row.sp_id,
      canonicalPartId: null,
      title: `${row.prv_code} ${row.sp_sku}`.trim(),
      titleTr: null,
      brand,
      categoryId: null,
      categoryName: null,
      categoryNameTr: null,
      categorySlug: null,
      supplierSku: row.sp_sku,
      providerCode: row.prv_code || null,
      providerName: row.prv_name || row.prv_code || null,
      oemCodes,
      eanCodes,
      crossReferences: [],
      referenceNumbers: [],
      normalizedSearchText: normalizedText,
      searchKeywords: keywords,
      synonymsText: synonyms,
      price: priceSafe,
      stockQty: availableStock,
      currency: row.sp_currency || 'TRY',
      hasPrice: hasRealPrice,
      hasStock: availableStock > 0,
      hasSupplierOffer: false,
      offerCount: 0,
      bestOfferProvider: row.prv_name || null,
      bestOfferSupplierProductId: row.sp_id,
      availabilityStatus: availability,
      cta,
      matchStatus: 'UNMAPPED' as MatchStatus,
      matchConfidence: null,
      matchReason: null,
      vehicleBrandNames: [],
      vehicleModelNames: [],
      vehicleTypeNames: [],
      vehicleYears: [],
      engineCodes: [],
      fitmentCount: 0,
      detailUrl,
      imageUrl: row.sp_image_url || null,
      updatedAt: Date.now(),
      rankScore,
      name,
      brandName: brand,
      brandId: null,
      articleLinkId: row.sp_id.toString(),
      sourceType: 'supplier_product' as const
    }
  })

  return { documents, total: rows.length }
}

function computeRankScore(
  availability: SearchDocumentAvailability,
  hasPartId: boolean,
  offerCount: number
): number {
  let score = 0
  switch (availability) {
    case 'PURCHASABLE':
      score = 100
      break
    case 'OUT_OF_STOCK':
      score = 50
      break
    case 'REQUEST_PRICE':
      score = 25
      break
    case 'VERIFY_FITMENT':
      score = 15
      break
  }
  if (hasPartId) {
    score += 10
  }
  if (offerCount > 0) {
    score += Math.min(offerCount * 5, 20)
  }
  return score
}

export async function buildAllSearchDocumentsPaginated(
  batchSize: number = 1000,
  onBatch?: (docs: CanonicalSearchDocument[], offset: number, total: number) => Promise<void>
): Promise<{
  supplierCount: number
  catalogCount: number
  orphanCount: number
  totalCount: number
}> {
  const supplierResult = await buildSearchDocumentsFromSupplier(50000)
  if (onBatch) {
    await onBatch(supplierResult.documents, 0, supplierResult.total)
  }

  const supplierPartIds = new Set(
    supplierResult.documents
      .map((d) => d.partId)
      .filter((id): id is string => id !== null)
  )

  const catalogResult = await buildSearchDocumentsFromCatalog(supplierPartIds, 30000, { includeFitment: false })
  if (onBatch) {
    await onBatch(catalogResult.documents, supplierResult.total, catalogResult.total)
  }

  const orphanResult = await buildOrphanSupplierDocuments(10000)
  if (onBatch) {
    await onBatch(orphanResult.documents, supplierResult.total + catalogResult.total, orphanResult.total)
  }

  return {
    supplierCount: supplierResult.total,
    catalogCount: catalogResult.total,
    orphanCount: orphanResult.total,
    totalCount: supplierResult.total + catalogResult.total + orphanResult.total
  }
}