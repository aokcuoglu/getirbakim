import { Prisma } from '@prisma/client'
import { normCodeSql } from '@/lib/catalog/catalog-sql'
import { PRODUCT_LIST_SUPPLIERS } from './product-match-shared'
import type {
  ProductListCoverage,
  ProductListOem,
  ProductListStatus,
  ProductListSupplier,
  ProductListSupplierFilter
} from './product-match-shared'

/**
 * "Ürün Listesi" tablosunun ortak SQL parçaları (SERVER-only).
 *
 * Ekran listesi (`product-list.ts`) ve CSV export'u (`product-list-export.ts`)
 * AYNI filtreleri kullanmak zorunda: admin ekranda ne görüyorsa CSV'de de o
 * satırlar olmalı. Bu yüzden tedarikçi kolon haritası ve WHERE parçaları tek
 * yerde durur.
 *
 * Identifier'lar sabit whitelist'ten (Prisma.raw güvenli — kullanıcı girdisi yok).
 */

export type ProductListCfg = {
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

export const PRODUCT_LIST_CONFIG: Record<ProductListSupplier, ProductListCfg> = {
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
  }
}

export type ProductListFilterInput = {
  /** 'all' → firma seçimi yok; iki tedarikçi de listelenir. */
  supplier: ProductListSupplierFilter
  status?: ProductListStatus
  coverage?: ProductListCoverage
  oem?: ProductListOem
  q?: string
  brandId?: number
}

/**
 * Filtrenin kapsadığı somut tedarikçiler. Kolon haritası tedarikçiye özel
 * olduğu için SQL her zaman TEK tedarikçi üzerinden kurulur; 'all' seçiminde
 * çağıran bu listeyi dolaşıp parçaları UNION ALL ile birleştirir.
 */
export function resolveListSuppliers(supplier: ProductListSupplierFilter): ProductListSupplier[] {
  return supplier === 'all' ? PRODUCT_LIST_SUPPLIERS : [supplier]
}

export type ProductListFilters = {
  cfg: ProductListCfg
  status: ProductListStatus
  coverage: ProductListCoverage
  oem: ProductListOem
  /** Pasif ham satırları eler. */
  passiveFilter: Prisma.Sql
  /** Ana kural: yalnız APPROVED marka altındaki satırlar (+ marka filtresi). */
  approvedBrand: Prisma.Sql
  qFilter: Prisma.Sql
  /** `m` alias'ı (LEFT JOIN product_offers) gerektirir. */
  statusFilter: Prisma.Sql
  /** `m` alias'ı gerektirir. */
  coverageFilter: Prisma.Sql
  /** OEM durumu filtresi; `m` alias'ı gerektirir. */
  oemFilter: Prisma.Sql
  /** Bağlı kanonik ürünün offer kapsamı — badge/filtre için ortak ifadeler. */
  hasDinamik: Prisma.Sql
  hasBasbug: Prisma.Sql
  /**
   * Satırın eşleştirme anahtarı — matcher'ın kullandığı ifadenin `sp` alias'lı
   * hâli (bkz. DINAMIK_MATCH_KEY_SQL / BASBUG_MATCH_KEY_SQL).
   */
  matchKey: Prisma.Sql
  /**
   * Bu satırın grubunu çoktan kapmış kanonik ürünün id'si (yoksa NULL) —
   * "alternatif varyant" rozetinin kaynağı. Yalnız offer'ı OLMAYAN satırlar
   * için hesaplanır; `m` alias'ı gerektirir.
   */
  variantProductId: Prisma.Sql
}

/**
 * `supplier` parametresi somut tedarikçidir (input.supplier 'all' olabilir);
 * çağıran `resolveListSuppliers` ile dolaşır.
 */
export function buildProductListFilters(
  input: ProductListFilterInput,
  supplier: ProductListSupplier
): ProductListFilters {
  const cfg = PRODUCT_LIST_CONFIG[supplier]
  const status = input.status ?? 'all'
  const coverage = input.coverage ?? 'all'
  const oem = input.oem ?? 'all'
  const like = input.q?.trim() ? `%${input.q.trim()}%` : null

  const passiveFilter = cfg.passive ? Prisma.sql`AND sp.is_passive = false` : Prisma.empty
  const brandFilter =
    input.brandId != null ? Prisma.sql`AND bm.brand_id = ${input.brandId}` : Prisma.empty

  const approvedBrand = Prisma.sql`
    AND EXISTS (
      SELECT 1 FROM catalog.brand_mappings bm
      WHERE bm.${cfg.mapFk} = sp.${cfg.brandIdCol} AND bm.mapping_status = 'APPROVED'
      ${brandFilter}
    )`

  const qFilter = like
    ? Prisma.sql`AND (sp.${cfg.skuCol} ILIKE ${like} OR sp.${cfg.nameCol} ILIKE ${like} OR sp.part_no ILIKE ${like} OR sp.${cfg.oemCol} ILIKE ${like})`
    : Prisma.empty

  // Eşleştirme anahtarı matcher'la birebir aynı olmak ZORUNDA: burada tire'yi
  // eleyip orada elememek, "alternatif varyant"ı gerçek boşluk gibi gösterir.
  const matchKey = normCodeSql(Prisma.sql`COALESCE(sp.part_no, sp.${cfg.skuCol})`)

  /**
   * Offer'ı olmayan satırın grubunu çoktan kapmış kanonik ürün.
   *
   * `uq_offers_product_supplier` gereği bir kanonik ürün bir tedarikçiden tek
   * offer taşır; tedarikçi aynı parçayı iki stok koduyla listelediğinde
   * ("AIS WPO-901" / "AIS WPO901" → ikisi de WPO901) yalnız biri bağlanır,
   * diğeri sonsuza kadar bağlanmadan kalır. Bu satır EKSİK ÜRÜN DEĞİLDİR —
   * ürün kataloğa girmiş ve satılabilir durumdadır. Kapsama paneli bunu zaten
   * `variantRows` olarak sayıyor (product-match.ts); liste de aynı ayrımı
   * yapsın diye ifade burada.
   */
  const variantProductId = Prisma.sql`(
    SELECT vp.id
    FROM catalog.brand_mappings vbm
    JOIN catalog.products vp
      ON vp.brand_id = vbm.brand_id
      AND vp.part_no_norm = ${matchKey}
    JOIN catalog.product_offers vpo
      ON vpo.product_id = vp.id AND vpo.supplier_code = ${supplier}
    WHERE vbm.${cfg.mapFk} = sp.${cfg.brandIdCol}
      AND vbm.mapping_status = 'APPROVED'
      AND m.id IS NULL
    LIMIT 1
  )`

  const statusFilter =
    status === 'matched'
      ? Prisma.sql`AND m.id IS NOT NULL`
      : status === 'unmatched'
        ? Prisma.sql`AND m.id IS NULL`
        : // 'variant' / 'gap': eşleşmeyenlerin iki alt kümesi. Ayrım, satırın
          // kanonik ürünü zaten bu tedarikçiden kapsanmış mı sorusudur.
          status === 'variant'
          ? Prisma.sql`AND m.id IS NULL AND ${variantProductId} IS NOT NULL`
          : status === 'gap'
            ? Prisma.sql`AND m.id IS NULL AND ${variantProductId} IS NULL`
            : Prisma.empty

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

  // OEM varlığı kanonik ürün üzerinden sorulur. `m.product_id IS NOT NULL`
  // şartı şart: eşleşmemiş satırda NOT EXISTS kendiliğinden TRUE döner ve
  // "OEM'i yok" listesi, OEM yazılamayan bağlanmamış satırlarla dolardı.
  //
  // Correlated NOT EXISTS bilerek seçildi: uq_product_oems_product_code_brand
  // üzerinden satır başına index araması yapar, marka filtresi varken (asıl
  // kullanım) sayfa+sayım prod'da <1 sn. Ön-toplanmış `SELECT DISTINCT
  // product_id` + anti-join yalnız MARKASIZ sayımda kazandırıyor (12 sn → 3,5
  // sn) ama 33,9M satırlık product_oems'i her sorguda materyalize ettiği için
  // marka filtreli hâli yavaşlatırdı; `NOT IN (...)` ise felaket (dakikalarca).
  const hasOem = Prisma.sql`EXISTS (
    SELECT 1 FROM catalog.product_oems o WHERE o.product_id = m.product_id
  )`
  const oemFilter =
    oem === 'without'
      ? Prisma.sql`AND m.product_id IS NOT NULL AND NOT ${hasOem}`
      : oem === 'with'
        ? Prisma.sql`AND m.product_id IS NOT NULL AND ${hasOem}`
        : Prisma.empty

  return {
    cfg,
    status,
    coverage,
    oem,
    passiveFilter,
    approvedBrand,
    qFilter,
    statusFilter,
    coverageFilter,
    oemFilter,
    hasDinamik,
    hasBasbug,
    matchKey,
    variantProductId
  }
}
