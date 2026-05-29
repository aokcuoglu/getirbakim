import { Prisma } from '@prisma/client'

/** Join Dinamik brand name for catalog reads. */
export const dproductDbrandJoin = Prisma.sql`
  INNER JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id
`

export const dproductDbrandLeftJoin = Prisma.sql`
  LEFT JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id
`

export const dproductBrandNameExpr = Prisma.sql`db.brand`
