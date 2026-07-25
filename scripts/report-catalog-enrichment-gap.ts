/**
 * Katalog zenginleştirme boşluk raporu.
 *
 * Bağlanmamış ürünleri iki gruba ayırır:
 *
 *   KAPATILABİLİR — katalog markasının public.part_brands'te karşılığı VAR,
 *     ama part_no eşleşmedi. Daha iyi eşleştirmeyle (OEM köprüsü, bulanık kod,
 *     elle inceleme) kapatılabilir.
 *
 *   YAPISAL — katalog markasının part_brands'te karşılığı YOK. Veri o kaynakta
 *     hiç bulunmuyor; TecDoc lisansı alınsa bile gelmez. Türk/özel markalar
 *     çoğunlukla buraya düşer. Bu boşluk ancak tedarikçiden ya da elle veri
 *     girilerek kapanır.
 *
 * Kullanım:
 *   bun scripts/report-catalog-enrichment-gap.ts
 *   bun scripts/report-catalog-enrichment-gap.ts --limit 40
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { db } from '../lib/db'
import { normalizeBrandName } from '../lib/matching/code-normalization'

const BRAND_ALIASES: Record<string, string[]> = {
  FEBI: ['FEBI BILSTEIN'],
  MANN: ['MANN-FILTER'],
  LUK: ['Schaeffler LuK'],
  INA: ['Schaeffler INA'],
  FAG: ['Schaeffler FAG'],
  HERTHBUSS: ['HERTH+BUSS ELPARTS', 'HERTH+BUSS JAKOPARTS'],
  CONTINENTAL: ['CONTINENTAL CTAM', 'VDO/CONTINENTAL'],
}

const tr = (n: number) => n.toLocaleString('tr-TR')
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n)

async function main() {
  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 25 : 25

  const [brandRows, partBrands] = await Promise.all([
    db.$queryRaw<Record<string, string | bigint>[]>`
      select b.brand,
        count(*) as aktif,
        count(*) filter (where exists (select 1 from catalog.product_part_links l
                                       where l.product_id = p.id and l.status = 'CONFIRMED')) as bagli,
        count(*) filter (where not exists (select 1 from catalog.product_part_links l
                                           where l.product_id = p.id and l.status = 'CONFIRMED')
                           and exists (select 1 from catalog.product_part_links l
                                       where l.product_id = p.id and l.status = 'CANDIDATE')) as onayda,
        count(*) filter (where exists (select 1 from catalog.product_oems o
                                       where o.product_id = p.id)) as oemli
      from catalog.products p
      join catalog.brands b on b.id = p.brand_id
      where p.status = 'ACTIVE'
      group by b.brand
    `,
    db.$queryRaw<{ name: string }[]>`select name from part_brands`,
  ])

  const key = (s: string) => (normalizeBrandName(s) ?? '').replace(/ /g, '')
  const partKeys = new Set(partBrands.map((p) => key(p.name)))
  const partNames = new Set(partBrands.map((p) => p.name))

  const hasCounterpart = (brand: string): boolean =>
    partKeys.has(key(brand)) ||
    (BRAND_ALIASES[brand.toUpperCase()] ?? []).some((a) => partNames.has(a))

  interface Row {
    brand: string
    aktif: number
    bagli: number
    onayda: number
    oemli: number
    bosluk: number
    kapatilabilir: boolean
  }

  const rows: Row[] = brandRows.map((r) => {
    const aktif = Number(r.aktif)
    const bagli = Number(r.bagli)
    const onayda = Number(r.onayda)
    return {
      brand: String(r.brand),
      aktif,
      bagli,
      onayda,
      oemli: Number(r.oemli),
      bosluk: aktif - bagli - onayda,
      kapatilabilir: hasCounterpart(String(r.brand)),
    }
  })

  const sum = (f: (r: Row) => number, filter?: (r: Row) => boolean) =>
    rows.filter(filter ?? (() => true)).reduce((a, r) => a + f(r), 0)

  const toplamAktif = sum((r) => r.aktif)
  const toplamBagli = sum((r) => r.bagli)
  const toplamOnayda = sum((r) => r.onayda)
  const kapatilabilirBosluk = sum((r) => r.bosluk, (r) => r.kapatilabilir)
  const yapisalBosluk = sum((r) => r.bosluk, (r) => !r.kapatilabilir)

  console.log('\n╔═ KATALOG ZENGİNLEŞTİRME BOŞLUK RAPORU ═══════════════════════════')
  console.log(`║ Aktif ürün          ${tr(toplamAktif)}`)
  console.log(
    `║ parts'a bağlı       ${tr(toplamBagli)}  (%${Math.round((100 * toplamBagli) / toplamAktif)})`
  )
  console.log(`║ Onay bekleyen       ${tr(toplamOnayda)}`)
  console.log(
    `║ KAPATILABİLİR boşluk ${tr(kapatilabilirBosluk)}  — marka karşılığı var, kod tutmadı`
  )
  console.log(
    `║ YAPISAL boşluk       ${tr(yapisalBosluk)}  — marka part_brands'te hiç yok`
  )
  console.log('╚══════════════════════════════════════════════════════════════════\n')

  const show = (title: string, filter: (r: Row) => boolean) => {
    const list = rows.filter((r) => filter(r) && r.bosluk > 0).sort((a, b) => b.bosluk - a.bosluk)
    console.log(`### ${title} (ilk ${Math.min(limit, list.length)} / ${list.length} marka)`)
    console.log(`${pad('MARKA', 18)}${'BOŞLUK'.padStart(9)}${'AKTİF'.padStart(9)}${'BAĞLI'.padStart(9)}${'ONAYDA'.padStart(9)}`)
    for (const r of list.slice(0, limit)) {
      console.log(
        pad(r.brand, 18) +
          tr(r.bosluk).padStart(9) +
          tr(r.aktif).padStart(9) +
          tr(r.bagli).padStart(9) +
          tr(r.onayda).padStart(9)
      )
    }
    console.log()
  }

  show('KAPATILABİLİR — eşleştirme iyileştirmesi işe yarar', (r) => r.kapatilabilir)
  show('YAPISAL — bu kaynakta veri yok, lisans da çözmez', (r) => !r.kapatilabilir)

  await db.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await db.$disconnect()
  process.exit(1)
})
