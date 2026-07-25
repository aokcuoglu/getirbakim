/**
 * catalog.brands.slug / display_name alanlarını doldurur.
 *
 * Marka sayfası URL'i ve görünen adı bugüne kadar runtime'da
 * catalog.ptdrk_brands üzerinden hesaplanıyordu. ParcaTedarik projeden
 * çıkarılmadan ÖNCE bu değerler kalıcılaştırılmalı; aksi halde 408 marka
 * sayfasının URL'i değişir (blue-print → blueprint) ve 39 markanın yazımı
 * bozulur (Blue Print → BLUEPRINT).
 *
 * Slug, mevcut davranışla birebir aynı olsun diye SQL'de değil, gerçek
 * toBrandSlug() fonksiyonuyla TS tarafında hesaplanır.
 *
 * Kullanım:
 *   bun scripts/backfill-brand-slugs.ts --dry-run
 *   bun scripts/backfill-brand-slugs.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma } from '@prisma/client'
import { db } from '../lib/db'
import { toBrandSlug } from '../lib/v0/brandSlug'

interface Row {
  brand_id: number
  brand: string
  pt_name: string | null
  pt_url_key: string | null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  // getDbrandsMatch'teki gruplamayla aynı kaynak: APPROVED mapping'ler.
  // Grup başına tek marka olduğu doğrulandı (627 grup, hepsi 1 brand_id).
  const rows = await db.$queryRaw<Row[]>`
    select m.brand_id,
           cb.brand,
           max(pt.name)    as pt_name,
           max(pt.url_key) as pt_url_key
    from catalog.brand_mappings m
    join catalog.brands cb on cb.id = m.brand_id
    left join catalog.ptdrk_brands pt on pt.id = m.ptdrk_brand_id
    where m.mapping_status = 'APPROVED'
      and btrim(cb.brand) <> ''
    group by m.brand_id, cb.brand
  `

  const candidates = rows
    .map((r) => {
      const displayName = r.pt_name?.trim() || r.brand.trim()
      const preferred = toBrandSlug(r.pt_url_key, displayName)
      const ownName = toBrandSlug(null, r.brand)
      return { id: r.brand_id, brand: r.brand, displayName, preferred, ownName }
    })
    .filter((c) => c.preferred)

  /**
   * slug UNIQUE olduğu için çakışmalar deterministik çözülmeli.
   * Kural: slug'ı, adı o slug'a zaten denk gelen marka kazanır.
   * Çakışmaların hepsinde ptdrk url_key'i hatalı eşleşmiş (AYK→"apali",
   * IBRAS→"nifea", BEHRMAHLE→"mahle"); bu kural doğru sahibi seçer ve
   * kaybeden kendi adından türeyen slug'a düşer.
   */
  candidates.sort((a, b) => {
    const aSelf = a.preferred === a.ownName ? 0 : 1
    const bSelf = b.preferred === b.ownName ? 0 : 1
    return aSelf - bSelf || a.id - b.id
  })

  const seen = new Map<string, string>()
  const updates: { id: number; slug: string; displayName: string }[] = []
  const reassigned: string[] = []

  for (const c of candidates) {
    let slug = c.preferred
    if (seen.has(slug)) {
      const fallback = c.ownName
      if (!fallback || seen.has(fallback)) {
        reassigned.push(`${c.brand}: "${slug}" alınmış, yedek de yok → ATLANDI`)
        continue
      }
      reassigned.push(`${c.brand}: "${slug}" → "${fallback}" (çakışma, sahibi ${seen.get(slug)})`)
      slug = fallback
    }
    seen.set(slug, c.brand)
    updates.push({ id: c.id, slug, displayName: c.displayName })
  }

  console.log(`[slug] ${rows.length} onaylı marka, ${updates.length} güncellenecek`)
  if (reassigned.length) {
    console.warn(`[slug] ${reassigned.length} çakışma çözüldü:`)
    for (const c of reassigned) console.warn(`   ${c}`)
  }

  if (dryRun) {
    for (const u of updates.slice(0, 10)) {
      console.log(`   ${String(u.id).padStart(5)}  ${u.slug.padEnd(28)} ${u.displayName}`)
    }
    console.log('[slug] DRY-RUN — yazılmadı.')
    await db.$disconnect()
    return
  }

  const values = Prisma.join(
    updates.map((u) => Prisma.sql`(${u.id}::int, ${u.slug}::text, ${u.displayName}::text)`)
  )
  const written = await db.$executeRaw`
    update catalog.brands b
    set slug = v.slug, display_name = v.display_name
    from (values ${values}) as v(id, slug, display_name)
    where b.id = v.id
  `

  console.log(`[slug] ${written} marka güncellendi.`)
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await db.$disconnect()
  process.exit(1)
})
