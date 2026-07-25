import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normCodeSql } from './catalog-sql'

export interface IngestOemsStats {
  dinamik: number
  basbug: number
}

const tokenNorm = normCodeSql(Prisma.sql`tok`)

/**
 * Split Dinamik OEM strings (supplier_dinamik_products.oem_no, populated by
 * the supplier OEM bridge) into normalized
 * catalog.product_oems rows.
 * Tokens shorter than 4 normalized chars are dropped as noise.
 *
 * Supplier OEM strings carry no vehicle maker, so oem_brand is '' (unknown) —
 * these rows can therefore coexist with brand-carrying PARTS rows for the same
 * code, which is why the display layer drops the brand-less duplicate.
 *
 * Idempotent: unique (product_id, code_norm, oem_brand) + ON CONFLICT DO NOTHING.
 */
export async function ingestDinamikOems(): Promise<number> {
  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_oems (product_id, code, code_norm, oem_brand, source)
    SELECT DISTINCT ON (po.product_id, ${tokenNorm})
      po.product_id,
      TRIM(tok),
      ${tokenNorm},
      '',
      'DNMK'
    FROM catalog.product_offers po
    JOIN catalog.supplier_dinamik_products dp ON dp.id = po.dinamik_product_id
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(dp.oem_no, ''), '[;,]| - ') AS tok
    WHERE ${tokenNorm} IS NOT NULL
      AND LENGTH(${tokenNorm}) >= 4
    ORDER BY po.product_id, ${tokenNorm}, TRIM(tok)
    ON CONFLICT (product_id, code_norm, oem_brand) DO NOTHING
  `)

  return Number(inserted)
}

/** Same as ingestDinamikOems, for Başbuğ (supplier_basbug_products.oem_no). */
export async function ingestBasbugOems(): Promise<number> {
  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_oems (product_id, code, code_norm, oem_brand, source)
    SELECT DISTINCT ON (po.product_id, ${tokenNorm})
      po.product_id,
      TRIM(tok),
      ${tokenNorm},
      '',
      'BSBG'
    FROM catalog.product_offers po
    JOIN catalog.supplier_basbug_products bp ON bp.id = po.basbug_product_id
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(bp.oem_no, ''), '[;,]| - ') AS tok
    WHERE ${tokenNorm} IS NOT NULL
      AND LENGTH(${tokenNorm}) >= 4
    ORDER BY po.product_id, ${tokenNorm}, TRIM(tok)
    ON CONFLICT (product_id, code_norm, oem_brand) DO NOTHING
  `)

  return Number(inserted)
}

export async function ingestSupplierOems(): Promise<IngestOemsStats> {
  const dinamik = await ingestDinamikOems()
  const basbug = await ingestBasbugOems()
  return { dinamik, basbug }
}

/** Dinamik barcodes → catalog.product_eans. */
export async function ingestSupplierEans(): Promise<number> {
  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_eans (product_id, code, source)
    SELECT DISTINCT ON (po.product_id, TRIM(barcode))
      po.product_id,
      TRIM(barcode),
      'DNMK'
    FROM catalog.product_offers po
    JOIN catalog.supplier_dinamik_products dp ON dp.id = po.dinamik_product_id
    CROSS JOIN LATERAL unnest(ARRAY[dp.barcode_1, dp.barcode_2, dp.barcode_3]) AS barcode
    WHERE NULLIF(TRIM(COALESCE(barcode, '')), '') IS NOT NULL
    ON CONFLICT (product_id, code) DO NOTHING
  `)

  return Number(inserted)
}