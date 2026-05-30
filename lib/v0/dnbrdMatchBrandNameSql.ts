import { Prisma } from '@prisma/client'
import { dproductBrandNameExpr } from '@/lib/sql/dnprd-catalog'

/**
 * Canonical display/search brand for a v0.product_list row.
 * Prefers approved v0.brand_mappings (normalized_brand → pt name → dinamik brand),
 * then falls back to dnbrd.brand and ptbrd.name.
 *
 * Requires aliases: d (dnprd), p (ptprd), mfr (ptbrd).
 */
export const dnbrdMatchBrandNameExpr = Prisma.sql`
  COALESCE(
    (
      SELECT COALESCE(
        MAX(pt.name) FILTER (WHERE BTRIM(COALESCE(pt.name, '')) <> ''),
        MAX(NULLIF(BTRIM(cb.normalized_brand), '')),
        MIN(db2.brand) FILTER (WHERE BTRIM(COALESCE(db2.brand, '')) <> '')
      )
      FROM v0.brand_mappings m
      JOIN v0.brand_list cb ON cb.id = m.brand_list_id
      LEFT JOIN v0.dnmk_brands db2 ON db2.id = m.dnmk_brands_id
      LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
      WHERE m.mapping_status = 'APPROVED'
        AND (
          (d.dnmk_brands_id IS NOT NULL AND m.dnmk_brands_id = d.dnmk_brands_id)
          OR (p.ptdrk_brands_id IS NOT NULL AND m.ptdrk_brands_id = p.ptdrk_brands_id)
        )
    ),
    ${dproductBrandNameExpr},
    mfr.name
  )
`
