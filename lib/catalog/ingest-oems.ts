import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normCodeSql } from './catalog-sql'

export interface IngestOemsStats {
  dinamik: number
  basbug: number
}

const tokenNorm = normCodeSql(Prisma.sql`tok`)

/**
 * Split Dinamik OEM strings (dnmk_products.oem_no, populated by the old
 * ptdrk OEM bridge) into normalized catalog.product_oems rows.
 * Tokens shorter than 4 normalized chars are dropped as noise.
 * Idempotent: unique (product_id, code_norm) + ON CONFLICT DO NOTHING.
 */
export async function ingestDinamikOems(): Promise<number> {
  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_oems (product_id, code, code_norm, source)
    SELECT DISTINCT ON (po.product_id, ${tokenNorm})
      po.product_id,
      TRIM(tok),
      ${tokenNorm},
      'DNMK'
    FROM catalog.product_offers po
    JOIN v0.dnmk_products dp ON dp.id = po.dnmk_products_id
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(dp.oem_no, ''), '[;,]| - ') AS tok
    WHERE ${tokenNorm} IS NOT NULL
      AND LENGTH(${tokenNorm}) >= 4
    ON CONFLICT (product_id, code_norm) DO NOTHING
  `)

  return Number(inserted)
}

/** Same as ingestDinamikOems, for Başbuğ (bsbg_products.oem_no). */
export async function ingestBasbugOems(): Promise<number> {
  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_oems (product_id, code, code_norm, source)
    SELECT DISTINCT ON (po.product_id, ${tokenNorm})
      po.product_id,
      TRIM(tok),
      ${tokenNorm},
      'BSBG'
    FROM catalog.product_offers po
    JOIN v0.bsbg_products bp ON bp.id = po.bsbg_products_id
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(bp.oem_no, ''), '[;,]| - ') AS tok
    WHERE ${tokenNorm} IS NOT NULL
      AND LENGTH(${tokenNorm}) >= 4
    ON CONFLICT (product_id, code_norm) DO NOTHING
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
    JOIN v0.dnmk_products dp ON dp.id = po.dnmk_products_id
    CROSS JOIN LATERAL unnest(ARRAY[dp.barcode_1, dp.barcode_2, dp.barcode_3]) AS barcode
    WHERE NULLIF(TRIM(COALESCE(barcode, '')), '') IS NOT NULL
    ON CONFLICT (product_id, code) DO NOTHING
  `)

  return Number(inserted)
}
