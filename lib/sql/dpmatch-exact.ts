import { Prisma } from '@prisma/client'
import { ptproductNormalizedModelExpr } from '@/lib/sql/ptproduct-model'

/** Approved brand pair with both Dinamik and PT sides linked. */
export const pairedApprovedBrandMatchFilter = Prisma.sql`
  bm.mapping_status = 'APPROVED'
  AND bm.dbrands_id IS NOT NULL
  AND bm.ptbrands_id IS NOT NULL
`

/** dproducts alias d — brand is not under any approved paired dbrands_match. */
export const dproductNotUnderPairedApprovedBrand = Prisma.sql`
  NOT EXISTS (
    SELECT 1
    FROM v0.dbrands_match bm
    WHERE bm.dbrands_id = d.dbrands_id
      AND ${pairedApprovedBrandMatchFilter}
  )
`

/** ptproducts alias p — manufacturer is not under any approved paired dbrands_match. */
export const ptproductNotUnderPairedApprovedBrand = Prisma.sql`
  NOT EXISTS (
    SELECT 1
    FROM v0.dbrands_match bm
    WHERE bm.ptbrands_id = p.ptbrands_id
      AND ${pairedApprovedBrandMatchFilter}
  )
`

export const SINGLE_SIDE_APPROVED_MATCH_METHOD = 'NO_BRAND_MATCH'

/** Normalized dproducts.part_no (table alias d). */
export const dproductNormalizedPartNoExpr = Prisma.sql`
  NULLIF(UPPER(REGEXP_REPLACE(COALESCE(d.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
`

/** Exact match predicate: normalized part_no = normalized model within brand pair join. */
export const dpmatchExactPartNoModelFilter = Prisma.sql`
  ${dproductNormalizedPartNoExpr} IS NOT NULL
  AND ${dproductNormalizedPartNoExpr} = ${ptproductNormalizedModelExpr}
`
