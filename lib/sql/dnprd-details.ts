import { Prisma } from '@prisma/client'

/** Join latest Dinamik offer row for catalog reads. */
export const dproductDetailsJoin = Prisma.sql`
  LEFT JOIN v0.dnmk_cost o ON o.dnmk_products_id = d.id
`

export const dproductDetailsPriceExpr = Prisma.sql`o.price`

export const dproductDetailsStockExpr = Prisma.sql`o.stock_qty`

export const dproductDetailsLastSeenExpr = Prisma.sql`COALESCE(o.last_seen_at, d.last_seen_at)`
