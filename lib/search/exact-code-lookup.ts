import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normalizeCode, compactCode, isExactCodeQuery } from './code-normalization'
import type { CatalogOfferProduct } from './catalog-offer-search'
import {
  resolveAvailabilityStatus,
  resolveCTA,
  resolveDetailUrl,
  type AvailabilityStatus
} from './availability'
import { decimalToString } from '@/lib/pricing/public-pricing'

export { isExactCodeQuery }

export type ExactCodeMatch = CatalogOfferProduct & {
  exactCodeMatchSource: string
  exactCodeMatchScore: number
}

function escapeSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

type ExactCodeRow = {
  match_source: string
  match_score: number
  part_id: bigint | null
  supplier_product_id: number | null
  p_name: string | null
  p_brand_name: string | null
  p_brand_logo_url: string | null
  p_category_id: number | null
  p_category_name: string | null
  p_category_name_tr: string | null
  p_category_url_key: string | null
  p_article_link_id: bigint | null
  p_price: Prisma.Decimal | null
  pi_computed_selling_price: Prisma.Decimal | null
  pi_supplier_price: Prisma.Decimal | null
  pi_supplier_stock_qty: number | null
  pi_reserved_stock_qty: number | null
  pi_currency: string | null
  pi_source_supplier_product_id: number | null
  ao_lock_price: boolean | null
  ao_selling_price_override: Prisma.Decimal | null
  sp_sku: string | null
  sp_brand: string | null
  sp_name: string | null
  sp_price: Prisma.Decimal | null
  sp_stock_qty: number
  sp_currency: string | null
  sp_image_url: string | null
  sp_normalized_name: string | null
  spm_status: string | null
  spm_confidence: Prisma.Decimal | null
  spm_match_reason: string | null
  offer_count: number
  best_provider_name: string | null
  best_offer_sp_id: number | null
  oem_codes: string[]
  ean_codes: string[]
}

export async function lookupExactCode(
  query: string,
  limit: number = 20
): Promise<ExactCodeMatch[]> {
  const raw = query.trim()
  const norm = normalizeCode(raw)
  const compact = compactCode(raw)

  if (!norm || norm.length < 3) return []

  const codeMatchLimit = Math.min(limit, 50)

  const rows = await db.$queryRaw<ExactCodeRow[]>(Prisma.sql`
    WITH code_matches AS (
      SELECT
        'part_oen' AS match_source,
        po.part_id,
        NULL::int AS supplier_product_id,
        120 AS match_score
      FROM part_oens po
      WHERE UPPER(po.code) = UPPER(${raw})
         OR UPPER(REPLACE(REPLACE(REPLACE(po.code, ' ', ''), '-', ''), '.', '')) = ${norm}

      UNION

      SELECT
        'part_ean' AS match_source,
        pe.part_id,
        NULL::int AS supplier_product_id,
        120 AS match_score
      FROM part_eans pe
      WHERE pe.code = ${raw} OR UPPER(pe.code) = ${norm}

      UNION

      SELECT
        'part_cross_reference' AS match_source,
        pcr.part_id,
        NULL::int AS supplier_product_id,
        110 AS match_score
      FROM part_cross_references pcr
      WHERE UPPER(pcr.article_number) = UPPER(${raw})
         OR UPPER(REPLACE(REPLACE(REPLACE(pcr.article_number, ' ', ''), '-', ''), '.', '')) = ${norm}

      UNION

      SELECT
        'supplier_product_oem' AS match_source,
        spm.part_id,
        sp.supplier_product_id AS supplier_product_id,
        115 AS match_score
      FROM supplier_product_oems spo
      JOIN supplier_part_mappings spm ON spm.supplier_product_id = spo.supplier_product_id AND spm.status = 'APPROVED'
      JOIN supplier_products sp ON sp.id = spo.supplier_product_id
      WHERE UPPER(spo.oem_code) = UPPER(${raw})
         OR UPPER(spo.normalized_oem_code) = ${norm}

      UNION

      SELECT
        'supplier_product_sku' AS match_source,
        spm.part_id,
        sp.id AS supplier_product_id,
        125 AS match_score
      FROM supplier_products sp
      JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
      WHERE UPPER(sp.supplier_sku) = UPPER(${raw})
         OR UPPER(sp.normalized_sku) = ${norm}
         OR sp.barcode_1 = ${raw}
         OR sp.barcode_2 = ${raw}
         OR sp.barcode_3 = ${raw}

      UNION

      SELECT
        'supplier_product_oem_orphan' AS match_source,
        NULL::bigint AS part_id,
        spo.supplier_product_id,
        100 AS match_score
      FROM supplier_product_oems spo
      WHERE UPPER(spo.oem_code) = UPPER(${raw})
         OR UPPER(spo.normalized_oem_code) = ${norm}
    ),
    deduped AS (
      SELECT
        match_source,
        COALESCE(part_id, 0::bigint) AS part_id,
        COALESCE(supplier_product_id, 0) AS supplier_product_id,
        MAX(match_score) AS match_score
      FROM code_matches
      GROUP BY match_source, part_id, supplier_product_id
    )
    SELECT
      d.match_source,
      d.match_score,
      p.id AS part_id,
      sp.id AS supplier_product_id,
      COALESCE(p.name, sp.supplier_name, sp.supplier_sku) AS p_name,
      COALESCE(pb.name, sp.supplier_brand) AS p_brand_name,
      pb.logo_url AS p_brand_logo_url,
      p.category_id AS p_category_id,
      pc.name AS p_category_name,
      pc.name_tr AS p_category_name_tr,
      pc.url_key AS p_category_url_key,
      COALESCE(p.article_link_id, sp.id::bigint) AS p_article_link_id,
      COALESCE(
        CASE WHEN ao.lock_price AND ao.selling_price_override IS NOT NULL THEN ao.selling_price_override END,
        pi.computed_selling_price_ex_vat,
        pi.supplier_price,
        p.price,
        sp.supplier_price
      ) AS p_price,
      pi.computed_selling_price_ex_vat,
      pi.supplier_price,
      COALESCE(pi.supplier_stock_qty, sp.supplier_stock_qty, 0) AS pi_supplier_stock_qty,
      COALESCE(pi.reserved_stock_qty, 0) AS pi_reserved_stock_qty,
      COALESCE(pi.currency, sp.currency, 'TRY') AS pi_currency,
      pi.source_supplier_product_id,
      ao.lock_price,
      ao.selling_price_override,
      sp.supplier_sku AS sp_sku,
      sp.supplier_brand AS sp_brand,
      sp.supplier_name AS sp_name,
      sp.supplier_price,
      sp.supplier_stock_qty AS sp_stock_qty,
      sp.currency AS sp_currency,
      sp.image_url AS sp_image_url,
      sp.normalized_name AS sp_normalized_name,
      spm.status AS spm_status,
      spm.confidence AS spm_confidence,
      spm.match_reason AS spm_match_reason,
      (SELECT COUNT(*) FROM part_supplier_offers pso WHERE pso.part_id = p.id AND pso.is_active = true) AS offer_count,
      (SELECT prv2.name FROM part_supplier_offers pso2 JOIN supplier_providers prv2 ON prv2.id = pso2.provider_id WHERE pso2.part_id = p.id AND pso2.is_active = true ORDER BY pso2.supplier_stock_qty DESC, pso2.supplier_price ASC LIMIT 1) AS best_provider_name,
      (SELECT pso2.supplier_product_id FROM part_supplier_offers pso2 WHERE pso2.part_id = p.id AND pso2.is_active = true ORDER BY pso2.supplier_stock_qty DESC, pso2.supplier_price ASC LIMIT 1) AS best_offer_sp_id,
      COALESCE(
        (SELECT JSONB_AGG(sub.code) FROM (
          SELECT po.code FROM part_oens po WHERE po.part_id = p.id UNION ALL
          SELECT spo2.oem_code FROM supplier_product_oems spo2 WHERE spo2.supplier_product_id = sp.id AND spo2.is_active = true
          ORDER BY 1 LIMIT 12
        ) sub), '[]'::jsonb
      ) AS oem_codes,
      COALESCE(
        (SELECT JSONB_AGG(pe.code) FROM part_eans pe WHERE pe.part_id = p.id LIMIT 12), '[]'::jsonb
      ) AS ean_codes
    FROM deduped d
    LEFT JOIN parts p ON p.id = d.part_id AND d.part_id != 0
    LEFT JOIN part_brands pb ON pb.id = p.brand_id
    LEFT JOIN part_categories pc ON pc.id = p.category_id
    LEFT JOIN part_pricing_inventory pi ON pi.part_id = p.id
    LEFT JOIN part_admin_overrides ao ON ao.part_id = p.id
    LEFT JOIN supplier_products sp ON sp.id = d.supplier_product_id AND d.supplier_product_id != 0
    LEFT JOIN supplier_part_mappings spm ON spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    WHERE d.part_id != 0 OR d.supplier_product_id != 0
    ORDER BY d.match_score DESC, COALESCE(pi.supplier_stock_qty, sp.supplier_stock_qty, 0) DESC
    LIMIT ${codeMatchLimit}
  `)

  const seen = new Set<string>()
  const products: ExactCodeMatch[] = []

  for (const row of rows) {
    const partId = row.part_id && row.part_id !== BigInt(0) ? row.part_id.toString() : null
    const spId = row.supplier_product_id && row.supplier_product_id !== 0 ? row.supplier_product_id : null

    const dedupeKey = partId ? `part:${partId}` : spId ? `sp:${spId}` : null
    if (!dedupeKey || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const realPriceExVat = row.p_price
    const hasRealPrice = realPriceExVat != null
    const stockQty = Math.max(0, row.pi_supplier_stock_qty ?? row.sp_stock_qty ?? 0)
    const availableStock = Math.max(stockQty - (row.pi_reserved_stock_qty ?? 0), 0)
    const hasMapping = row.offer_count > 0 || row.spm_status === 'APPROVED'
    const availability: AvailabilityStatus = resolveAvailabilityStatus({
      hasRealPrice,
      availableStock,
      hasSupplierOffer: hasMapping,
      hasPartId: Boolean(partId)
    })

    const oemCodes = Array.isArray(row.oem_codes) ? row.oem_codes.slice(0, 12) : []
    const eanCodes = Array.isArray(row.ean_codes) ? row.ean_codes.slice(0, 12) : []

    const priceStr = hasRealPrice ? decimalToString(realPriceExVat) : null
    const priceNumber = hasRealPrice ? Number(decimalToString(realPriceExVat)) : null

    products.push({
      partId,
      supplierProductId: spId ?? row.pi_source_supplier_product_id ?? null,
      title: row.p_name || 'Unknown Part',
      brand: row.p_brand_name || row.sp_brand || 'Unknown',
      imageUrl: row.sp_image_url || null,
      price: priceStr,
      stockQty: availableStock,
      currency: row.pi_currency || row.sp_currency || 'TRY',
      availabilityStatus: availability,
      cta: resolveCTA(availability),
      providerName: row.best_provider_name || null,
      oemCodes,
      eanCodes,
      detailUrl: resolveDetailUrl({ partId, supplierProductId: spId ?? undefined }),
      name: row.p_name || row.sp_name || row.sp_sku || 'Unknown Part',
      brandName: row.p_brand_name || row.sp_brand || 'Unknown',
      brandLogo: row.p_brand_logo_url || null,
      categoryId: row.p_category_id ?? null,
      categoryName: row.p_category_name || null,
      categoryNameTr: row.p_category_name_tr || null,
      priceSource: hasRealPrice ? 'real' : 'placeholder',
      isPlaceholderPrice: !hasRealPrice,
      isPurchasable: hasRealPrice && availableStock > 0,
      sourceType: partId ? 'part' : 'supplier_product',
      articleLinkId: row.p_article_link_id?.toString() ?? (spId?.toString() ?? '0'),
      variantCount: 1,
      inBasket: false,
      brandId: null,
      images: [],
      properties: [],
      documentType: hasMapping ? 'supplier_offer' : (partId ? 'canonical_part' : 'orphan_supplier_product'),
      canonicalPartId: partId ?? null,
      matchStatus: row.spm_status === 'APPROVED' ? 'APPROVED' : (partId ? 'UNMAPPED' : 'UNMAPPED'),
      matchConfidence: row.spm_confidence ? Number(row.spm_confidence) : null,
      matchReason: row.spm_match_reason || null,
      hasSupplierOffer: hasMapping,
      offerCount: Number(row.offer_count) || 0,
      bestOfferProvider: row.best_provider_name || null,
      crossReferences: [],
      referenceNumbers: [],
      vehicleBrandNames: [],
      vehicleModelNames: [],
      fitmentCount: 0,
      exactCodeMatchSource: row.match_source,
      exactCodeMatchScore: row.match_score
    })
  }

  return products
}

export function mergeExactCodeResults(
  exactResults: CatalogOfferProduct[],
  meiliResults: CatalogOfferProduct[]
): CatalogOfferProduct[] {
  const seen = new Set<string>()

  const merged: CatalogOfferProduct[] = []

  for (const r of exactResults) {
    const key = r.partId ? `part:${r.partId}` : r.supplierProductId ? `sp:${r.supplierProductId}` : null
    if (key && !seen.has(key)) {
      seen.add(key)
      merged.push(r)
    }
  }

  for (const r of meiliResults) {
    const key = r.partId ? `part:${r.partId}` : r.supplierProductId ? `sp:${r.supplierProductId}` : null
    if (key && !seen.has(key)) {
      seen.add(key)
      merged.push(r)
    } else if (!key) {
      merged.push(r)
    }
  }

  return merged
}