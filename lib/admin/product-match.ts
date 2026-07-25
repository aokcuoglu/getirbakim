import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  matchDinamikSupplierRows,
  matchBasbugSupplierRows,
  countUnlinkedSupplierRows
} from '@/lib/catalog/match-supplier-rows'
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

/**
 * Ürün eşleştirme kapsama paneli verisi.
 *
 * Her tedarikçi (dinamik/başbuğ) için onaylı marka altındaki aktif ham satır
 * sayısı (total), offer'a bağlanmış (linked) ve bağlanmamış (unlinked) sayıları;
 * ayrıca kanonik ürün ve toplam offer sayısı.
 */
export async function getProductMatchOverview(): Promise<ProductMatchOverview> {
  // Fan-out'u önlemek için marka-onayı kontrolü JOIN yerine EXISTS ile.
  const [dinamik] = await db.$queryRaw<Array<{ total: bigint; linked: bigint }>>(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.dinamik_product_id = dp.id)
      )::bigint AS linked
    FROM catalog.supplier_dinamik_products dp
    WHERE dp.is_passive = false
      AND EXISTS (
        SELECT 1 FROM catalog.brand_mappings bm
        WHERE bm.dinamik_brand_id = dp.brand_id AND bm.mapping_status = 'APPROVED'
      )
  `)

  const [basbug] = await db.$queryRaw<Array<{ total: bigint; linked: bigint }>>(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM catalog.product_offers po WHERE po.basbug_product_id = bp.id)
      )::bigint AS linked
    FROM catalog.supplier_basbug_products bp
    WHERE bp.is_passive = false
      AND EXISTS (
        SELECT 1 FROM catalog.brand_mappings bm
        WHERE bm.basbug_brand_id = bp.brand_id AND bm.mapping_status = 'APPROVED'
      )
  `)

  const [totals] = await db.$queryRaw<
    Array<{ products: bigint; offers: bigint; dual: bigint; pending: bigint }>
  >(Prisma.sql`
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
  `)

  const cov = (row: { total: bigint; linked: bigint } | undefined) => {
    const total = Number(row?.total ?? 0)
    const linked = Number(row?.linked ?? 0)
    return { total, linked, unlinked: Math.max(0, total - linked) }
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
