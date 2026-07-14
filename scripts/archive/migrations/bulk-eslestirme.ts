/**
 * Bulk Eşleştirme Scripti
 *
 * Marka bazlı toplu onaylama ve OEM (products_oems) kaydı.
 *
 * Kullanım:
 *   bun scripts/bulk-eslestirme.ts --brand-list-id=1 --action=full [--dry-run]
 *   bun scripts/bulk-eslestirme.ts --brand-list-id=1 --action=approve [--dry-run]
 *   bun scripts/bulk-eslestirme.ts --brand-list-id=1 --action=save-oems [--dry-run]
 *   bun scripts/bulk-eslestirme.ts --all-pending --action=approve [--dry-run]
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import { approveDpmatchRows } from '../lib/admin/dpprd-normalized'

const args = process.argv.slice(2)

function parseArg(key: string): string | null {
  const prefix = `--${key}=`
  for (const arg of args) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length)
  }
  return null
}

function hasFlag(flag: string): boolean {
  return args.includes(`--${flag}`)
}

const brandListId = parseArg('brand-list-id')
const canonicalBrand = parseArg('canonical-brand')
const dinamikBrand = parseArg('dinamik-brand')
const action = parseArg('action') || 'full'
const dryRun = hasFlag('dry-run')
const allPending = hasFlag('all-pending')
const onlyMatched = hasFlag('only-matched')

type DbId = { id: number }

async function findMappingIds(): Promise<{ ids: number[]; total: number; pendingCount: number }> {
  const where: string[] = []
  const params: any[] = []

  if (allPending) {
    // all pending regardless of brand
  } else if (brandListId) {
    where.push(`m.brand_list_id = $${params.length + 1}`)
    params.push(parseInt(brandListId, 10))
  } else if (canonicalBrand) {
    where.push(`LOWER(BTRIM(bl.brand)) = LOWER(BTRIM($${params.length + 1}))`)
    params.push(canonicalBrand)
  } else if (dinamikBrand) {
    where.push(`LOWER(BTRIM(COALESCE(db.brand, ''))) = LOWER(BTRIM($${params.length + 1}))`)
    params.push(dinamikBrand)
  } else {
    console.error('En az bir filtre belirtin: --brand-list-id, --canonical-brand, --dinamik-brand, veya --all-pending')
    process.exit(1)
  }

  if (onlyMatched) {
    where.push('m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NOT NULL')
  }

  const joinClauses = `
    LEFT JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
    LEFT JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id
    LEFT JOIN catalog.ptdrk_products p ON p.id = m.ptdrk_products_id
    LEFT JOIN catalog.ptdrk_brands mfr ON mfr.id = p.ptdrk_brands_id
    LEFT JOIN v0.brand_list bl ON bl.id = m.brand_list_id
  `
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1'

  const totalResult = await db.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::bigint AS count FROM v0.product_mapping m ${joinClauses} ${whereClause}`,
    ...params
  )
  const total = Number(totalResult[0]?.count ?? 0)

  const pendingResult = await db.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::bigint AS count FROM v0.product_mapping m ${joinClauses} ${whereClause} AND m.mapping_status = 'PENDING'`,
    ...params
  )
  const pendingCount = Number(pendingResult[0]?.count ?? 0)

  const rows = await db.$queryRawUnsafe<DbId[]>(
    `SELECT m.id FROM v0.product_mapping m ${joinClauses} ${whereClause} AND m.mapping_status = 'PENDING' ORDER BY m.id`,
    ...params
  )
  const ids = rows.map(r => r.id)

  return { ids, total, pendingCount }
}

async function approveBrandMapping(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const CHUNK = 500
  let total = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const approved = await approveDpmatchRows(chunk, { matchMethod: 'MANUAL', onlyPending: true })
    total += approved
    console.log(`  Onay: ${Math.min(i + CHUNK, ids.length)}/${ids.length} (${approved})`)
  }
  return total
}

async function getRefNoMap(mappingIds: number[]): Promise<Map<number, { refNo: string | null; dnmkId: bigint | null; ptdrkId: number | null }>> {
  if (mappingIds.length === 0) return new Map()

  const map = new Map()
  const CHUNK = 500
  for (let i = 0; i < mappingIds.length; i += CHUNK) {
    const chunk = mappingIds.slice(i, i + CHUNK)
    const rows = await db.$queryRawUnsafe<
      Array<{ id: number; dnmk_products_id: string | null; ptdrk_products_id: number | null; ref_no: string | null }>
    >(
      `SELECT m.id, m.dnmk_products_id::text, m.ptdrk_products_id, p.ref_no
       FROM v0.product_mapping m
       LEFT JOIN catalog.ptdrk_products p ON p.id = m.ptdrk_products_id
       WHERE m.id IN (${chunk.join(',')})`
    )
    for (const r of rows) {
      map.set(r.id, {
        refNo: r.ref_no || null,
        dnmkId: r.dnmk_products_id ? BigInt(r.dnmk_products_id) : null,
        ptdrkId: r.ptdrk_products_id ?? null,
      })
    }
  }
  return map
}

async function saveOemsForMappingIds(mappingIds: number[]): Promise<{ saved: number; skipped: number; total: number; oemsFound: number }> {
  if (mappingIds.length === 0) return { saved: 0, skipped: 0, total: 0, oemsFound: 0 }

  const refNoMap = await getRefNoMap(mappingIds)
  const mappingBrandListId = brandListId ? parseInt(brandListId, 10) : null

  let skipped = 0
  let total = 0

  const refNoEntries: Array<{ mappingId: number; refNo: string; dnmkId: bigint | null; ptdrkId: number | null }> = []
  for (const [mappingId, info] of refNoMap) {
    if (!info.refNo) { skipped++; continue }
    const refNos = info.refNo.split(/[,;|/]/).map(r => r.trim()).filter(Boolean)
    for (const refNo of refNos) {
      refNoEntries.push({ mappingId, refNo, dnmkId: info.dnmkId, ptdrkId: info.ptdrkId })
    }
  }
  total = refNoEntries.length

  if (total === 0) return { saved: 0, skipped, total: 0, oemsFound: 0 }

  const uniqueRefNos = [...new Set(refNoEntries.map(e => e.refNo))]

  console.log(`  Benzersiz ref_no: ${uniqueRefNos.length} / Toplam ref_no: ${total}`)

  const CHUNK = 100
  let saved = 0
  let oemsFound = 0

  for (let i = 0; i < uniqueRefNos.length; i += CHUNK) {
    const refChunk = uniqueRefNos.slice(i, i + CHUNK)
    const placeholders = refChunk.map((_, idx) => `LOWER(BTRIM($${idx + 1}))`).join(', ')

    const candidates = await db.$queryRawUnsafe<
      Array<{
        oem_no: string | null
        bsbg_products_id: string
        malzeme_no: string
        bsbg_brand: string
        brand_list_id: number | null
        canonical_brand: string | null
      }>
    >(
      `SELECT DISTINCT ON (b.id)
              b.oem_no, b.id::text AS bsbg_products_id, b.malzeme_no,
              bb.brand AS bsbg_brand,
              bm.brand_list_id,
              bl.brand AS canonical_brand
       FROM v0.bsbg_products b
       JOIN v0.bsbg_brands bb ON bb.id = b.bsbg_brands_id
       LEFT JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = b.bsbg_brands_id AND bm.mapping_status = 'APPROVED'
       LEFT JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
       WHERE LOWER(BTRIM(b.oem_no)) IN (${placeholders})`,
      ...refChunk
    )

    if (candidates.length === 0) continue

    const oemToCandidates = new Map<string, typeof candidates>()
    for (const c of candidates) {
      if (!c.oem_no) continue
      const key = c.oem_no.trim().toLowerCase()
      const list = oemToCandidates.get(key)
      if (list) list.push(c)
      else oemToCandidates.set(key, [c])
    }

    const matchingEntries = refNoEntries.filter(e => oemToCandidates.has(e.refNo.toLowerCase()))
    oemsFound += matchingEntries.length

    for (const entry of matchingEntries) {
      const candList = oemToCandidates.get(entry.refNo.toLowerCase())!
      for (const cand of candList) {
        const bsbgBrandListId = cand.brand_list_id
        let relationType = 'CROSS_REFERENCE'
        if (mappingBrandListId != null && bsbgBrandListId != null) {
          relationType = mappingBrandListId === bsbgBrandListId ? 'SAME_BRAND' : 'CROSS_REFERENCE'
        }
        try {
          await db.$executeRawUnsafe(
            `INSERT INTO v0.products_oems (dnmk_products_id, ptdrk_products_id, bsbg_products_id, oem_no, ref_no, brand_list_id, relation_type, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'bulk-script')
             ON CONFLICT (dnmk_products_id, bsbg_products_id, oem_no) DO UPDATE
             SET ptdrk_products_id = $2, ref_no = $5, brand_list_id = $6, relation_type = $7`,
            entry.dnmkId, entry.ptdrkId, BigInt(cand.bsbg_products_id), cand.oem_no, entry.refNo, mappingBrandListId, relationType
          )
          saved++
        } catch (err: any) {
          console.error(`  [hata] OEM: refNo=${entry.refNo}, bsbgId=${cand.bsbg_products_id}: ${err.message}`)
        }
      }
    }

    console.log(`  OEM: ${Math.min(i + CHUNK, uniqueRefNos.length)}/${uniqueRefNos.length} ref_no tarandı (${saved} kaydedildi)`)
  }

  return { saved, skipped, total, oemsFound }
}

async function main() {
  console.log('=== Bulk Eşleştirme Scripti ===')
  console.log()

  if (dryRun) console.log('🔍 DRY RUN — hiçbir değişiklik uygulanmayacak')
  console.log()

  const filterLabel = allPending
    ? 'Tüm bekleyen kayıtlar'
    : brandListId
      ? `brand_list.id = ${brandListId}`
      : canonicalBrand
        ? `canonical brand = "${canonicalBrand}"`
        : dinamikBrand
          ? `dinamik brand = "${dinamikBrand}"`
          : '(filtre yok)'
  console.log(`Filtre: ${filterLabel}`)
  console.log(`Aksiyon: ${action}`)
  console.log()

  const { ids, total, pendingCount } = await findMappingIds()
  console.log(`Toplam kayıt: ${total}`)
  console.log(`PENDING kayıt: ${pendingCount}`)
  console.log()

  if (action === 'approve' || action === 'full') {
    if (pendingCount === 0) {
      console.log('Onaylanacak PENDING kayıt yok.')
    } else {
      console.log(`Onaylanacak: ${pendingCount} kayıt`)
      if (!dryRun) {
        const approved = await approveBrandMapping(ids)
        console.log(`✅ Onaylanan: ${approved}`)
      } else {
        console.log(`[dry-run] Onaylanacak: ${pendingCount}`)
      }
    }
    console.log()
  }

  if (action === 'save-oems' || action === 'full') {
    const approvedIds = action === 'full'
      ? ids // after full approval, all these are now approved
      : await db.$queryRawUnsafe<DbId[]>(
          `SELECT id FROM v0.product_mapping WHERE brand_list_id = $1 AND mapping_status = 'APPROVED'`,
          parseInt(brandListId || '0', 10)
        ).then(r => r.map(x => x.id))

    if (approvedIds.length === 0) {
      console.log('OEM kaydı yapılacak APPROVED ürün yok.')
    } else {
      if (!dryRun) {
        const result = await saveOemsForMappingIds(approvedIds)
        console.log(`OEM kayıtları:`)
        console.log(`  Toplam ref_no kontrolü: ${result.total}`)
        console.log(`  Kaydedilen: ${result.saved}`)
        console.log(`  Atlanan (ref_no yok): ${result.skipped}`)
      } else {
        const refNoMap = await getRefNoMap(approvedIds)
        let withRefNo = 0
        let withoutRefNo = 0
        for (const [, info] of refNoMap) {
          if (info.refNo) withRefNo++
          else withoutRefNo++
        }
        console.log(`[dry-run] OEM kaydı yapılacak: ${approvedIds.length} APPROVED ürün`)
        console.log(`  ref_no olan: ${withRefNo}`)
        console.log(`  ref_no olmayan (atlanacak): ${withoutRefNo}`)
      }
    }
    console.log()
  }

  console.log('=== İşlem tamamlandı ===')
  process.exit(0)
}

main().catch(err => {
  console.error('Hata:', err)
  process.exit(1)
})
