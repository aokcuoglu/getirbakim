import { Prisma } from '@prisma/client'
import type {
  ProductListCoverage,
  ProductListStatus,
  ProductListSupplier
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
  supplier: ProductListSupplier
  status?: ProductListStatus
  coverage?: ProductListCoverage
  q?: string
  brandId?: number
}

export type ProductListFilters = {
  cfg: ProductListCfg
  status: ProductListStatus
  coverage: ProductListCoverage
  /** Pasif ham satırları eler. */
  passiveFilter: Prisma.Sql
  /** Ana kural: yalnız APPROVED marka altındaki satırlar (+ marka filtresi). */
  approvedBrand: Prisma.Sql
  qFilter: Prisma.Sql
  /** `m` alias'ı (LEFT JOIN product_offers) gerektirir. */
  statusFilter: Prisma.Sql
  /** `m` alias'ı gerektirir. */
  coverageFilter: Prisma.Sql
  /** Bağlı kanonik ürünün offer kapsamı — badge/filtre için ortak ifadeler. */
  hasDinamik: Prisma.Sql
  hasBasbug: Prisma.Sql
}

export function buildProductListFilters(input: ProductListFilterInput): ProductListFilters {
  const cfg = PRODUCT_LIST_CONFIG[input.supplier]
  const status = input.status ?? 'all'
  const coverage = input.coverage ?? 'all'
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

  const statusFilter =
    status === 'matched'
      ? Prisma.sql`AND m.id IS NOT NULL`
      : status === 'unmatched'
        ? Prisma.sql`AND m.id IS NULL`
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

  return {
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
  }
}
