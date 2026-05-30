import { Prisma } from '@prisma/client'

/** Resolve logo_url from approved v0.brand_mappings rows linked to d/p aliases. */
export const dnbrdMatchLogoExpr = Prisma.sql`
  (
    SELECT MAX(cb.logo_url) FILTER (WHERE BTRIM(COALESCE(cb.logo_url, '')) <> '')
    FROM v0.brand_mappings m
    JOIN v0.brand_list cb ON cb.id = m.brand_list_id
    WHERE m.mapping_status = 'APPROVED'
      AND (
        (d.dnmk_brands_id IS NOT NULL AND m.dnmk_brands_id = d.dnmk_brands_id)
        OR (p.ptdrk_brands_id IS NOT NULL AND m.ptdrk_brands_id = p.ptdrk_brands_id)
      )
  )
`
