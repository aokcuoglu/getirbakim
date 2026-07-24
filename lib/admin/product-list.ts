import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import type {
  ProductListCoverage,
  ProductListResult,
  ProductListStatus,
  ProductListSupplier,
  SupplierProductRow
} from './product-match-shared'

/**
 * "Ürün Listesi" tablosu (SERVER-only): bir tedarikçinin (dinamik|başbuğ|ptdrk)
 * ONAYLI marka altındaki ham ürünlerini eşleşme durumuyla listeler.
 *   - Dinamik/Başbuğ: eşleşme = catalog.product_offers (satılabilir offer)
 *   - Parçatedarik  : eşleşme = catalog.product_ptdrk_refs (referans, offer değil)
 *
 * Ana kural: yalnız markası brand_mappings'te APPROVED olan ürünler listelenir/
 * eşleştirilebilir. Marka filtresi (brandId) kanonik marka bazlıdır.
 *
 * Identifier'lar sabit whitelist'ten (Prisma.raw güvenli — kullanıcı girdisi yok).
 */

type Cfg = {
  prodTable: Prisma.Sql
  brandTable: Prisma.Sql
  brandIdCol: Prisma.Sql // supplier ürünündeki marka FK'si
  brandNameCol: Prisma.Sql // marka tablosundaki ad kolonu
  mapFk: Prisma.Sql // brand_mappings'teki tedarikçi FK'si
  skuCol: Prisma.Sql
  nameCol: Prisma.Sql
  oemCol: Prisma.Sql
  matchTable: Prisma.Sql
  matchFk: Prisma.Sql
  passive: boolean
}

const CONFIG: Record<ProductListSupplier, Cfg> = {
  dinamik: {
    prodTable: Prisma.raw('catalog.supplier_dinamik_products'),
    brandTable: Prisma.raw('catalog.supplier_dinamik_brands'),
    brandIdCol: Prisma.raw('brand_id'),
    brandNameCol: Prisma.raw('brand'),
    mapFk: Prisma.raw('dinamik_brand_id'),
    skuCol: Prisma.raw('stock_code'),
    nameCol: Prisma.raw('stock_name'),
    oemCol: Prisma.raw('oem_no'),
    matchTable: Prisma.raw('catalog.product_offers'),
    matchFk: Prisma.raw('dinamik_product_id'),
    passive: true
  },
  basbug: {
    prodTable: Prisma.raw('catalog.supplier_basbug_products'),
    brandTable: Prisma.raw('catalog.supplier_basbug_brands'),
    brandIdCol: Prisma.raw('brand_id'),
    brandNameCol: Prisma.raw('brand'),
    mapFk: Prisma.raw('basbug_brand_id'),
    skuCol: Prisma.raw('malzeme_no'),
    nameCol: Prisma.raw('aciklama'),
    oemCol: Prisma.raw('oem_no'),
    matchTable: Prisma.raw('catalog.product_offers'),
    matchFk: Prisma.raw('basbug_product_id'),
    passive: true
  },
  ptdrk: {
    prodTable: Prisma.raw('catalog.ptdrk_products'),
    brandTable: Prisma.raw('catalog.ptdrk_brands'),
    brandIdCol: Prisma.raw('ptdrk_brands_id'),
    brandNameCol: Prisma.raw('name'),
    mapFk: Prisma.raw('ptdrk_brand_id'),
    skuCol: Prisma.raw('sku'),
    nameCol: Prisma.raw('title'),
    oemCol: Prisma.raw('ref_no'),
    matchTable: Prisma.raw('catalog.product_ptdrk_refs'),
    matchFk: Prisma.raw('ptdrk_product_id'),
    passive: false
  }
}

export function isProductListSupplier(v: unknown): v is ProductListSupplier {
  return v === 'dinamik' || v === 'basbug' || v === 'ptdrk'
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
  const cfg = CONFIG[input.supplier]
  const status = input.status ?? 'all'
  const coverage = input.coverage ?? 'all'
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
  const offset = (page - 1) * limit
  const like = input.q?.trim() ? `%${input.q.trim()}%` : null

  const passiveFilter = cfg.passive ? Prisma.sql`AND sp.is_passive = false` : Prisma.empty
  const brandFilter =
    input.brandId != null ? Prisma.sql`AND bm.brand_id = ${input.brandId}` : Prisma.empty

  // Onaylı marka koşulu (ana kural) — fan-out'suz EXISTS.
  const approvedBrand = Prisma.sql`
    AND EXISTS (
      SELECT 1 FROM catalog.brand_mappings bm
      WHERE bm.${cfg.mapFk} = sp.${cfg.brandIdCol} AND bm.mapping_status = 'APPROVED'
      ${brandFilter}
    )`

  const qFilter = like
    ? Prisma.sql`AND (sp.${cfg.skuCol} ILIKE ${like} OR sp.${cfg.nameCol} ILIKE ${like} OR sp.part_no ILIKE ${like} OR sp.${cfg.oemCol} ILIKE ${like})`
    : Prisma.empty

  const statusFilter =
    status === 'matched'
      ? Prisma.sql`AND m.id IS NOT NULL`
      : status === 'unmatched'
        ? Prisma.sql`AND m.id IS NULL`
        : Prisma.empty

  // Bağlı kanonik ürünün offer kapsamı (badge + filtre için ortak ifadeler).
  const hasDinamik = Prisma.sql`EXISTS (
    SELECT 1 FROM catalog.product_offers po
    WHERE po.product_id = m.product_id AND po.dinamik_product_id IS NOT NULL
  )`
  const hasBasbug = Prisma.sql`EXISTS (
    SELECT 1 FROM catalog.product_offers po
    WHERE po.product_id = m.product_id AND po.basbug_product_id IS NOT NULL
  )`

  // Kapsam filtresi yalnız eşleşen satırlara uygulanır (m.product_id gerektirir).
  const coverageFilter =
    coverage === 'both'
      ? Prisma.sql`AND ${hasDinamik} AND ${hasBasbug}`
      : coverage === 'dinamik'
        ? Prisma.sql`AND ${hasDinamik} AND NOT ${hasBasbug}`
        : coverage === 'basbug'
          ? Prisma.sql`AND ${hasBasbug} AND NOT ${hasDinamik}`
          : Prisma.empty

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
      has_dinamik: boolean
      has_basbug: boolean
    }>
  >(Prisma.sql`
    SELECT sp.id AS sid, sb.${cfg.brandNameCol} AS brand_name, sp.${cfg.skuCol} AS sku,
      COALESCE(NULLIF(sp.${cfg.nameCol}, ''), sp.${cfg.skuCol}) AS name,
      sp.part_no, sp.${cfg.oemCol} AS oem,
      (m.id IS NOT NULL) AS matched, m.product_id AS canonical_id, p.name AS canonical_name,
      -- Bağlı kanonik ürünün offer kapsamı (badge için): iki tedarikçili mi tek mi.
      ${hasDinamik} AS has_dinamik,
      ${hasBasbug} AS has_basbug
    FROM ${cfg.prodTable} sp
    JOIN ${cfg.brandTable} sb ON sb.id = sp.${cfg.brandIdCol}
    LEFT JOIN ${cfg.matchTable} m ON m.${cfg.matchFk} = sp.id
    LEFT JOIN catalog.products p ON p.id = m.product_id
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
