/**
 * Populate v0.product_mapping with bsbg_products coverage.
 *
 * Goals:
 * 1. Every bsbg_products row appears in exactly one product_mapping row.
 * 2. Every dnmk_products row already in (or inserted into) product_mapping.
 * 3. Where bsbg.part_no == dnmk.part_no (normalized exact match), the bsbg
 *    is linked to the dnmk’s existing mapping row (all three sides in one row
 *    when dnmk+ptdrk already exists, or bsbg+dnmk when dnmk is single-side).
 *
 * Uses stable bipartite matching (row_number) so each bsbg is assigned to at
 * most one mapping row and each mapping row gets at most one bsbg.
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

const dproductNormalizedPartNoExpr = Prisma.sql`
  NULLIF(UPPER(REGEXP_REPLACE(COALESCE(d.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
`

const bsbgNormalizedPartNoExpr = Prisma.sql`
  NULLIF(UPPER(REGEXP_REPLACE(COALESCE(b.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
`

/** Add a unique partial index on bsbg_products_id so each bsbg appears once. */
async function ensureBsbgUniqueIndex(): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_dpmatch_bsbg
    ON v0.product_mapping USING btree (bsbg_products_id)
    WHERE bsbg_products_id IS NOT NULL
  `)
}

/** Insert single-side placeholder rows for every dnmk product missing from mapping. */
async function insertMissingDnmkPlaceholders(): Promise<number> {
  const result = await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.product_mapping (
      dnmk_products_id,
      ptdrk_products_id,
      mapping_status,
      part_no
    )
    SELECT
      d.id,
      NULL,
      'PENDING',
      ${dproductNormalizedPartNoExpr}
    FROM v0.dnmk_products d
    WHERE NOT EXISTS (
      SELECT 1 FROM v0.product_mapping m WHERE m.dnmk_products_id = d.id
    )
    ON CONFLICT (dnmk_products_id)
      WHERE dnmk_products_id IS NOT NULL AND ptdrk_products_id IS NULL
    DO NOTHING
  `)
  return Number(result)
}

/**
 * Link bsbg products to existing mapping rows via exact normalized part_no.
 * Uses ROW_NUMBER() for stable one-to-one assignment:
 *   - each bsbg gets at most one mapping row  (rn_bsbg = 1)
 *   - each mapping row gets at most one bsbg  (rn_mapping = 1)
 */
async function linkBsbgToExistingDnmkRows(): Promise<number> {
  const result = await db.$executeRaw(Prisma.sql`
    WITH already_linked_bsbg AS (
      SELECT bsbg_products_id AS id FROM v0.product_mapping WHERE bsbg_products_id IS NOT NULL
    ),
    match_candidates AS (
      SELECT
        m.id AS mapping_id,
        b.id AS bsbg_id,
        ROW_NUMBER() OVER (PARTITION BY b.id ORDER BY m.id) AS rn_bsbg,
        ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY b.id) AS rn_mapping
      FROM v0.product_mapping m
      JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
      JOIN v0.bsbg_products b
        ON ${dproductNormalizedPartNoExpr} = ${bsbgNormalizedPartNoExpr}
      WHERE m.bsbg_products_id IS NULL
        AND m.dnmk_products_id IS NOT NULL
        AND ${dproductNormalizedPartNoExpr} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM already_linked_bsbg l WHERE l.id = b.id
        )
    ),
    stable_matches AS (
      SELECT mapping_id, bsbg_id
      FROM match_candidates
      WHERE rn_bsbg = 1 AND rn_mapping = 1
    )
    UPDATE v0.product_mapping m
    SET bsbg_products_id = sm.bsbg_id
    FROM stable_matches sm
    WHERE m.id = sm.mapping_id
  `)
  return Number(result)
}

/** Insert bsbg-only placeholder rows for any bsbg not yet in mapping. */
async function insertBsbgOnlyPlaceholders(): Promise<number> {
  const result = await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.product_mapping (
      bsbg_products_id,
      mapping_status,
      part_no
    )
    SELECT
      b.id,
      'PENDING',
      ${bsbgNormalizedPartNoExpr}
    FROM v0.bsbg_products b
    WHERE NOT EXISTS (
      SELECT 1 FROM v0.product_mapping m WHERE m.bsbg_products_id = b.id
    )
    ON CONFLICT (bsbg_products_id)
      WHERE bsbg_products_id IS NOT NULL
    DO NOTHING
  `)
  return Number(result)
}

async function diagnostics() {
  const [{ missingDnmk }] = await db.$queryRaw<
    Array<{ missingDnmk: bigint }>
  >(Prisma.sql`
    SELECT COUNT(*) AS "missingDnmk"
    FROM v0.dnmk_products d
    WHERE NOT EXISTS (
      SELECT 1 FROM v0.product_mapping m WHERE m.dnmk_products_id = d.id
    )
  `)

  const [{ bsbgLinkCandidates }] = await db.$queryRaw<
    Array<{ bsbgLinkCandidates: bigint }>
  >(Prisma.sql`
    SELECT COUNT(DISTINCT b.id) AS "bsbgLinkCandidates"
    FROM v0.product_mapping m
    JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
    JOIN v0.bsbg_products b
      ON ${dproductNormalizedPartNoExpr} = ${bsbgNormalizedPartNoExpr}
    WHERE m.bsbg_products_id IS NULL
      AND m.dnmk_products_id IS NOT NULL
      AND ${dproductNormalizedPartNoExpr} IS NOT NULL
  `)

  const [{ missingBsbg }] = await db.$queryRaw<
    Array<{ missingBsbg: bigint }>
  >(Prisma.sql`
    SELECT COUNT(*) AS "missingBsbg"
    FROM v0.bsbg_products b
    WHERE NOT EXISTS (
      SELECT 1 FROM v0.product_mapping m WHERE m.bsbg_products_id = b.id
    )
  `)

  return { missingDnmk: Number(missingDnmk), bsbgLinkCandidates: Number(bsbgLinkCandidates), missingBsbg: Number(missingBsbg) }
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log('=== populate-bsbg-product-mapping ===')
  console.log(`Mode: ${apply ? 'LIVE (will mutate rows)' : 'DRY-RUN (read-only diagnostics, add --apply to execute)'}\n`)

  const diag = await diagnostics()
  console.log('Diagnostics:')
  console.log(`  missing dnmk rows to insert:     ${diag.missingDnmk}`)
  console.log(`  bsbg candidates to link (exact): ${diag.bsbgLinkCandidates}`)
  console.log(`  bsbg-only placeholders to insert: ${diag.missingBsbg}\n`)

  if (!apply) {
    console.log('No changes made. Run with --apply to execute.')
    return
  }

  console.log('Step 1: Ensure bsbg unique partial index...')
  await ensureBsbgUniqueIndex()
  console.log('  Index created/verified.\n')

  console.log('Step 2: Inserting missing dnmk placeholders...')
  const dnmkInserted = await insertMissingDnmkPlaceholders()
  console.log(`  Inserted ${dnmkInserted} dnmk-only rows\n`)

  console.log('Step 3: Linking bsbg to existing dnmk rows (exact part_no match)...')
  const linked = await linkBsbgToExistingDnmkRows()
  console.log(`  Linked ${linked} bsbg products to existing mapping rows\n`)

  console.log('Step 4: Inserting bsbg-only placeholders...')
  const bsbgInserted = await insertBsbgOnlyPlaceholders()
  console.log(`  Inserted ${bsbgInserted} bsbg-only rows\n`)

  await verify()
}

async function verify() {
  const [{ bsbgTotal }] = await db.$queryRaw<
    Array<{ bsbgTotal: bigint }>
  >(Prisma.sql`SELECT COUNT(*) AS "bsbgTotal" FROM v0.bsbg_products`)

  const [{ bsbgInMapping }] = await db.$queryRaw<
    Array<{ bsbgInMapping: bigint }>
  >(Prisma.sql`
    SELECT COUNT(DISTINCT bsbg_products_id) AS "bsbgInMapping"
    FROM v0.product_mapping
    WHERE bsbg_products_id IS NOT NULL
  `)

  const [{ dnmkTotal }] = await db.$queryRaw<
    Array<{ dnmkTotal: bigint }>
  >(Prisma.sql`SELECT COUNT(*) AS "dnmkTotal" FROM v0.dnmk_products`)

  const [{ dnmkInMapping }] = await db.$queryRaw<
    Array<{ dnmkInMapping: bigint }>
  >(Prisma.sql`
    SELECT COUNT(DISTINCT dnmk_products_id) AS "dnmkInMapping"
    FROM v0.product_mapping
    WHERE dnmk_products_id IS NOT NULL
  `)

  const [{ exactBsbgDnmkRows }] = await db.$queryRaw<
    Array<{ exactBsbgDnmkRows: bigint }>
  >(Prisma.sql`
    SELECT COUNT(*) AS "exactBsbgDnmkRows"
    FROM v0.product_mapping
    WHERE bsbg_products_id IS NOT NULL AND dnmk_products_id IS NOT NULL
  `)

  console.log('=== Verification ===')
  console.log(
    `  bsbg total: ${bsbgTotal} | in mapping: ${bsbgInMapping} | missing: ${
      Number(bsbgTotal) - Number(bsbgInMapping)
    }`
  )
  console.log(
    `  dnmk total: ${dnmkTotal} | in mapping: ${dnmkInMapping} | missing: ${
      Number(dnmkTotal) - Number(dnmkInMapping)
    }`
  )
  console.log(`  rows with both bsbg + dnmk (exact-linked): ${exactBsbgDnmkRows}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
