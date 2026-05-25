import { Prisma } from '@prisma/client'

/** Join Dinamik brand name for catalog reads. */
export const dproductDbrandJoin = Prisma.sql`
  INNER JOIN v0.dbrands db ON db.id = d.dbrands_id
`

export const dproductDbrandLeftJoin = Prisma.sql`
  LEFT JOIN v0.dbrands db ON db.id = d.dbrands_id
`

export const dproductBrandNameExpr = Prisma.sql`db.brand`
