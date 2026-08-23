/**
 * Produce a deterministic, read-only review pack for strong REPXPERT OEM suggestions.
 *
 * The cohort has a fixed upper suggestion ID of 2,847,561. It is an as-of report,
 * not a database snapshot. This script only executes SELECT statements; it never
 * approves or applies a suggestion.
 *
 * Usage:
 *   bun scripts/report-repxpert-oem-canary.ts
 *   bun scripts/report-repxpert-oem-canary.ts --size=300 --out=.data/reports/repxpert-canary
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '../lib/db'
import { inferVehicleMakers, sameMakerFamily } from '../lib/catalog/vehicle-makers'
import { loadOemBrandVocabulary } from '../lib/catalog/ref-suggestions'
import { createBrandResolver } from '../lib/catalog/oem-sources/oem-brand-vocab'

const CUTOFF_ID = BigInt(2_847_561)
const SOURCE = 'repxpert.com.tr'
const args = process.argv.slice(2)
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const requestedSize = Number(option('size') ?? 300)
const outputBase = resolve(option('out') ?? '.data/reports/repxpert-oem-canary-2847561')

if (!Number.isSafeInteger(requestedSize) || requestedSize < 1) {
  throw new Error('--size pozitif bir tam sayı olmalı')
}

interface Candidate {
  id: bigint
  product_id: bigint
  value: string
  value_norm: string
  oem_brand: string
  source_url: string
  evidence: string
  created_at: Date
  product_brand: string
  part_no: string
  part_no_norm: string
  product_name: string
  candidate_count: bigint
}

interface ExistingOem {
  product_id: bigint
  code_norm: string
  oem_brand: string
}

const MAKER_ALIASES: Record<string, string> = {
  VW: 'VOLKSWAGEN',
  MERCEDES: 'MERCEDES-BENZ',
  MB: 'MERCEDES-BENZ',
  GM: 'CHEVROLET',
  'GENERAL MOTORS': 'CHEVROLET',
  CHEVY: 'CHEVROLET'
}

function canonMaker(value: string): string {
  const upper = value.trim().toUpperCase()
  return MAKER_ALIASES[upper] ?? upper
}

function vehicleMakerConflict(name: string, oemBrand: string): boolean {
  const makers = inferVehicleMakers(name)
  if (makers.length === 0) return false
  const brand = canonMaker(oemBrand)
  return !makers.some((maker) => {
    const canonicalMaker = canonMaker(maker)
    return canonicalMaker === brand || sameMakerFamily(canonicalMaker, brand)
  })
}

// Stable FNV-1a-style ordering avoids random samples changing between runs.
function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function countBucket(count: number): string {
  if (count === 1) return '1'
  if (count <= 3) return '2-3'
  if (count <= 5) return '4-5'
  return '6-10'
}

function csvCell(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function jsonValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

async function main(): Promise<void> {
  const resolveBrand = createBrandResolver(await loadOemBrandVocabulary())
  // candidate_count deliberately covers every PENDING REPXPERT OEM in the fixed
  // snapshot, not only HIGH/evidenced rows. Thus a noisy product cannot enter by
  // having only a small clean-looking subset.
  const rows = await db.$queryRaw<Candidate[]>`
    with pending_counts as (
      select product_id, count(*) as candidate_count
      from catalog.product_ref_suggestions
      where id <= ${CUTOFF_ID}
        and kind = 'OEM' and status = 'PENDING'
        and source_site = ${SOURCE}
      group by product_id
      having count(*) <= 10
    )
    select s.id, s.product_id, s.value, s.value_norm, s.oem_brand,
           s.source_url, s.evidence, s.created_at,
           b.brand as product_brand, p.part_no, p.part_no_norm,
           coalesce(nullif(btrim(po.name_override), ''), p.name) as product_name,
           pc.candidate_count
    from catalog.product_ref_suggestions s
    join pending_counts pc on pc.product_id = s.product_id
    join catalog.products p on p.id = s.product_id
    join catalog.brands b on b.id = p.brand_id
    left join catalog.product_overrides po on po.product_id = p.id
    where s.id <= ${CUTOFF_ID}
      and s.kind = 'OEM' and s.status = 'PENDING'
      and s.source_site = ${SOURCE} and s.confidence = 'HIGH'
      and btrim(s.oem_brand) <> ''
      and nullif(btrim(s.source_url), '') is not null
      and nullif(btrim(s.evidence), '') is not null
    order by s.product_id, s.id
  `

  const existingRows = await db.$queryRaw<ExistingOem[]>`
    select distinct o.product_id, o.code_norm, o.oem_brand
    from catalog.product_oems o
    join catalog.product_ref_suggestions s
      on s.product_id = o.product_id and s.value_norm = o.code_norm
    where s.id <= ${CUTOFF_ID}
      and s.kind = 'OEM' and s.status = 'PENDING'
      and s.source_site = ${SOURCE} and s.confidence = 'HIGH'
  `
  const existingKeys = new Set(existingRows.map((row) =>
    `${row.product_id}|${row.code_norm}|${resolveBrand(row.oem_brand)}`
  ))
  const canonicalRows = rows.map((row) => ({ ...row, oem_brand: resolveBrand(row.oem_brand) }))
  const eligible = canonicalRows.filter((row) => {
    const code = row.value_norm
    const part = row.part_no_norm
    const isSelfPartNumber = Boolean(part && (code === part || code.startsWith(part) || part.startsWith(code)))
    const exactFinalKey = existingKeys.has(`${row.product_id}|${code}|${row.oem_brand}`)
    return !exactFinalKey && !isSelfPartNumber && !vehicleMakerConflict(row.product_name, row.oem_brand)
  })
  const byProduct = new Map<string, Candidate[]>()
  for (const row of eligible) {
    const key = row.product_id.toString()
    const list = byProduct.get(key) ?? []
    list.push(row)
    byProduct.set(key, list)
  }

  const strata = new Map<string, Candidate[][]>()
  for (const productRows of byProduct.values()) {
    const first = productRows[0]
    const key = `${first.product_brand}\t${countBucket(Number(first.candidate_count))}`
    const list = strata.get(key) ?? []
    list.push(productRows)
    strata.set(key, list)
  }
  for (const products of strata.values()) {
    products.sort((a, b) =>
      stableHash(a[0].product_id.toString()) - stableHash(b[0].product_id.toString()) ||
      Number(a[0].product_id - b[0].product_id)
    )
  }

  const selected: Candidate[][] = []
  const orderedStrata = [...strata.keys()].sort()
  for (let round = 0; selected.length < requestedSize; round += 1) {
    let added = false
    for (const key of orderedStrata) {
      const product = strata.get(key)?.[round]
      if (!product) continue
      selected.push(product)
      added = true
      if (selected.length === requestedSize) break
    }
    if (!added) break
  }
  const selectedRows = selected.flat().sort((a, b) => Number(a.id - b.id))

  const stratumStats = orderedStrata.map((key) => {
    const [productBrand, bucket] = key.split('\t')
    return {
      product_brand: productBrand,
      candidate_count_bucket: bucket,
      population_products: strata.get(key)?.length ?? 0,
      selected_products: selected.filter((product) =>
        product[0].product_brand === productBrand && countBucket(Number(product[0].candidate_count)) === bucket
      ).length
    }
  })

  const csvColumns: (keyof Candidate)[] = [
    'id', 'product_id', 'product_brand', 'part_no', 'product_name', 'candidate_count',
    'value', 'value_norm', 'oem_brand', 'source_url', 'evidence', 'created_at'
  ]
  const csv = [
    [...csvColumns, 'review_decision', 'review_reason', 'reviewer'].join(','),
    ...selectedRows.map((row) => [
      ...csvColumns.map((column) => csvCell(row[column])), csvCell(''), csvCell(''), csvCell('')
    ].join(','))
  ].join('\n') + '\n'

  const manifest = {
    // Derived from the frozen cohort so rerunning against unchanged data yields
    // byte-identical artifacts (unlike a wall-clock generation timestamp).
    cohort_created_through: rows.reduce(
      (latest, row) => row.created_at > latest ? row.created_at : latest,
      new Date(0)
    ).toISOString(),
    read_only: true,
    cohort: {
      cutoff_id: CUTOFF_ID,
      source_site: SOURCE,
      kind: 'OEM', status: 'PENDING', confidence: 'HIGH', max_pending_candidates_per_product: 10,
      requires_oem_brand_source_url_evidence: true,
      excludes_exact_final_key_self_part_number_vehicle_maker_conflict: true
    },
    eligible_products: byProduct.size,
    eligible_suggestions: eligible.length,
    requested_products: requestedSize,
    selected_products: selected.length,
    selected_suggestions: selectedRows.length,
    stratum_stats: stratumStats,
    suggestion_ids: selectedRows.map((row) => row.id),
    products: selected.map((productRows) => ({
      product_id: productRows[0].product_id,
      product_brand: productRows[0].product_brand,
      part_no: productRows[0].part_no,
      candidate_count: productRows[0].candidate_count,
      stratum: countBucket(Number(productRows[0].candidate_count)),
      suggestion_ids: productRows.map((row) => row.id)
    }))
  }
  const manifestJson = JSON.stringify(manifest, jsonValue, 2) + '\n'
  const markdown = `# REPXPERT OEM canary review pack\n\n` +
    `Cohort created through: ${manifest.cohort_created_through}\n\n` +
    `This is a **read-only**, fixed-ID cohort report. It is an as-of artifact, not a database snapshot. No database rows were changed.\n\n` +
    `- Fixed cutoff: \`id <= ${CUTOFF_ID}\`\n` +
    `- Eligible: ${eligible.length.toLocaleString('tr-TR')} suggestions / ${byProduct.size.toLocaleString('tr-TR')} products\n` +
    `- Selected: ${selectedRows.length.toLocaleString('tr-TR')} suggestions / ${selected.length.toLocaleString('tr-TR')} products\n` +
    `- Strata: product brand + pending-candidate bucket (1, 2–3, 4–5, 6–10)\n` +
    `- Exact suggestion IDs: see the JSON manifest; evidence and source URLs: see CSV\n\n` +
    `The candidate count includes all PENDING REPXPERT OEM rows with IDs at or below the cutoff, not just HIGH/evidenced rows. ` +
    `Vehicle-maker conflict detection is an exclusion heuristic only; passing it is not proof of vehicle fitment.\n\n` +
    `## Stratum counts\n\n| Product brand | Candidate bucket | Population | Selected |\n|---|---:|---:|---:|\n` +
    stratumStats.map((stat) => `| ${stat.product_brand} | ${stat.candidate_count_bucket} | ${stat.population_products} | ${stat.selected_products} |`).join('\n') +
    `\n\n` +
    `## Review instructions\n\nFor every CSV row, verify the OEM code against its source URL and evidence, then fill ` +
    `\`review_decision\` (APPROVE / REJECT / UNCLEAR), \`review_reason\`, and \`reviewer\`. ` +
    `Do not leave a decision without a reason. This report does not authorize or perform approval.\n`

  await mkdir(dirname(outputBase), { recursive: true })
  await Promise.all([
    writeFile(`${outputBase}.csv`, csv),
    writeFile(`${outputBase}.json`, manifestJson),
    writeFile(`${outputBase}.md`, markdown)
  ])
  console.log(`READ-ONLY · ${selected.length} ürün · ${selectedRows.length} öneri`)
  console.log(`${outputBase}.csv\n${outputBase}.json\n${outputBase}.md`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(() => db.$disconnect())
