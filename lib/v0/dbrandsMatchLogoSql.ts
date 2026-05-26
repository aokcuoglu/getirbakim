import { Prisma } from '@prisma/client'

/** Resolve logo_url from approved v0.dbrands_match rows linked to d/p aliases. */
export const dbrandsMatchLogoExpr = Prisma.sql`
  (
    SELECT MAX(bm.logo_url) FILTER (WHERE BTRIM(COALESCE(bm.logo_url, '')) <> '')
    FROM v0.dbrands_match bm
    WHERE bm.mapping_status = 'APPROVED'
      AND (
        (d.dbrands_id IS NOT NULL AND bm.dbrands_id = d.dbrands_id)
        OR (p.ptbrands_id IS NOT NULL AND bm.ptbrands_id = p.ptbrands_id)
      )
  )
`
