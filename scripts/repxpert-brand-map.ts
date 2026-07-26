/**
 * Katalog markalarının TecDoc marka id'sini REPXPERT arama ucundan öğrenir ve
 * `.data/repxpert/brand-ids.json` dosyasına yazar.
 *
 * Neden gerekli: OEM çekimi ürün kodunu `<markaId>:<parçaNo>` üzerinden kuruyor
 * (bkz. repxpert.ts). Marka id'sinin bilinen kaynağı yerel TecDoc arşivi ve o
 * arşiv katalogdaki 633 markanın yalnız 61'ini içeriyor. Kalan markaların id'si
 * ancak sitede bir parça numarası aranıp dönen ürün kodundan okunabilir.
 *
 * Bu script aynı zamanda bir ÖLÇÜMDÜR: bulunamayan markalar büyük olasılıkla
 * TecDoc'ta hiç yok (katalogdaki hacimli kalemlerin bir kısmı özel marka).
 * Öğrenilemeyenler rapor dosyasına yazılır ki kapsam tavanı görünür olsun.
 *
 * Marka başına en fazla `--samples` istek atılır ve öğrenilir öğrenilmez
 * durulur, yani tipik maliyet marka başına 1 istektir.
 *
 * Kullanım:
 *   bun scripts/repxpert-brand-map.ts --limit=50 --dry-run
 *   bun scripts/repxpert-brand-map.ts            # tüm bilinmeyen markalar
 *
 * Bayraklar:
 *   --limit=N      en fazla N marka dene (ürün sayısına göre büyükten küçüğe)
 *   --samples=N    marka başına en fazla N parça numarası dene (varsayılan 3)
 *   --interval=MS  istekler arası alt sınır (varsayılan 1000)
 *   --headless     tarayıcıyı gizli aç (UYARI: bot korumasına takılıyor)
 *   --dry-run      dosyaya yazma, ne öğrenildiğini göster
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { db } from '../lib/db'
import {
  createRepxpertBrowserTransport,
  type RepxpertBrowserTransport
} from '../lib/catalog/oem-sources/repxpert-browser'
import {
  BRAND_ID_OVERRIDES_PATH,
  loadRepxpertBrandIds
} from '../lib/catalog/oem-sources/repxpert-brands'
import { learnBrandId, searchPath } from '../lib/catalog/oem-sources/repxpert-search'

const REPORT_PATH = '.data/repxpert/brands-not-found.json'

interface UnknownBrand {
  brand: string
  oemsiz: number
  samples: string[]
}

/**
 * Id'si bilinmeyen, OEM'siz ürünü olan markalar — ürün sayısına göre sıralı,
 * her biri için birkaç örnek parça numarasıyla.
 */
async function loadUnknownBrands(known: Set<string>, samples: number): Promise<UnknownBrand[]> {
  const rows = await db.$queryRaw<{ brand: string; oemsiz: bigint; samples: string[] }[]>`
    with oemsiz as (
      select p.brand_id, p.part_no,
             row_number() over (partition by p.brand_id order by p.id) as rn,
             count(*) over (partition by p.brand_id) as toplam
      from catalog.products p
      where p.status = 'ACTIVE'
        and not exists (
          select 1 from catalog.product_oems o
          where o.product_id = p.id and o.source <> 'PART_NO'
        )
    )
    select b.brand,
           max(o.toplam) as oemsiz,
           array_agg(o.part_no order by o.rn) as samples
    from oemsiz o
    join catalog.brands b on b.id = o.brand_id
    where o.rn <= ${samples}
    group by b.brand
    order by max(o.toplam) desc
  `
  return rows
    .filter((r) => !known.has(r.brand.trim().toUpperCase()))
    .map((r) => ({ brand: r.brand, oemsiz: Number(r.oemsiz), samples: r.samples }))
}

async function learnOne(
  transport: RepxpertBrowserTransport,
  target: UnknownBrand
): Promise<{ brandId: number; siteBrand: string; viaPartNo: string } | null> {
  for (const partNo of target.samples) {
    const { status, body } = await transport.get(searchPath(partNo))
    if (status !== 200) continue
    const found = learnBrandId(body, target.brand, partNo)
    // İlk öğrenilende durulur: ek örnek istek maliyeti, doğrulama değeri getirmez
    // (kabul koşulu zaten numara + marka adı + tek adaydır).
    if (found) return { brandId: found.brandId, siteBrand: found.siteBrand, viaPartNo: partNo }
  }
  return null
}

function parseArgs(argv: string[]) {
  const flag = (name: string) => argv.includes(`--${name}`)
  const value = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const num = (name: string, fallback: number) => {
    const parsed = Number(value(name))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  return {
    limit: value('limit') ? num('limit', 0) : null,
    samples: num('samples', 3),
    intervalMs: num('interval', 1000),
    headless: flag('headless'),
    dryRun: flag('dry-run')
  }
}

let openBrowser: RepxpertBrowserTransport | null = null

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const { brandIds } = await loadRepxpertBrandIds()
  const known = new Set(Object.keys(brandIds))
  const all = await loadUnknownBrands(known, args.samples)
  const targets = args.limit ? all.slice(0, args.limit) : all

  const toplamUrun = all.reduce((sum, b) => sum + b.oemsiz, 0)
  console.log(
    `[brand-map] bilinen ${known.size} marka · bilinmeyen ${all.length} marka (${toplamUrun.toLocaleString('tr-TR')} OEM'siz ürün) · denenecek ${targets.length}`
  )
  if (targets.length === 0) return

  openBrowser = await createRepxpertBrowserTransport({
    headless: args.headless,
    minIntervalMs: args.intervalMs
  })
  console.log(`[brand-map] repxpert ${openBrowser.describeSession()}`)

  const learned: Record<string, number> = {}
  const notFound: { brand: string; oemsiz: number }[] = []
  let kapsanan = 0

  for (const [index, target] of targets.entries()) {
    let result: Awaited<ReturnType<typeof learnOne>> = null
    try {
      result = await learnOne(openBrowser, target)
    } catch (e) {
      console.warn(`[brand-map] hata ${target.brand}: ${(e as Error).message}`)
      // Engel ya da yetki hatası tek markanın sorunu değildir; koşuyu sürdürmek
      // kalan markaları da boşuna "bulunamadı" yazardı.
      throw e
    }

    if (result) {
      learned[target.brand.toUpperCase()] = result.brandId
      kapsanan += target.oemsiz
      console.log(
        `[brand-map] ${target.brand} → ${result.brandId} (${result.siteBrand}, ${result.viaPartNo}) · ${target.oemsiz.toLocaleString('tr-TR')} ürün`
      )
    } else {
      notFound.push({ brand: target.brand, oemsiz: target.oemsiz })
    }

    if ((index + 1) % 25 === 0) {
      console.log(
        `[brand-map] ${index + 1}/${targets.length} · öğrenilen ${Object.keys(learned).length} · bulunamayan ${notFound.length}`
      )
    }
  }

  console.log(
    `[brand-map] BİTTİ · öğrenilen ${Object.keys(learned).length} marka (${kapsanan.toLocaleString('tr-TR')} ürün açıldı) · bulunamayan ${notFound.length}`
  )

  if (args.dryRun) {
    console.log('[brand-map] DRY-RUN — dosyaya yazılmadı.')
    return
  }

  // Var olan dosya EZİLMEZ: elle düzeltilmiş id'ler korunmalı.
  const merged = { ...(await loadOverridesFile()), ...learned }
  await mkdir(dirname(BRAND_ID_OVERRIDES_PATH), { recursive: true })
  await writeFile(BRAND_ID_OVERRIDES_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  await writeFile(REPORT_PATH, JSON.stringify(notFound, null, 2) + '\n', 'utf8')
  console.log(`[brand-map] ${BRAND_ID_OVERRIDES_PATH} → ${Object.keys(merged).length} marka`)
  console.log(`[brand-map] bulunamayanlar: ${REPORT_PATH}`)
}

async function loadOverridesFile(): Promise<Record<string, number>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(BRAND_ID_OVERRIDES_PATH, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

main()
  .then(async () => {
    await openBrowser?.close()
    await db.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await openBrowser?.close()
    await db.$disconnect()
    process.exit(1)
  })
