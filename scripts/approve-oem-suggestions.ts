/**
 * Bekleyen OEM önerilerini TOPLU onaylar ve kanonik tabloya uygular.
 *
 * Neden gerekli: kuyrukta 48.742 ürün / 260.955 satır PENDING bekliyordu ve
 * hiçbiri kataloğa girmemişti (`product_oems` kaynak dağılımında WEB=0,
 * PART_NO=0). Bulma işi çalışıyor, darboğaz onaydaydı — 48 bin ürünü admin
 * ekranında tek tek onaylamak mümkün değil.
 *
 * GÜVENİLİR Mİ — ölçüldü (2026-07-28, 55 öneri, Google Search grounding ile
 * bağımsız doğrulama): DOĞRU 52 · BELİRSİZ 3 · **YANLIŞ 0**. Kritik ayrıntı:
 * REPXPERT önerilerinin yalnız %33,8'i TecDoc arşivinde geçiyor, ama arşivde
 * geçmeyen 25 önerinin 25'i de web doğrulamasından geçti — yani "arşivde yok"
 * yanlışlık DEĞİL, arşiv eksik tanık. Bu yüzden arşiv eşleşmesi onay şartı
 * olarak KULLANILMIYOR.
 *
 * Varsayılan yalnız HIGH güven: MEDIUM küme (5.832 ürün) aynı yöntemle
 * ÖLÇÜLMEDİ. --confidence=MEDIUM demeden önce onu da örneklemle doğrula.
 *
 * Kaynak → product_oems.source eşlemesi:
 *   tecdoc-archive → 'PART_NO'  (ürünün kendi part_no'su zaten OEM)
 *   diğer          → 'WEB'
 * Bu ayrım şart: `ingest-ref-suggestions.ts --apply` her şeye 'WEB' yazar ve
 * ürünün kendi part_no'sunu zaten reddeder, dolayısıyla tecdoc-archive
 * önerilerini uygulayamaz.
 *
 * MARKA BAZLI HATA — neden --exclude-brand var: yanlışlık kaynağa değil
 * MARKAYA bağlı çıkabiliyor. MEDIUM kümesinde 200 öneri ölçüldüğünde
 * (2026-07-28) yanlış oranı SWAG'da %23, FORMPART %7, DELPHI %2, VALEO %0 idi.
 * SWAG'da hata rastgele değil sistematik: katalog kodu sıkıştırılmış
 * (`10919769`), TecDoc'ta ise boşluklu yazılıyor — yanlış yazılışla yapılan
 * arama YANLIŞ ÜRÜNÜ buluyor ve onun OEM'leri bizim ürüne yazılıyor
 * (VW Crafter rulmanına McCormick traktör numarası). Aynı tuzak
 * HELLA/VICTORREINZ/BOSCH için de bildirilmişti. Böyle bir marka bulunca
 * kaynağın tamamını çöpe atmak yerine o markayı hariç tut.
 *
 * Kullanım:
 *   bun scripts/approve-oem-suggestions.ts --dry-run
 *   bun scripts/approve-oem-suggestions.ts --source=tecdoc-archive --limit=1000
 *   bun scripts/approve-oem-suggestions.ts --all
 *   bun scripts/approve-oem-suggestions.ts --all --confidence=MEDIUM --exclude-brand=SWAG
 *
 * Bayraklar:
 *   --source=X        yalnız bu kaynak (birden çok kez verilebilir)
 *   --confidence=X    varsayılan HIGH
 *   --exclude-brand=X bu katalog markasını atla (birden çok kez verilebilir)
 *   --limit=N         en fazla N öneri satırı
 *   --batch=N         toplu yazma boyu (varsayılan 5000)
 *   --all             kaynak filtresi olmadan hepsi
 *   --dry-run         hiçbir şey yazma, ne olacağını göster
 *
 * Uygulanan satırlar `status='APPLIED'`, `reviewed_by='bulk-approve'` olur.
 * Yeniden çalıştırmak güvenli: APPLIED satırlar bir daha seçilmez, çakışan
 * OEM'ler `on conflict do nothing` ile atlanır.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma } from '@prisma/client'
import { db } from '../lib/db'

const args = process.argv.slice(2)
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const flagAll = (n: string) => args.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.split('=')[1])

const SOURCES = flagAll('source')
const EXCLUDE_BRANDS = flagAll('exclude-brand')
const CONFIDENCE = flag('confidence') ?? 'HIGH'
const LIMIT = flag('limit') ? Number(flag('limit')) : null
const BATCH = Number(flag('batch') ?? 5000)
const ALL = args.includes('--all')
const DRY_RUN = args.includes('--dry-run')

if (SOURCES.length === 0 && !ALL) {
  console.error('Kaynak seç (--source=repxpert.com.tr) ya da --all ver.')
  process.exit(1)
}

/** Öneri kaynağının kanonik tablodaki karşılığı. */
function sourceFor(siteId: string): string {
  return siteId === 'tecdoc-archive' ? 'PART_NO' : 'WEB'
}

interface Row {
  id: bigint
  product_id: bigint
  value: string
  value_norm: string
  oem_brand: string
  source_site: string
}

async function main(): Promise<void> {
  const where = [
    Prisma.sql`s.status = 'PENDING'`,
    Prisma.sql`s.kind = 'OEM'`,
    Prisma.sql`s.confidence = ${CONFIDENCE}`
  ]
  if (!ALL) where.push(Prisma.sql`s.source_site = any(${SOURCES})`)
  if (EXCLUDE_BRANDS.length > 0) {
    where.push(Prisma.sql`b.brand <> all(${EXCLUDE_BRANDS})`)
  }

  const rows = await db.$queryRaw<Row[]>`
    select s.id, s.product_id, s.value, s.value_norm, s.oem_brand, s.source_site
    from catalog.product_ref_suggestions s
    join catalog.products p on p.id = s.product_id
    join catalog.brands b on b.id = p.brand_id
    where ${Prisma.join(where, ' and ')}
    order by s.id
    ${LIMIT ? Prisma.sql`limit ${LIMIT}` : Prisma.empty}
  `

  if (rows.length === 0) {
    console.log('Uygulanacak öneri yok.')
    await db.$disconnect()
    return
  }

  const bySource = new Map<string, number>()
  for (const r of rows) bySource.set(r.source_site, (bySource.get(r.source_site) ?? 0) + 1)
  const products = new Set(rows.map((r) => r.product_id.toString()))

  console.log(
    `${rows.length.toLocaleString('tr-TR')} öneri satırı · ${products.size.toLocaleString('tr-TR')} ürün · güven ${CONFIDENCE}` +
      (EXCLUDE_BRANDS.length > 0 ? ` · hariç: ${EXCLUDE_BRANDS.join(', ')}` : '') +
      (DRY_RUN ? ' [DRY-RUN]' : '')
  )
  for (const [site, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${site.padEnd(20)} ${n.toLocaleString('tr-TR').padStart(9)} → source='${sourceFor(site)}'`)
  }
  if (DRY_RUN) {
    await db.$disconnect()
    return
  }

  let inserted = 0
  let marked = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)

    const values = chunk.map(
      (r) =>
        Prisma.sql`(${r.product_id}, ${r.value}, ${r.value_norm}, ${r.oem_brand}, ${sourceFor(r.source_site)})`
    )
    inserted += await db.$executeRaw(Prisma.sql`
      insert into catalog.product_oems (product_id, code, code_norm, oem_brand, source)
      values ${Prisma.join(values)}
      on conflict (product_id, code_norm, oem_brand) do nothing
    `)

    // Çakışıp eklenmeyenler de APPLIED sayılır: kuyrukta PENDING kalmaları
    // yanlış olur, o OEM zaten katalogda.
    marked += await db.$executeRaw(Prisma.sql`
      update catalog.product_ref_suggestions
      set status = 'APPLIED', applied_at = current_timestamp,
          reviewed_at = current_timestamp, reviewed_by = 'bulk-approve'
      where id in (${Prisma.join(chunk.map((r) => r.id))})
    `)

    process.stdout.write(
      `\r  işlenen ${Math.min(i + BATCH, rows.length).toLocaleString('tr-TR')}/${rows.length.toLocaleString('tr-TR')}`
    )
  }
  process.stdout.write('\n')

  console.log(`
──────────────────────────────────────────────
product_oems'e eklenen : ${inserted.toLocaleString('tr-TR')} satır
APPLIED işaretlenen    : ${marked.toLocaleString('tr-TR')} öneri
etkilenen ürün         : ${products.size.toLocaleString('tr-TR')}
──────────────────────────────────────────────
Arama indeksi bu script'ten tazelenemez (lib/search/* 'server-only'):
  bun run search:setup  ya da  scripts/catalog-reindex.sh`)

  await db.$disconnect()
}

await main()
