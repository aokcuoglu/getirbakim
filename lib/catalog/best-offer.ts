import { Prisma } from '@prisma/client'

/**
 * Ürün + tedarikçi başına EN İYİ offer.
 *
 * Bir ürünün aynı tedarikçiden birden çok offer'ı olabilir: tedarikçi aynı
 * parçayı ikinci bir stok kodu ailesiyle listeliyor ("PSA 0209GN" /
 * "PSA-E 0209.GN"), hepsi tek kanonik ürüne düşüyor ve hepsi bağlanıyor
 * (bkz match-supplier-rows.ts). Fiyat/stok gösteren her yer bunlardan birini
 * seçmek zorunda; seçim TEK yerde tanımlı olsun diye burada:
 *
 *   aktif → stoklu → en ucuz → en eski satır
 *
 * Seçim okuma anında yapıldığı için stok/fiyat değiştiğinde kendiliğinden
 * devrediyor; hiçbir kolonun "primary" diye işaretlenmesi ve tazelenmesi
 * gerekmiyor.
 */
export const BEST_OFFER_ORDER_SQL = Prisma.sql`
  po.product_id, po.supplier_code,
  (po.stock_qty > 0) DESC, po.selling_price_try ASC NULLS LAST, po.id
`

/**
 * Ürün+tedarikçi başına tek satır bırakan DISTINCT ON gövdesi.
 * `where` ile kapsam daraltılır (ör. tek ürün, id listesi); yalnız aktif
 * offer'lar döner — pasif satır fiyat/stok/ad kaynağı olmamalı.
 */
export function bestOffersSql(where: Prisma.Sql = Prisma.sql`TRUE`): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT ON (po.product_id, po.supplier_code)
      po.id,
      po.product_id,
      po.supplier_code,
      po.dinamik_product_id,
      po.basbug_product_id,
      po.supplier_sku,
      po.selling_price_try,
      po.stock_qty
    FROM catalog.product_offers po
    WHERE po.is_active AND (${where})
    ORDER BY ${BEST_OFFER_ORDER_SQL}
  `
}
