import { Prisma } from '@prisma/client'

/** Normalized model from v0.ptdrk_products.product_model (table alias p). */
export const ptproductNormalizedModelExpr = Prisma.sql`
  NULLIF(UPPER(REGEXP_REPLACE(COALESCE(p.product_model, ''), '[^A-Z0-9]', '', 'gi')), '')
`
