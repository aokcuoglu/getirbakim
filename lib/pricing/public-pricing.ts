import { Prisma } from '@prisma/client'

/**
 * Bu modül eskiden storefront fiyatlamasının tamamıydı: gerçek/yer tutucu fiyat
 * seçimi, stok normalizasyonu, satın alınabilirlik. Hepsi `part_pricing_inventory`
 * ve `part_admin_overrides` üzerinden çalışıyordu — o tablolar ne veritabanında ne
 * de şemada var, dolayısıyla o kod hiçbir zaman çalışamazdı. Fiyat artık katalogtan
 * geliyor (`products.min_selling_price_try`, `product_overrides`).
 *
 * Geriye yalnızca bu yardımcı kaldı; taşındığı yer olmadığı için dosya duruyor.
 */
export function decimalToString(
  value: Prisma.Decimal | null | undefined
): string | null {
  return value ? value.toString() : null
}
