import { Prisma } from '@prisma/client'

/**
 * resolveCatalogName()'in raw SQL karşılığı (bkz. lib/catalog/store-view.ts).
 * Admin'in girdiği catalog.product_overrides.name_override, kanonik
 * catalog.products.name'i ezer — mağaza, arama indeksi ve admin ekranları aynı
 * adı göstersin diye. name_override ayrı tabloda durduğu için tedarikçi sync'i
 * products.name'i tazelese bile override kaybolmaz.
 *
 * Alias'lar sabit string literal'lerden gelir (kullanıcı girdisi yok).
 */
export function canonicalNameSql(productAlias: string, overrideAlias: string): Prisma.Sql {
  const p = Prisma.raw(productAlias)
  const o = Prisma.raw(overrideAlias)
  return Prisma.sql`COALESCE(NULLIF(btrim(${o}.name_override), ''), ${p}.name)`
}

/** Yukarıdaki ifadeyi kullanabilmek için gereken LEFT JOIN. */
export function canonicalOverrideJoin(productAlias: string, overrideAlias: string): Prisma.Sql {
  const p = Prisma.raw(productAlias)
  const o = Prisma.raw(overrideAlias)
  return Prisma.sql`LEFT JOIN catalog.product_overrides ${o} ON ${o}.product_id = ${p}.id`
}

/** name_override'ı dolu olan kanonik ürünleri sync güncellemelerinden muaf tutar. */
export function hasNameOverrideSql(productAlias: string): Prisma.Sql {
  const p = Prisma.raw(productAlias)
  return Prisma.sql`EXISTS (
    SELECT 1 FROM catalog.product_overrides o
    WHERE o.product_id = ${p}.id AND NULLIF(btrim(o.name_override), '') IS NOT NULL
  )`
}
