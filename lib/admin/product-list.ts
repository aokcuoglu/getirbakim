import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { canonicalNameSql, canonicalOverrideJoin } from '@/lib/catalog/canonical-name-sql'
import { buildProductListFilters } from './product-list-sql'
import type {
  ProductListCoverage,
  ProductListResult,
  ProductListStatus,
  ProductListSupplier,
  SupplierProductRow
} from './product-match-shared'

/**
 * "Ürün Listesi" tablosu (SERVER-only): bir tedarikçinin (dinamik|başbuğ)
 * ONAYLI marka altındaki ham ürünlerini eşleşme durumuyla listeler.
 * Eşleşme = catalog.product_offers (satılabilir offer).
 *
 * Ana kural: yalnız markası brand_mappings'te APPROVED olan ürünler listelenir/
 * eşleştirilebilir. Marka filtresi (brandId) kanonik marka bazlıdır.
 *
 * Kolon haritası ve WHERE parçaları `product-list-sql.ts`'te; CSV export'u aynı
 * filtreleri paylaşsın diye.
 */

export function isProductListSupplier(v: unknown): v is ProductListSupplier {
  return v === 'dinamik' || v === 'basbug'
}

export function isProductListStatus(v: unknown): v is ProductListStatus {
  return v === 'all' || v === 'matched' || v === 'unmatched'
}

export function isProductListCoverage(v: unknown): v is ProductListCoverage {
  return v === 'all' || v === 'both' || v === 'dinamik' || v === 'basbug'
}

export async function listSupplierProductsTable(input: {
  supplier: ProductListSupplier
  status?: ProductListStatus
  coverage?: ProductListCoverage
  q?: string
  brandId?: number
  page?: number
  limit?: number
}): Promise<ProductListResult> {
  const {
    cfg,
    status,
    coverage,
    passiveFilter,
    approvedBrand,
    qFilter,
    statusFilter,
    coverageFilter,
    hasDinamik,
    hasBasbug
  } = buildProductListFilters(input)
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
  const offset = (page - 1) * limit

  const rowsRaw = await db.$queryRaw<
    Array<{
      sid: bigint | number
      brand_name: string | null
      sku: string | null
      name: string | null
      part_no: string | null
      oem: string | null
      matched: boolean
      canonical_id: bigint | null
      canonical_name: string | null
      name_overridden: boolean
      has_dinamik: boolean
      has_basbug: boolean
    }>
  >(Prisma.sql`
    SELECT sp.id AS sid, sb.${cfg.brandNameCol} AS brand_name, sp.${cfg.skuCol} AS sku,
      COALESCE(NULLIF(sp.${cfg.nameCol}, ''), sp.${cfg.skuCol}) AS name,
      sp.part_no, sp.${cfg.oemCol} AS oem,
      (m.id IS NOT NULL) AS matched, m.product_id AS canonical_id,
      -- Kanonik ad = admin'in name_override'ı (varsa), yoksa products.name.
      ${canonicalNameSql('p', 'ov')} AS canonical_name,
      (NULLIF(btrim(ov.name_override), '') IS NOT NULL) AS name_overridden,
      -- Bağlı kanonik ürünün offer kapsamı (badge için): iki tedarikçili mi tek mi.
      ${hasDinamik} AS has_dinamik,
      ${hasBasbug} AS has_basbug
    FROM ${cfg.prodTable} sp
    JOIN ${cfg.brandTable} sb ON sb.id = sp.${cfg.brandIdCol}
    LEFT JOIN ${cfg.matchTable} m ON m.${cfg.matchFk} = sp.id
    LEFT JOIN catalog.products p ON p.id = m.product_id
    ${canonicalOverrideJoin('p', 'ov')}
    WHERE true
    ${passiveFilter}
    ${approvedBrand}
    ${qFilter}
    ${statusFilter}
    ${coverageFilter}
    ORDER BY sb.${cfg.brandNameCol} ASC, name ASC, sp.id
    LIMIT ${limit} OFFSET ${offset}
  `)

  const [sum] = await db.$queryRaw<Array<{ total: bigint; matched: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM ${cfg.matchTable} m WHERE m.${cfg.matchFk} = sp.id)
      )::bigint AS matched
    FROM ${cfg.prodTable} sp
    WHERE true
    ${passiveFilter}
    ${approvedBrand}
    ${qFilter}
  `)

  const total = Number(sum?.total ?? 0)
  const matched = Number(sum?.matched ?? 0)
  const unmatched = Math.max(0, total - matched)

  // Kapsam filtresi aktifken pageTotal'ı aynı join'lerle ayrıca say.
  let pageTotal = status === 'matched' ? matched : status === 'unmatched' ? unmatched : total
  if (coverage !== 'all') {
    const [cnt] = await db.$queryRaw<Array<{ c: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS c
      FROM ${cfg.prodTable} sp
      LEFT JOIN ${cfg.matchTable} m ON m.${cfg.matchFk} = sp.id
      WHERE true
      ${passiveFilter}
      ${approvedBrand}
      ${qFilter}
      ${statusFilter}
      ${coverageFilter}
    `)
    pageTotal = Number(cnt?.c ?? 0)
  }

  const rows: SupplierProductRow[] = rowsRaw.map((r) => ({
    supplier: input.supplier,
    supplierProductId: String(r.sid),
    brandName: r.brand_name,
    sku: r.sku ?? String(r.sid),
    name: r.name,
    partNo: r.part_no,
    oem: r.oem,
    matched: r.matched,
    canonicalProductId: r.canonical_id == null ? null : r.canonical_id.toString(),
    canonicalName: r.canonical_name,
    canonicalNameOverridden: r.name_overridden,
    coverage:
      r.has_dinamik && r.has_basbug
        ? 'both'
        : r.has_dinamik
          ? 'dinamik'
          : r.has_basbug
            ? 'basbug'
            : null
  }))

  return {
    rows,
    summary: { total, matched, unmatched },
    pagination: {
      page,
      limit,
      total: pageTotal,
      pages: Math.max(1, Math.ceil(pageTotal / limit))
    }
  }
}
