import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

const BASBUG_BASE = process.env.BASBUG_BASE_URL || 'https://api.basbug.com.tr'
const FIRMA_ADI = 'BASBUG'
const BATCH_SIZE = 500

async function getBasbugToken(): Promise<string> {
  const res = await fetch(`${BASBUG_BASE}/auth/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kullaniciAdi: process.env.BASBUG_USERNAME,
      parola: process.env.BASBUG_PASSWORD,
      clientID: process.env.BASBUG_CLIENT_ID,
      clientSecret: process.env.BASBUG_CLIENT_SECRET
    })
  })
  if (!res.ok) {
    console.error(`Auth failed: HTTP ${res.status}: ${await res.text()}`)
    process.exit(1)
  }
  const data: any = await res.json()
  return data.token
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length ? text : null
}

function mapCurrency(dc: string): string {
  const upper = dc.trim().toUpperCase()
  if (upper === 'TL') return 'TRY'
  return upper
}

function toDecimal(value: number | null): Prisma.Decimal | null {
  if (value == null || !Number.isFinite(value)) return null
  return new Prisma.Decimal(value)
}

async function main() {
  const token = await getBasbugToken()
  const grupKodu = process.argv[2] || 'PSA'

  console.log(`\n[basbug] Fetching MalzemeleriGetir for group: ${grupKodu}...`)
  const res = await fetch(
    `${BASBUG_BASE}/material/MalzemeleriGetir?FirmaAdi=${FIRMA_ADI}&ListeGrubu=${encodeURIComponent(grupKodu)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }
  )

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`)
    process.exit(1)
  }

  const data: any = await res.json()
  const items = data.malzemeListesi || []

  console.log(`Total products fetched: ${items.length}`)

  // Collect distinct brands
  const brandNames = new Set<string>()
  for (const m of items) {
    const brand = m.uk?.trim() || 'BİLİNMEYEN'
    brandNames.add(brand)
  }

  // Upsert brands
  console.log(`\n[basbug] Upserting ${brandNames.size} brands...`)
  const brandIds = new Map<string, bigint>()
  for (const brand of brandNames) {
    const result = await db.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO catalog.supplier_basbug_brands (brand, created_at, updated_at, last_seen_at)
      VALUES (${brand}, NOW(), NOW(), NOW())
      ON CONFLICT (brand) DO UPDATE SET last_seen_at = NOW(), updated_at = NOW()
      RETURNING id
    `
    brandIds.set(brand, result[0].id)
  }
  console.log(`  ✓ ${brandIds.size} brands upserted`)

  // Batch upsert products — dedupe by (brand_id, malzeme_no) first
  console.log(`\n[basbug] Upserting ${items.length} products in batches of ${BATCH_SIZE}...`)
  let upserted = 0

  // Dedupe items by (brand, malzeme_no) to avoid ON CONFLICT affecting same row twice
  const seen = new Set<string>()
  const dedupedItems = items.filter((m: any) => {
    const brand = m.uk?.trim() || 'BİLİNMEYEN'
    const malzemeNo = m.no?.trim()
    if (!malzemeNo) return false
    const key = `${brand}::${malzemeNo}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  console.log(`  Deduped: ${items.length} → ${dedupedItems.length} (${items.length - dedupedItems.length} duplicates removed)`)

  for (let i = 0; i < dedupedItems.length; i += BATCH_SIZE) {
    const batch = dedupedItems.slice(i, i + BATCH_SIZE)
    const values = batch.map((m: any) => {
      const brand = m.uk?.trim() || 'BİLİNMEYEN'
      const brandId = brandIds.get(brand)!
      const currency = mapCurrency(m.dc || 'TL')
      const malzemeNo = m.no?.trim()
      if (!malzemeNo) return null

      // Derive part_no: strip brand prefix from malzeme_no for certain brands
      const partNo = derivePartNo(m.uk, malzemeNo)

      return Prisma.sql`(
        ${brandId}::bigint,
        ${malzemeNo},
        ${partNo},
        ${normalizeText(m.ac)},
        ${normalizeText(m.ac2)},
        ${normalizeText(m.oe)},
        ${m.lgk?.trim() || grupKodu},
        ${normalizeText(m.m)},
        ${normalizeText(m.mo)},
        ${normalizeText(m.y)},
        ${normalizeText(m.b)},
        ${currency},
        ${m.lf != null ? new Prisma.Decimal(m.lf) : Prisma.sql`NULL::numeric(12,2)`},
        ${JSON.stringify(m)}::jsonb,
        NOW(),
        NOW(),
        false,
        NULL::timestamptz
      )`
    }).filter(Boolean)

    if (values.length === 0) continue

    const count = await db.$executeRaw`
      INSERT INTO catalog.supplier_basbug_products (
        brand_id, malzeme_no, part_no, aciklama, aciklama2, oem_no,
        liste_grubu_kodu, arac_bilgisi, motor_bilgisi, yil_araligi,
        birim, para_birimi, liste_fiyati, raw,
        last_seen_at, updated_at, is_passive, passive_at
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (brand_id, malzeme_no) DO UPDATE SET
        aciklama = COALESCE(EXCLUDED.aciklama, catalog.supplier_basbug_products.aciklama),
        aciklama2 = COALESCE(EXCLUDED.aciklama2, catalog.supplier_basbug_products.aciklama2),
        oem_no = COALESCE(EXCLUDED.oem_no, catalog.supplier_basbug_products.oem_no),
        liste_grubu_kodu = EXCLUDED.liste_grubu_kodu,
        arac_bilgisi = COALESCE(EXCLUDED.arac_bilgisi, catalog.supplier_basbug_products.arac_bilgisi),
        motor_bilgisi = COALESCE(EXCLUDED.motor_bilgisi, catalog.supplier_basbug_products.motor_bilgisi),
        yil_araligi = COALESCE(EXCLUDED.yil_araligi, catalog.supplier_basbug_products.yil_araligi),
        birim = COALESCE(EXCLUDED.birim, catalog.supplier_basbug_products.birim),
        para_birimi = EXCLUDED.para_birimi,
        liste_fiyati = COALESCE(EXCLUDED.liste_fiyati, catalog.supplier_basbug_products.liste_fiyati),
        raw = EXCLUDED.raw,
        last_seen_at = NOW(),
        updated_at = NOW(),
        is_passive = false,
        passive_at = NULL
    `
    upserted += Number(count)
    process.stdout.write(`\r  ${upserted}/${items.length} upserted`)
  }
  console.log(`\n\n[basbug] Done! ${upserted} products upserted for group ${grupKodu}`)
}

function derivePartNo(uk: string | undefined, malzemeNo: string): string | null {
  const brand = uk?.toUpperCase()?.trim()
  const prefixBrands = ['OE-FD', 'VIEW MAX', 'CONTITECH', 'R', 'FMY', 'ARI IS']
  if (brand && prefixBrands.includes(brand)) return malzemeNo
  const spaceIdx = malzemeNo.indexOf(' ')
  return spaceIdx > 0 ? malzemeNo.slice(spaceIdx + 1).trim() || null : null
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})