import { Prisma } from '@prisma/client'
import { dproductBrandNameExpr } from '@/lib/sql/dproduct-catalog'

/**
 * Canonical display/search brand for a v0.dpmatch row.
 * Prefers approved v0.dbrands_match (normalized → pt name → dinamik brand),
 * then falls back to dbrands.brand and ptbrands.name.
 *
 * Requires aliases: d (dproducts), p (ptproducts), mfr (ptbrands).
 */
export const dbrandsMatchBrandNameExpr = Prisma.sql`
  COALESCE(
    (
      SELECT COALESCE(
        MAX(pt.name) FILTER (WHERE BTRIM(COALESCE(pt.name, '')) <> ''),
        MAX(NULLIF(BTRIM(bm.normalized), '')),
        MIN(db2.brand) FILTER (WHERE BTRIM(COALESCE(db2.brand, '')) <> '')
      )
      FROM v0.dbrands_match bm
      LEFT JOIN v0.dbrands db2 ON db2.id = bm.dbrands_id
      LEFT JOIN v0.ptbrands pt ON pt.id = bm.ptbrands_id
      WHERE bm.mapping_status = 'APPROVED'
        AND (
          (d.dbrands_id IS NOT NULL AND bm.dbrands_id = d.dbrands_id)
          OR (p.ptbrands_id IS NOT NULL AND bm.ptbrands_id = p.ptbrands_id)
        )
    ),
    ${dproductBrandNameExpr},
    mfr.name
  )
`
