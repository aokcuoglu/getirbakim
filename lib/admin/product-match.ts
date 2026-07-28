import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  matchDinamikSupplierRows,
  matchBasbugSupplierRows,
  countUnlinkedSupplierRows,
  DINAMIK_MATCH_KEY_SQL,
  BASBUG_MATCH_KEY_SQL
} from '@/lib/catalog/match-supplier-rows'
import { SUPPLIER_BASBUG, SUPPLIER_DINAMIK } from '@/lib/catalog/catalog-sql'
import { ingestDinamikOems, ingestBasbugOems } from '@/lib/catalog/ingest-oems'
import { refreshProductRollups } from '@/lib/catalog/refresh-product-rollups'
import type {
  ProductMatchOverview,
  ProductMatchRunResult
} from './product-match-shared'

export type {
  ProductSupplierKey,
  SupplierCoverage,
  ProductMatchOverview,
  ProductMatchRunResult,
  MatchStats
} from './product-match-shared'

type CoverageRow = {
  linked: bigint
  gap_groups: bigint
  variant_rows: bigint
  raw_rows: bigint
}

type CoverageSource = {
  /** Ham tablo + takma ad; takma ad `keySql` ile aynı olmalı (dp / bp). */
  from: Prisma.Sql
  /** brand_mappings ↔ ham tablo marka bağı. */
  brandJoin: Prisma.Sql
  /** product_offers'daki ham satır kolonu (po.dinamik_product_id gibi). */
  offerRowCol: Prisma.Sql
  /** Ham satır kimliği (dp.id / bp.id). */
  rowId: Prisma.Sql
  /** Ham satırın pasiflik kolonu (dp.is_passive / bp.is_passive). */
  isPassive: Prisma.Sql
  /** Eşleştirme anahtarı — matcher'ın kullandığı ifadenin aynısı. */
  keySql: Prisma.Sql
  supplierCode: string
}

/**
 * Kapsama sayımı: birim HAM SATIR DEĞİL, ayrı üründür.
 *
 * Tedarikçi aynı parçayı birden çok stok kodu ailesiyle listeliyor
 * ("PSA 0209GN" / "PSA-E 0209.GN" / "PGT 0209GN"); hepsi tek kanonik ürüne
 * düşer ve `uq_offers_product_supplier` gereği yalnız biri offer olabilir.
 * Satır bazlı sayım bu varyantları "eşleşmeyen" gösteriyordu — oysa ürün
 * kataloğa girmiş ve satılabilir durumdadır.
 *
 * Sayım offer'ı olmayan satırlar üzerinden yürür (Dinamik'te ~8 bin), çünkü
 * offer'lı satırların grubu zaten kendi kanonik ürünüdür — böylece normalize
 * anahtar 860 bin satır yerine yalnız bağlanmamışlar için hesaplanır:
 *   - linked      → offer'ı olan satır = kapsanmış kanonik ürün
 *   - variantRows → grubunun kanonik ürünü bu tedarikçiden zaten offer'lı olan
 *                   bağlanmamış satır (alternatif varyant, eksik ürün değil)
 *   - gapGroups   → geriye kalan gerçek boşluklar, ayrı ürün olarak sayılır
 *                   (kodsuz satır gruplanamaz; her biri kendi başına boşluktur)
 */
function coverageSql(src: CoverageSource): Prisma.Sql {
  return Prisma.sql`
    WITH unlinked AS (
      SELECT bm.brand_id, ${src.keySql} AS key_norm, ${src.rowId} AS row_id
      FROM ${src.from}
      JOIN catalog.brand_mappings bm
        ON ${src.brandJoin}
        AND bm.mapping_status = 'APPROVED'
      WHERE ${src.isPassive} = false
        AND NOT EXISTS (
          SELECT 1 FROM catalog.product_offers po WHERE ${src.offerRowCol} = ${src.rowId}
        )
    ),
    classified AS (
      SELECT
        u.brand_id,
        u.key_norm,
        u.row_id,
        EXISTS (
          SELECT 1
          FROM catalog.products p
          JOIN catalog.product_offers po
            ON po.product_id = p.id
            AND po.supplier_code = ${src.supplierCode}
          WHERE p.brand_id = u.brand_id AND p.part_no_norm = u.key_norm
        ) AS covered
      FROM unlinked u
    ),
    linked AS (
      SELECT COUNT(*)::bigint AS n
      FROM ${src.from}
      JOIN catalog.brand_mappings bm
        ON ${src.brandJoin}
        AND bm.mapping_status = 'APPROVED'
      JOIN catalog.product_offers po ON ${src.offerRowCol} = ${src.rowId}
      WHERE ${src.isPassive} = false
    )
    SELECT
      (SELECT n FROM linked) AS linked,
      (SELECT COUNT(*) FROM classified WHERE covered)::bigint AS variant_rows,
      (
        SELECT COUNT(DISTINCT (brand_id, key_norm, CASE WHEN key_norm IS NULL THEN row_id END))
        FROM classified
        WHERE NOT covered
      )::bigint AS gap_groups,
      ((SELECT n FROM linked) + (SELECT COUNT(*) FROM classified))::bigint AS raw_rows
  `
}

/**
 * Ürün eşleştirme kapsama paneli verisi.
 *
 * Her tedarikçi (dinamik/başbuğ) için onaylı marka altındaki ayrı ürün sayısı
 * (total), kanonik ürüne bağlanmış (linked) ve hiç bağlanamamış (unlinked)
 * ürünler, bağlı ürünlerin altındaki alternatif ham satırlar (variantRows);
 * ayrıca kanonik ürün ve toplam offer sayısı.
 */
export async function getProductMatchOverview(): Promise<ProductMatchOverview> {
  const [[dinamik], [basbug], [totals]] = await Promise.all([
    db.$queryRaw<CoverageRow[]>(
      coverageSql({
        from: Prisma.sql`catalog.supplier_dinamik_products dp`,
        brandJoin: Prisma.sql`bm.dinamik_brand_id = dp.brand_id`,
        offerRowCol: Prisma.sql`po.dinamik_product_id`,
        rowId: Prisma.sql`dp.id`,
        isPassive: Prisma.sql`dp.is_passive`,
        keySql: DINAMIK_MATCH_KEY_SQL,
        supplierCode: SUPPLIER_DINAMIK
      })
    ),
    db.$queryRaw<CoverageRow[]>(
      coverageSql({
        from: Prisma.sql`catalog.supplier_basbug_products bp`,
        brandJoin: Prisma.sql`bm.basbug_brand_id = bp.brand_id`,
        offerRowCol: Prisma.sql`po.basbug_product_id`,
        rowId: Prisma.sql`bp.id`,
        isPassive: Prisma.sql`bp.is_passive`,
        keySql: BASBUG_MATCH_KEY_SQL,
        supplierCode: SUPPLIER_BASBUG
      })
    ),
    db.$queryRaw<Array<{ products: bigint; offers: bigint; dual: bigint; pending: bigint }>>(
      Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM catalog.products)::bigint AS products,
      (SELECT COUNT(*) FROM catalog.product_offers)::bigint AS offers,
      (
        SELECT COUNT(*) FROM (
          SELECT product_id
          FROM catalog.product_offers
          GROUP BY product_id
          HAVING COUNT(DISTINCT supplier_code) >= 2
        ) t
      )::bigint AS dual,
      (
        SELECT COUNT(*)
        FROM catalog.product_match_candidates
        WHERE status = 'PENDING'
      )::bigint AS pending
      `
    )
  ])

  const cov = (row: CoverageRow | undefined) => {
    const linked = Number(row?.linked ?? 0)
    const unlinked = Number(row?.gap_groups ?? 0)
    return {
      total: linked + unlinked,
      linked,
      unlinked,
      variantRows: Number(row?.variant_rows ?? 0),
      rawRows: Number(row?.raw_rows ?? 0)
    }
  }

  return {
    suppliers: [
      { supplier: 'dinamik', ...cov(dinamik) },
      { supplier: 'basbug', ...cov(basbug) }
    ],
    canonicalProducts: Number(totals?.products ?? 0),
    totalOffers: Number(totals?.offers ?? 0),
    dualSupplierProducts: Number(totals?.dual ?? 0),
    pendingCandidates: Number(totals?.pending ?? 0)
  }
}

/**
 * Ürün eşleştirmeyi çalıştırır (sadece eşleştirme + rollup):
 *   Dinamik matcher → Başbuğ matcher → rollup yenile.
 * Her adım set-tabanlı ve idempotent; onaylı markalar altındaki, offer'ı olmayan
 * ham satırları kanonik ürün/offer'a bağlar. Fiyat/stok ayrı (offer refresh /
 * cost sync) — bu işlem yalnız eşleştirme yapar.
 */
export async function runProductMatching(
  onProgress?: (message: string) => void
): Promise<ProductMatchRunResult> {
  const steps: string[] = []
  const emit = (m: string) => {
    steps.push(m)
    onProgress?.(m)
  }

  const unlinkedBefore = await countUnlinkedSupplierRows()
  emit(`Başlıyor — eşleşmeyen: Dinamik ${unlinkedBefore.dinamik}, Başbuğ ${unlinkedBefore.basbug}`)

  const dinamik = await matchDinamikSupplierRows()
  emit(`Dinamik: +${dinamik.productsCreated} kanonik ürün, +${dinamik.offersLinked} offer`)

  // Dinamik ürünlerinin OEM'lerini product_oems'e yaz — Başbuğ OEM merdiveni bunlara
  // karşı örtüşme arar. Bu adım olmadan OEM çapraz eşleşmesi (aşağıda) atıl kalır.
  const dnmkOems = await ingestDinamikOems()
  emit(`Dinamik OEM: +${dnmkOems} product_oems`)

  // Dinamik önce çalışır ki Başbuğ OEM-örtüşme merdiveni Dinamik OEM'lerini görebilsin.
  const basbug = await matchBasbugSupplierRows()
  emit(
    `Başbuğ: +${basbug.productsCreated} kanonik ürün, +${basbug.offersLinked} offer` +
      (basbug.offersLinkedByOem ? ` (+${basbug.offersLinkedByOem} OEM ile)` : '') +
      (basbug.pendingCandidates ? ` · ${basbug.pendingCandidates} belirsiz → inceleme` : '')
  )

  // Ortak ürünlere Başbuğ OEM'lerini de ekle (sonraki run'lar ve zenginleştirme için).
  const bsbgOems = await ingestBasbugOems()
  emit(`Başbuğ OEM: +${bsbgOems} product_oems`)

  // Rollup ikincildir (fiyat/stok cache'i) — patlarsa eşleştirme sonucunu düşürmesin.
  let rollups = { rollupsUpdated: 0, slugsFilled: 0 }
  try {
    rollups = await refreshProductRollups()
    emit(`Rollup: ${rollups.rollupsUpdated} ürün güncellendi`)
  } catch (e) {
    console.error('[runProductMatching] rollup hatası:', e)
    emit('Rollup atlandı (hata) — eşleştirme tamamlandı')
  }

  const unlinkedAfter = await countUnlinkedSupplierRows()
  emit(`Bitti — eşleşmeyen: Dinamik ${unlinkedAfter.dinamik}, Başbuğ ${unlinkedAfter.basbug}`)

  return { dinamik, basbug, rollups, unlinkedBefore, unlinkedAfter, steps }
}
