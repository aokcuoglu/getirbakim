import { Prisma } from '@prisma/client'

/** Resolve logo_url from approved v0.dnmk_ptdrk_brands rows linked to d/p aliases. */
export const dnbrdMatchLogoExpr = Prisma.sql`
  (
    SELECT MAX(dbl.logo_url) FILTER (WHERE BTRIM(COALESCE(dbl.logo_url, '')) <> '')
    FROM v0.dnmk_ptdrk_brands bm
    LEFT JOIN v0.dnmk_brands dbl ON dbl.id = bm.dnmk_brands_id
    WHERE bm.mapping_status = 'APPROVED'
      AND (
        (d.dnmk_brands_id IS NOT NULL AND bm.dnmk_brands_id = d.dnmk_brands_id)
        OR (p.ptdrk_brands_id IS NOT NULL AND bm.ptdrk_brands_id = p.ptdrk_brands_id)
      )
  )
`
