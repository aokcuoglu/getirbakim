import { Prisma } from '@prisma/client'
import { ptproductNormalizedModelExpr } from '@/lib/sql/ptproduct-model'

/** Approved brand pair with both Dinamik and PT sides linked. */
export const pairedApprovedBrandMatchFilter = Prisma.sql`
  bm.mapping_status = 'APPROVED'
  AND bm.dnmk_brands_id IS NOT NULL
  AND bm.ptdrk_brands_id IS NOT NULL
`

/** dnprd alias d — brand is not under any approved paired dpbrd. */
export const dproductNotUnderPairedApprovedBrand = Prisma.sql`
  NOT EXISTS (
    SELECT 1
    FROM v0.brand_mappings bm
    WHERE bm.dnmk_brands_id = d.dnmk_brands_id
      AND ${pairedApprovedBrandMatchFilter}
  )
`

/** ptprd alias p — manufacturer is not under any approved paired dpbrd. */
export const ptproductNotUnderPairedApprovedBrand = Prisma.sql`
  NOT EXISTS (
    SELECT 1
    FROM v0.brand_mappings bm
    WHERE bm.ptdrk_brands_id = p.ptdrk_brands_id
      AND ${pairedApprovedBrandMatchFilter}
  )
`

export const SINGLE_SIDE_APPROVED_MATCH_METHOD = 'NO_BRAND_MATCH'

/** Normalized dnprd.part_no (table alias d). */
export const dproductNormalizedPartNoExpr = Prisma.sql`
  NULLIF(UPPER(REGEXP_REPLACE(COALESCE(d.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
`

/** Exact match predicate: normalized part_no = normalized model within brand pair join. */
export const dpprdExactPartNoModelFilter = Prisma.sql`
  ${dproductNormalizedPartNoExpr} IS NOT NULL
  AND ${dproductNormalizedPartNoExpr} = ${ptproductNormalizedModelExpr}
`
