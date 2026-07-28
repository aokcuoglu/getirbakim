import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { canonicalNameSql, canonicalOverrideJoin } from '@/lib/catalog/canonical-name-sql'
import {
  buildProductListFilters,
  resolveListSuppliers,
  type ProductListFilterInput
} from './product-list-sql'
import type {
  ProductListBrandOption,
  ProductListCoverage,
  ProductListOem,
  ProductListResult,
  ProductListStatus,
  ProductListSupplier,
  ProductListSupplierFilter,
  SupplierProductRow
} from './product-match-shared'

/**
 * "Ürün Listesi" tablosu (SERVER-only): seçilen tedarikçinin (dinamik|başbuğ,
 * ya da 'all' ile ikisi birden) ONAYLI marka altındaki ham ürünlerini eşleşme
 * durumuyla listeler. Eşleşme = catalog.product_offers (satılabilir offer).
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

export function isProductListSupplierFilter(v: unknown): v is ProductListSupplierFilter {
  return v === 'all' || isProductListSupplier(v)
}

export function isProductListStatus(v: unknown): v is ProductListStatus {
  return (
    v === 'all' || v === 'matched' || v === 'unmatched' || v === 'variant' || v === 'gap'
  )
}

export function isProductListCoverage(v: unknown): v is ProductListCoverage {
  return v === 'all' || v === 'both' || v === 'dinamik' || v === 'basbug'
}

export function isProductListOem(v: unknown): v is ProductListOem {
  return v === 'all' || v === 'with' || v === 'without'
}

/**
 * Marka filtresinin seçenekleri, tablonun DİĞER filtreleri (firma / durum /
 * kapsam / OEM / arama) uygulanmış hâlde.
 *
 * Marka eşleşmesi tablosundan (brand_mappings) türetmek yetmiyordu: "Başbuğ +
 * Eşleşmeyen" seçiliyken 1.336 satır kalırken seçicide 172 markanın tamamı
 * çıkıyor, çoğu seçildiğinde tablo boşalıyordu. Bu yüzden seçenekler ham
 * satırlar üzerinden GROUP BY ile üretilir; sıfır satırlı marka listede yer
 * almaz. Doğal olarak `brandId`'nin kendisi uygulanmaz — üretilen şey o.
 */
export async function listProductListBrandOptions(input: {
  supplier: ProductListSupplierFilter
  status?: ProductListStatus
  coverage?: ProductListCoverage
  oem?: ProductListOem
  q?: string
  /** Marka ADINDA arama (tablodaki ürün araması `q`'dan ayrı). */
  brandQ?: string
  limit?: number
}): Promise<ProductListBrandOption[]> {
  const limit = Math.min(Math.max(1, input.limit ?? 1000), 2000)
  const brandLike = input.brandQ?.trim() ? `%${input.brandQ.trim()}%` : null
  const brandFilter = brandLike ? Prisma.sql`AND br.brand ILIKE ${brandLike}` : Prisma.empty
  // brandId bilerek dışarıda: seçenekleri üretirken kendi seçimiyle daraltmak
  // listeyi tek satıra düşürür.
  const filterInput: ProductListFilterInput = { ...input, brandId: undefined }

  const rows = await db.$queryRaw<
    Array<{ brand_id: number; brand_name: string; row_count: bigint }>
  >(Prisma.sql`
    WITH per_supplier AS (
      ${Prisma.join(
        resolveListSuppliers(input.supplier).map((s) => {
          const { cfg, passiveFilter, qFilter, statusFilter, coverageFilter, oemFilter } =
            buildProductListFilters(filterInput, s)
          // Kanonik markayı almak için EXISTS yerine JOIN: bir tedarikçi markası
          // birden çok kanonik markaya eşlenmişse satır her birinin altında sayılır
          // (filtre olarak da her ikisinden erişilebilir olacağı için doğru).
          return Prisma.sql`
            SELECT bm.brand_id, COUNT(*)::bigint AS c
            FROM ${cfg.prodTable} sp
            JOIN catalog.brand_mappings bm
              ON bm.${cfg.mapFk} = sp.${cfg.brandIdCol} AND bm.mapping_status = 'APPROVED'
            LEFT JOIN ${cfg.matchTable} m ON m.${cfg.matchFk} = sp.id
            WHERE true
            ${passiveFilter}
            ${qFilter}
            ${statusFilter}
            ${coverageFilter}
            ${oemFilter}
            GROUP BY bm.brand_id
          `
        }),
        ' UNION ALL '
      )}
    ),
    agg AS (SELECT brand_id, SUM(c)::bigint AS c FROM per_supplier GROUP BY brand_id)
    SELECT br.id AS brand_id, br.brand AS brand_name, agg.c AS row_count
    FROM agg
    JOIN catalog.brands br ON br.id = agg.brand_id
    WHERE true
    ${brandFilter}
    ORDER BY br.brand ASC
    LIMIT ${limit}
  `)

  return rows.map((r) => ({
    brandId: r.brand_id,
    brandName: r.brand_name,
    rowCount: Number(r.row_count)
  }))
}

type ProductListRawRow = {
  supplier: ProductListSupplier
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
  oem_count: bigint | null
  has_dinamik: boolean
  has_basbug: boolean
  variant_product_id: bigint | null
  variant_name: string | null
  variant_blocking_sku: string | null
}

/**
 * Tek tedarikçinin satır SELECT'i. 'all' seçiminde bu parçalar UNION ALL ile
 * birleşir; kolon adları/sırası her tedarikçide birebir aynı olmak zorundadır.
 *
 * `innerLimit`: birleşimin dış sıralaması (marka, ad) her dalın kendi ilk
 * `offset+limit` satırının dışına çıkamaz, o yüzden her dal kaynağında
 * kırpılır — yoksa iki tedarikçinin tüm satırları sıralanırdı.
 *
 * Dal parantez içinde döner: parantezsiz bir UNION dalında ORDER BY/LIMIT
 * dalın değil TÜM birleşimin sonuna bağlanır (ve sözdizimi hatası verir).
 */
function buildRowSelect(
  input: ProductListFilterInput,
  supplier: ProductListSupplier,
  innerLimit: number
): Prisma.Sql {
  const {
    cfg,
    passiveFilter,
    approvedBrand,
    qFilter,
    statusFilter,
    coverageFilter,
    oemFilter,
    hasDinamik,
    hasBasbug,
    variantProductId
  } = buildProductListFilters(input, supplier)

  return Prisma.sql`
    (SELECT ${supplier}::text AS supplier,
      sp.id AS sid, sb.${cfg.brandNameCol} AS brand_name, sp.${cfg.skuCol} AS sku,
      COALESCE(NULLIF(sp.${cfg.nameCol}, ''), sp.${cfg.skuCol}) AS name,
      sp.part_no, sp.${cfg.oemCol} AS oem,
      (m.id IS NOT NULL) AS matched, m.product_id AS canonical_id,
      -- Kanonik ad = admin'in name_override'ı (varsa), yoksa products.name.
      ${canonicalNameSql('p', 'ov')} AS canonical_name,
      (NULLIF(btrim(ov.name_override), '') IS NOT NULL) AS name_overridden,
      -- OEM sayısı yalnız sayfadaki satırlar için hesaplanır (50 satır × index
      -- araması); rozet "OEM yok"u modala girmeden görünür kılar.
      CASE WHEN m.product_id IS NULL THEN NULL ELSE (
        SELECT COUNT(*) FROM catalog.product_oems o WHERE o.product_id = m.product_id
      ) END AS oem_count,
      -- Bağlı kanonik ürünün offer kapsamı (badge için): iki tedarikçili mi tek mi.
      ${hasDinamik} AS has_dinamik,
      ${hasBasbug} AS has_basbug,
      -- Offer'ı olmayan satırın grubunu çoktan kapmış kanonik ürün (varsa) →
      -- "Eşleşmedi" değil "Alternatif varyant". Adı/blokçu SKU'su sayfa
      -- kırpıldıktan SONRA, dışarıdaki 50 satır için çözülür.
      ${variantProductId} AS variant_product_id
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
    ${oemFilter}
    ORDER BY brand_name ASC, name ASC, sid ASC
    LIMIT ${innerLimit})
  `
}

export async function listSupplierProductsTable(input: {
  supplier: ProductListSupplierFilter
  status?: ProductListStatus
  coverage?: ProductListCoverage
  oem?: ProductListOem
  q?: string
  brandId?: number
  page?: number
  limit?: number
}): Promise<ProductListResult> {
  const suppliers = resolveListSuppliers(input.supplier)
  const status = input.status ?? 'all'
  const coverage = input.coverage ?? 'all'
  const oem = input.oem ?? 'all'
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
  const offset = (page - 1) * limit

  // Varyant sahibinin adı/blokçu SKU'su yalnız SAYFADAKİ satırlar için çözülür:
  // birleşim kırpıldıktan sonra ≤50 satır × iki indeksli arama. İçeride yapmak
  // filtreye uyan tüm satırlar için join demek olurdu.
  const rowsRaw = await db.$queryRaw<ProductListRawRow[]>(Prisma.sql`
    WITH page AS (
      SELECT * FROM (
        ${Prisma.join(
          suppliers.map((s) => buildRowSelect(input, s, offset + limit)),
          ' UNION ALL '
        )}
      ) t
      ORDER BY brand_name ASC, name ASC, supplier ASC, sid ASC
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT page.*,
      CASE WHEN page.variant_product_id IS NULL THEN NULL
        ELSE ${canonicalNameSql('vp', 'vov')} END AS variant_name,
      vpo.supplier_sku AS variant_blocking_sku
    FROM page
    LEFT JOIN catalog.products vp ON vp.id = page.variant_product_id
    ${canonicalOverrideJoin('vp', 'vov')}
    LEFT JOIN catalog.product_offers vpo
      ON vpo.product_id = page.variant_product_id AND vpo.supplier_code = page.supplier
    ORDER BY page.brand_name ASC, page.name ASC, page.supplier ASC, page.sid ASC
  `)

  const [sum] = await db.$queryRaw<Array<{ total: bigint; matched: bigint }>>(Prisma.sql`
    SELECT COALESCE(SUM(t.total), 0)::bigint AS total,
      COALESCE(SUM(t.matched), 0)::bigint AS matched
    FROM (
      ${Prisma.join(
        suppliers.map((s) => {
          const { cfg, passiveFilter, approvedBrand, qFilter } = buildProductListFilters(input, s)
          return Prisma.sql`
            SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (
                WHERE EXISTS (SELECT 1 FROM ${cfg.matchTable} m WHERE m.${cfg.matchFk} = sp.id)
              )::bigint AS matched
            FROM ${cfg.prodTable} sp
            WHERE true
            ${passiveFilter}
            ${approvedBrand}
            ${qFilter}
          `
        }),
        ' UNION ALL '
      )}
    ) t
  `)

  const total = Number(sum?.total ?? 0)
  const matched = Number(sum?.matched ?? 0)
  const unmatched = Math.max(0, total - matched)

  // Kapsam/OEM filtresi ya da eşleşmeyen alt kümesi (varyant/boşluk) aktifken
  // pageTotal ucuz çıkarımla bulunamaz; aynı join'lerle ayrıca sayılır.
  const needsCountedTotal =
    coverage !== 'all' || oem !== 'all' || status === 'variant' || status === 'gap'
  let pageTotal = status === 'matched' ? matched : status === 'unmatched' ? unmatched : total
  if (needsCountedTotal) {
    const [cnt] = await db.$queryRaw<Array<{ c: bigint }>>(Prisma.sql`
      SELECT COALESCE(SUM(t.c), 0)::bigint AS c
      FROM (
        ${Prisma.join(
          suppliers.map((s) => {
            const {
              cfg,
              passiveFilter,
              approvedBrand,
              qFilter,
              statusFilter,
              coverageFilter,
              oemFilter
            } = buildProductListFilters(input, s)
            return Prisma.sql`
              SELECT COUNT(*)::bigint AS c
              FROM ${cfg.prodTable} sp
              LEFT JOIN ${cfg.matchTable} m ON m.${cfg.matchFk} = sp.id
              WHERE true
              ${passiveFilter}
              ${approvedBrand}
              ${qFilter}
              ${statusFilter}
              ${coverageFilter}
              ${oemFilter}
            `
          }),
          ' UNION ALL '
        )}
      ) t
    `)
    pageTotal = Number(cnt?.c ?? 0)
  }

  const rows: SupplierProductRow[] = rowsRaw.map((r) => ({
    supplier: r.supplier,
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
    oemCount: r.oem_count == null ? null : Number(r.oem_count),
    coverage:
      r.has_dinamik && r.has_basbug
        ? 'both'
        : r.has_dinamik
          ? 'dinamik'
          : r.has_basbug
            ? 'basbug'
            : null,
    variantOf:
      r.variant_product_id == null
        ? null
        : {
            productId: r.variant_product_id.toString(),
            name: r.variant_name,
            blockingSku: r.variant_blocking_sku
          }
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
