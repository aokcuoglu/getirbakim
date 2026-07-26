/**
 * REPXPERT süpürmesi — hedef markaları kendisi bulup sürücüyü çağırır.
 *
 * Neden ayrı bir sarmalayıcı: sürücü (`scrape-product-oems.ts`) marka listesini
 * dışarıdan bekliyor. Listeyi elle üretip dosyada taşımak sunucuda kırılgan;
 * burada her koşuda veritabanından türetilir, yani marka haritası genişlediğinde
 * ek bir adım gerekmeden kapsama girer.
 *
 * Marka seçimi kaynak kaydının kendisine sorulur (`sourceForBrand`), yani
 * sürücünün kullanacağı kaynakla BİREBİR aynı: bilstein/TecAlliance'a giden
 * markalar listeye alınmaz, yoksa sürücü onları REPXPERT sanıp başka kaynağa
 * yönlendirirdi ve tarayıcı boşuna açık dururdu.
 *
 * Sıra ürün sayısına göre büyükten küçüğe: koşu günlerce sürdüğü için erken
 * kesilse bile en çok ürün kapanmış olur.
 *
 * Kullanım:
 *   bun scripts/repxpert-sweep.ts              # tüm kapsanan markalar
 *   bun scripts/repxpert-sweep.ts --limit=50   # marka başına en fazla 50 ürün
 *   bun scripts/repxpert-sweep.ts --plan-only  # yalnız planı yaz, koşma
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { spawn } from 'node:child_process'
import { db } from '../lib/db'
import { createOemSources, sourceForBrand } from '../lib/catalog/oem-sources'
import { loadRepxpertBrandIds } from '../lib/catalog/oem-sources/repxpert-brands'

const REPXPERT_SITE = 'repxpert.com.tr'

async function main() {
  const argv = process.argv.slice(2)
  const planOnly = argv.includes('--plan-only')
  // Sürücüye olduğu gibi geçilecek bayraklar (--limit, --dry-run, --retry …).
  const passthrough = argv.filter((a) => a !== '--plan-only')

  const { brandIds } = await loadRepxpertBrandIds()
  const sources = await createOemSources({
    repxpert: {
      brandIds,
      // Plan kurulurken istek atılmaz; yalnız `supports()` sorulur.
      transport: {
        get() {
          throw new Error('repxpert-sweep plan aşamasında istek atmaz')
        }
      }
    }
  })

  const rows = await db.$queryRaw<{ brand: string; urun: bigint }[]>`
    select b.brand, count(*) as urun
    from catalog.products p
    join catalog.brands b on b.id = p.brand_id
    where p.status = 'ACTIVE'
      and not exists (
        select 1 from catalog.product_oems o
        where o.product_id = p.id and o.source <> 'PART_NO'
      )
    group by b.brand
    order by count(*) desc
  `

  const plan = rows.filter((r) => sourceForBrand(sources, r.brand)?.site === REPXPERT_SITE)
  const toplam = plan.reduce((n, r) => n + Number(r.urun), 0)

  console.log(
    `[sweep] ${plan.length} marka · ${toplam.toLocaleString('tr-TR')} OEM'siz ürün` +
      ` (marka haritası ${Object.keys(brandIds).length})`
  )
  for (const r of plan.slice(0, 10)) {
    console.log(`[sweep]   ${r.brand}: ${Number(r.urun).toLocaleString('tr-TR')}`)
  }
  if (plan.length > 10) console.log(`[sweep]   … +${plan.length - 10} marka`)

  if (planOnly || plan.length === 0) {
    if (plan.length === 0) console.error('[sweep] kapsanan marka yok — marka haritası boş olabilir.')
    return
  }

  await db.$disconnect()

  const args = [
    'scripts/scrape-product-oems.ts',
    '--repxpert',
    '--concurrency=1',
    '--delay=0',
    ...passthrough,
    ...plan.map((r) => `--brand=${r.brand}`)
  ]
  console.log(`[sweep] sürücü başlatılıyor: bun ${args.slice(0, 4).join(' ')} … (+${plan.length} marka)`)

  // Sürücü kendi tarayıcısını açar; stdio devredilir ki günlükler kap
  // günlüğüne aksın. Çıkış kodu aynen dışarı verilir — compose'un
  // `restart: on-failure` kararı buna bakar.
  const child = spawn('bun', args, { stdio: 'inherit' })
  process.exit(await new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? 1))))
}

main().catch(async (e) => {
  console.error(e)
  await db.$disconnect()
  process.exit(1)
})
