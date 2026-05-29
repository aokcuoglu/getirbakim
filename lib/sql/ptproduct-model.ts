import { Prisma } from '@prisma/client'

/** Normalized part_no from v0.ptdrk_products.part_no (table alias p). */
export const ptproductNormalizedModelExpr = Prisma.sql`
  NULLIF(UPPER(REGEXP_REPLACE(COALESCE(p.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
`