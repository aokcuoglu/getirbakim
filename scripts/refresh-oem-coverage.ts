/**
 * Her katalog markası için "OEM'ini hangi kaynaktan çekebiliyoruz" sorusunu
 * yanıtlayıp `catalog.oem_brand_coverage` tablosuna yazar.
 *
 * Neden materyalize ediliyor da canlı hesaplanmıyor: kapsamın bir bölümü yerel
 * TecDoc arşivinden (`public.part_brands`) ve yerel dosyadan
 * (`data/repxpert-brand-ids.json`) türüyor; arşiv prod'da olmayabilir. Tabloya
 * yazılmazsa admin paneli prod'da kapsamı hiç gösteremezdi.
 *
 * Kapsayan kaynak, sürücünün seçtiğiyle AYNI sırayla belirlenir (bkz.
 * lib/catalog/oem-sources/index.ts) — panelde görünen kaynak ile scraper'ın
 * gerçekten kullanacağı kaynak ayrışmamalı.
 *
 * Kullanım:
 *   bun scripts/refresh-oem-coverage.ts            # yaz
 *   bun scripts/refresh-oem-coverage.ts --dry-run  # yalnız özet
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma } from '@prisma/client'
import { db } from '../lib/db'
import { createOemSources } from '../lib/catalog/oem-sources'
import { loadRepxpertBrandIds } from '../lib/catalog/oem-sources/repxpert-brands'

const REPXPERT_SITE = 'repxpert.com.tr'

interface CoverageRow {
  brandId: number
  sourceSite: string | null
  tecdocBrandId: number | null
  resolvedBy: string | null
}

/**
 * Marka id'si yerel TecDoc arşivinden gelenler. Arşivden mi aramadan mı
 * öğrenildiği kanıt değeri taşır: arama sonucu elle düzeltilebilir, arşiv
 * değeri sabittir.
 *
 * Arşiv YALNIZ yerelde var (bkz. tecdoc arşivi kararı); prod'da `part_brands`
 * tablosu bulunmadığı için sorgu hata verir. O durumda kapsam yine yazılır,
 * yalnız kaynağın nereden bilindiği 'search' görünür.
 */
async function loadArchiveBrands(): Promise<Set<string>> {
  try {
    const rows = await db.$queryRaw<{ brand: string }[]>`
      select b.brand from catalog.brands b
      join public.part_brands pb
        on upper(regexp_replace(pb.name, '[^A-Za-z0-9]', '', 'g'))
         = upper(regexp_replace(b.brand, '[^A-Za-z0-9]', '', 'g'))
    `
    return new Set(rows.map((r) => r.brand.toUpperCase()))
  } catch {
    console.warn('[coverage] public.part_brands okunamadı — arşiv/arama ayrımı yapılmayacak')
    return new Set<string>()
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const { brandIds, fromArchive } = await loadRepxpertBrandIds()
  // Kapsam sorusu için sahte taşıma yeter: hiçbir istek atılmaz, yalnız
  // `supports()` sorulur. Gerçek taşıma tarayıcı açardı.
  const sources = await createOemSources({
    repxpert: {
      brandIds,
      transport: {
        get() {
          throw new Error('refresh-oem-coverage istek atmaz')
        }
      }
    }
  })

  const brands = await db.$queryRaw<{ id: number; brand: string }[]>`
    select id, brand from catalog.brands order by id
  `

  const archiveBrands = await loadArchiveBrands()

  const rows: CoverageRow[] = brands.map(({ id, brand }) => {
    const source = sources.find((s) => s.supports(brand))
    if (!source) return { brandId: id, sourceSite: null, tecdocBrandId: null, resolvedBy: null }

    const key = brand.trim().toUpperCase()
    if (source.site !== REPXPERT_SITE) {
      // bilstein / TecAlliance kapsamı kodda sabit.
      return { brandId: id, sourceSite: source.site, tecdocBrandId: null, resolvedBy: 'builtin' }
    }
    return {
      brandId: id,
      sourceSite: source.site,
      tecdocBrandId: brandIds[key] ?? null,
      resolvedBy: archiveBrands.has(key) ? 'archive' : 'search'
    }
  })

  const kapsanan = rows.filter((r) => r.sourceSite !== null).length
  const bySite = new Map<string, number>()
  for (const r of rows) {
    if (r.sourceSite) bySite.set(r.sourceSite, (bySite.get(r.sourceSite) ?? 0) + 1)
  }
  console.log(
    `[coverage] ${rows.length} marka · kapsanan ${kapsanan} · kapsam dışı ${rows.length - kapsanan}` +
      ` (repxpert haritası: arşiv ${fromArchive} + dosya)`
  )
  for (const [site, n] of [...bySite].sort((a, b) => b[1] - a[1])) {
    console.log(`[coverage]   ${site}: ${n} marka`)
  }

  if (dryRun) {
    console.log('[coverage] DRY-RUN — yazılmadı.')
    return
  }

  // Tek deyimde upsert: kapsam değiştiğinde satır güncellenir, marka silinmişse
  // FK cascade zaten temizler.
  const values = Prisma.join(
    rows.map(
      (r) =>
        Prisma.sql`(${r.brandId}, ${r.sourceSite}, ${r.tecdocBrandId}, ${r.resolvedBy}, now())`
    )
  )
  const written = await db.$executeRaw`
    insert into catalog.oem_brand_coverage (brand_id, source_site, tecdoc_brand_id, resolved_by, checked_at)
    values ${values}
    on conflict (brand_id) do update set
      source_site = excluded.source_site,
      tecdoc_brand_id = excluded.tecdoc_brand_id,
      resolved_by = excluded.resolved_by,
      checked_at = excluded.checked_at
  `
  console.log(`[coverage] ${written} satır yazıldı.`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
