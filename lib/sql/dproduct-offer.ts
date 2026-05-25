import { Prisma } from '@prisma/client'

/** Join latest Dinamik offer row for catalog reads. */
export const dproductOfferJoin = Prisma.sql`
  LEFT JOIN parcatedarik.dproduct_offers o ON o.dproduct_id = d.id
`

/** Price: offer first, legacy dproducts.price fallback during transition. */
export const dproductOfferPriceExpr = Prisma.sql`COALESCE(o.price, d.price)`

export const dproductOfferStockExpr = Prisma.sql`o.stock_qty`

export const dproductOfferLastSeenExpr = Prisma.sql`COALESCE(o.last_seen_at, d.last_seen_at)`
