/**
 * brand_list_id=588 (BEHR MAHLE) için:
 * 1. Eksik bsbg×dnmk kombinasyonlarını brand_mappings'e ekle
 * 2. product_mapping.brand_list_id'yi bsbg-first yaklaşımıyla düzelt
 *
 * Kullanım:
 *   bun scripts/fix-brand-mapping-588.ts               # dry-run (sadece rapor)
 *   bun scripts/fix-brand-mapping-588.ts --apply       # canlı
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

const BRAND_LIST_ID = 588
const BSBG_IDS = [1252, 1260]
const DNMK_IDS = [433, 434, 435, 436, 437, 438]
const PTDRK_ID = 72

const apply = process.argv.includes('--apply')

type Row = {
  id: number
  brand_list_id: number
  dnmk_brands_id: number | null
  ptdrk_brands_id: number | null
  bsbg_brands_id: number | null
  mapping_status: string
  match_method: string | null
}

async function reportExisting(): Promise<Row[]> {
  const rows = await db.$queryRaw<Row[]>`
    SELECT id, brand_list_id, dnmk_brands_id, ptdrk_brands_id,
           bsbg_brands_id, mapping_status, match_method
    FROM v0.brand_mappings
    WHERE brand_list_id = ${BRAND_LIST_ID}
    ORDER BY id
  `
  return rows
}

function computeMissing(rows: Row[]): { bsbg_brands_id: number; dnmk_brands_id: number; ptdrk_brands_id: number }[] {
  const existing = new Set<string>()
  for (const r of rows) {
    existing.add(`${r.bsbg_brands_id ?? 'null'}|${r.dnmk_brands_id ?? 'null'}|${r.ptdrk_brands_id ?? 'null'}`)
  }

  const missing: { bsbg_brands_id: number; dnmk_brands_id: number; ptdrk_brands_id: number }[] = []
  for (const bsbg of BSBG_IDS) {
    for (const dnmk of DNMK_IDS) {
      const key = `${bsbg}|${dnmk}|${PTDRK_ID}`
      if (!existing.has(key)) {
        missing.push({ bsbg_brands_id: bsbg, dnmk_brands_id: dnmk, ptdrk_brands_id: PTDRK_ID })
      }
    }
  }
  return missing
}

async function addMissingMappings(missing: { bsbg_brands_id: number; dnmk_brands_id: number; ptdrk_brands_id: number }[]) {
  if (missing.length === 0) {
    console.log('  Eklenecek eksik kombinasyon yok.')
    return
  }

  const values = missing
    .map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`)
    .join(', ')

  const params: any[] = []
  for (const m of missing) {
    params.push(BRAND_LIST_ID, m.dnmk_brands_id, m.ptdrk_brands_id, m.bsbg_brands_id, 'APPROVED')
  }

  const sql = `
    INSERT INTO v0.brand_mappings (brand_list_id, dnmk_brands_id, ptdrk_brands_id, bsbg_brands_id, mapping_status)
    VALUES ${values}
    ON CONFLICT (brand_list_id, dnmk_brands_id, ptdrk_brands_id, bsbg_brands_id) DO NOTHING
  `

  const result = await db.$executeRawUnsafe(sql, ...params)
  console.log(`  Eklenen satır: ${result}`)
}

async function fixProductMappings() {
  // Step A: bsbg brand'i 1252 veya 1260 olan ama brand_list_id != 588 olan ürünleri düzelt
  const fixedA = await db.$executeRaw`
    UPDATE v0.product_mapping pm
    SET brand_list_id = ${BRAND_LIST_ID}
    FROM v0.bsbg_products bp
    WHERE pm.bsbg_products_id = bp.id
      AND bp.bsbg_brands_id IN (${Prisma.join(BSBG_IDS)})
      AND (pm.brand_list_id IS DISTINCT FROM ${BRAND_LIST_ID} OR pm.brand_list_id IS NULL)
  `
  console.log(`  bsbg=MAHLE/BEHR olup brand_list_id düzeltilen: ${fixedA}`)

  // Step B: brand_list_id=588 olan ama bsbg brand'i 1252/1260/1246 DIŞINDAKİ ürünleri
  // kendi bsbg brand mapping'ine göre düzelt (TEKNOROT→268, FILTRON→94, vs.)
  const fixedB = await db.$executeRaw`
    UPDATE v0.product_mapping pm
    SET brand_list_id = bm.brand_list_id
    FROM v0.bsbg_products bp
    JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id AND bm.mapping_status = 'APPROVED'
    WHERE pm.bsbg_products_id = bp.id
      AND pm.brand_list_id = ${BRAND_LIST_ID}
      AND bp.bsbg_brands_id NOT IN (${Prisma.join(BSBG_IDS)})
      AND bp.bsbg_brands_id != 1246  -- BEHR-T, dolaylı yoldan 588 almış, doğru
  `
  console.log(`  TEKNOROT/FILTRON gibi yanlışlıkla 588 almış ürünler düzeltildi: ${fixedB}`)

  return { fixedA, fixedB }
}

async function main() {
  console.log(`=== brand_list_id=${BRAND_LIST_ID} (BEHR MAHLE) mapping düzeltme ===`)
  console.log(`Mode: ${apply ? 'LIVE' : 'DRY-RUN'}\n`)

  // 1. Mevcut mapping'leri raporla
  const existing = await reportExisting()
  console.log('=== Mevcut brand_mappings ===')
  for (const r of existing) {
    console.log(`  id=${r.id} bsbg=${r.bsbg_brands_id} dnmk=${r.dnmk_brands_id} ptdrk=${r.ptdrk_brands_id} (${r.mapping_status})`)
  }

  // 2. Eksik kombinasyonları hesapla
  const missing = computeMissing(existing)
  console.log(`\n=== Eksik kombinasyonlar (${missing.length} adet) ===`)
  for (const m of missing) {
    console.log(`  bsbg=${m.bsbg_brands_id} dnmk=${m.dnmk_brands_id} ptdrk=${m.ptdrk_brands_id}`)
  }

  // 3. Eksikleri ekle
  if (missing.length > 0) {
    if (apply) {
      console.log('\n=== Eksik kombinasyonlar ekleniyor... ===')
      await addMissingMappings(missing)
    } else {
      console.log('\n[DRY-RUN] Ekleme yapılmadı. --apply ile çalıştırın.')
    }
  }

  // 4. product_mapping düzeltme
  console.log('\n=== Product mapping düzeltme ===')

  // Count what would be affected
  const countA = await db.$queryRaw<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count
    FROM v0.product_mapping pm
    JOIN v0.bsbg_products bp ON pm.bsbg_products_id = bp.id
    WHERE bp.bsbg_brands_id IN (${Prisma.join(BSBG_IDS)})
      AND (pm.brand_list_id IS DISTINCT FROM ${BRAND_LIST_ID} OR pm.brand_list_id IS NULL)
  `
  const countB = await db.$queryRaw<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count
    FROM v0.product_mapping pm
    JOIN v0.bsbg_products bp ON pm.bsbg_products_id = bp.id
    JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id AND bm.mapping_status = 'APPROVED'
    WHERE pm.brand_list_id = ${BRAND_LIST_ID}
      AND bp.bsbg_brands_id NOT IN (${Prisma.join(BSBG_IDS)})
      AND bp.bsbg_brands_id != 1246
  `

  console.log(`  A: bsbg=MAHLE/BEHR olup düzeltilecek: ${countA[0].count}`)
  console.log(`  B: yanlışlıkla 588 almış düzeltilecek: ${countB[0].count}`)

  if (apply) {
    const { fixedA, fixedB } = await fixProductMappings()
    console.log(`\n=== Düzeltme tamam ===`)
    console.log(`  A: ${fixedA} satır güncellendi`)
    console.log(`  B: ${fixedB} satır güncellendi`)
  } else {
    console.log('\n[DRY-RUN] Düzeltme yapılmadı. --apply ile çalıştırın.')
  }

  // 5. Final rapor
  if (apply) {
    const finalExist = await reportExisting()
    console.log('\n=== Final brand_mappings ===')
    for (const r of finalExist) {
      console.log(`  id=${r.id} bsbg=${r.bsbg_brands_id} dnmk=${r.dnmk_brands_id} ptdrk=${r.ptdrk_brands_id} (${r.mapping_status})`)
    }
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
