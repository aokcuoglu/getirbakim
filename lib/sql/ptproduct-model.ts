import { Prisma } from '@prisma/client'

/** Normalized model from v0.ptproducts.model (table alias p). */
export const ptproductNormalizedModelExpr = Prisma.sql`
  NULLIF(UPPER(REGEXP_REPLACE(COALESCE(p.model, ''), '[^A-Z0-9]', '', 'gi')), '')
`
