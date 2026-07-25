/**
 * catalog.products ↔ public.parts köprüsünü kurar (catalog.product_part_links).
 *
 * Katalog bir kabuk: özellik, resim, araç uyumluluğu ve OEM çapraz referansların
 * tamamı public.part_* tablolarında duruyor ama katalogla bağı yok. Bu script o
 * bağı kalıcı ve İZLENEBİLİR biçimde kurar — her satırda match_method, matched_code,
 * confidence ve status yazılı olur.
 *
 * Eşleştirme anahtarı: normalize marka + normalize part_no.
 *   EXACT_BRAND_PARTNO → status CONFIRMED (marka adları birebir)
 *   BRAND_ALIAS        → status CANDIDATE (takma ad; admin onayı bekler)
 *
 * Kullanım:
 *   bun scripts/link-catalog-products-to-parts.ts --dry-run
 *   bun scripts/link-catalog-products-to-parts.ts --brand FEBI
 *   bun scripts/link-catalog-products-to-parts.ts
 *
 * Tekrar çalıştırılabilir: uq_product_part_links üzerinde ON CONFLICT DO NOTHING.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma } from '@prisma/client'
import { db } from '../lib/db'
import { normalizeOem, normalizeBrandName } from '../lib/matching/code-normalization'

/**
 * Katalog markası → public.part_brands.name takma adları.
 * Aynı üreticinin farklı isimlendirilmiş kayıtları; birebir eşleşmediği için
 * CANDIDATE olarak işaretlenir ve adminde incelenir.
 */
const BRAND_ALIASES: Record<string, string[]> = {
  FEBI: ['FEBI BILSTEIN'],
  MANN: ['MANN-FILTER'],
  LUK: ['Schaeffler LuK'],
  INA: ['Schaeffler INA'],
  FAG: ['Schaeffler FAG'],
  HERTHBUSS: ['HERTH+BUSS ELPARTS', 'HERTH+BUSS JAKOPARTS'],
  CONTINENTAL: ['CONTINENTAL CTAM', 'VDO/CONTINENTAL'],
}

/** SQL tarafındaki normalizasyon — normalizeOem() ile birebir aynı olmalı. */
const SQL_NORM = (col: string) => `upper(regexp_replace(${col}, '[^A-Za-z0-9]', '', 'g'))`

interface Args {
  dryRun: boolean
  limit: number | null
  brand: string | null
}

function parseArgs(): Args {
  const a = process.argv.slice(2)
  const get = (f: string) => {
    const i = a.indexOf(f)
    return i >= 0 && a[i + 1] ? a[i + 1] : null
  }
  return {
    dryRun: a.includes('--dry-run'),
    limit: get('--limit') ? Number(get('--limit')) : null,
    brand: get('--brand')?.toUpperCase() ?? null,
  }
}

interface BrandPair {
  catBrandId: number
  partBrandId: number
  method: 'EXACT_BRAND_PARTNO' | 'BRAND_ALIAS'
  status: 'CONFIRMED' | 'CANDIDATE'
  confidence: number
}

/**
 * Marka çiftlerini TS tarafında kurar: normalizeBrandName() ile birebir eşleşenler
 * EXACT, BRAND_ALIASES tablosundakiler ALIAS. Normalizasyonun tek kaynağı
 * lib/matching/code-normalization.ts olsun diye eşleştirme SQL'de değil burada yapılır.
 */
function buildBrandPairs(
  catBrands: { id: number; brand: string }[],
  partBrands: { id: number; name: string }[],
  onlyBrand: string | null
): BrandPair[] {
  const key = (s: string) => (normalizeBrandName(s) ?? '').replace(/ /g, '')

  const partByKey = new Map<string, number[]>()
  const partByName = new Map<string, number>()
  for (const pb of partBrands) {
    const k = key(pb.name)
    if (k) partByKey.set(k, [...(partByKey.get(k) ?? []), pb.id])
    partByName.set(pb.name, pb.id)
  }

  const pairs: BrandPair[] = []
  const seen = new Set<string>()
  const add = (p: BrandPair) => {
    const k = `${p.catBrandId}:${p.partBrandId}`
    if (seen.has(k)) return
    seen.add(k)
    pairs.push(p)
  }

  for (const cb of catBrands) {
    if (onlyBrand && cb.brand.toUpperCase() !== onlyBrand) continue

    for (const pid of partByKey.get(key(cb.brand)) ?? []) {
      add({
        catBrandId: cb.id,
        partBrandId: pid,
        method: 'EXACT_BRAND_PARTNO',
        status: 'CONFIRMED',
        confidence: 1.0,
      })
    }

    for (const aliasName of BRAND_ALIASES[cb.brand.toUpperCase()] ?? []) {
      const pid = partByName.get(aliasName)
      if (pid === undefined) {
        console.warn(`  ! takma ad part_brands'te yok: ${cb.brand} → ${aliasName}`)
        continue
      }
      add({
        catBrandId: cb.id,
        partBrandId: pid,
        method: 'BRAND_ALIAS',
        status: 'CANDIDATE',
        confidence: 0.8,
      })
    }
  }
  return pairs
}

/**
 * SQL normalizasyonunun normalizeOem() ile aynı sonucu verdiğini örnek üzerinde
 * kanıtlar. Sapma olursa köprü sessizce yanlış eşleşir — o yüzden sert durur.
 */
async function assertNormalizationParity(): Promise<void> {
  const rows = await db.$queryRaw<{ part_no: string; sql_norm: string }[]>`
    select part_no, ${Prisma.raw(SQL_NORM('part_no'))} as sql_norm
    from parts
    where part_no is not null and part_no ~ '[^A-Za-z0-9]'
    limit 500
  `
  const mismatches = rows.filter((r) => normalizeOem(r.part_no) !== r.sql_norm)
  if (mismatches.length) {
    console.error('SQL ve normalizeOem() sonuçları ayrıştı — köprü kurulamaz:')
    for (const m of mismatches.slice(0, 5)) {
      console.error(`  "${m.part_no}": SQL="${m.sql_norm}" TS="${normalizeOem(m.part_no)}"`)
    }
    process.exit(1)
  }
  console.log(`[link] normalizasyon paritesi doğrulandı (${rows.length} örnek)`)
}

async function main() {
  const args = parseArgs()

  await assertNormalizationParity()

  const [catBrands, partBrands] = await Promise.all([
    db.$queryRaw<{ id: number; brand: string }[]>`select id, brand from catalog.brands`,
    db.$queryRaw<{ id: number; name: string }[]>`select id, name from part_brands`,
  ])

  const pairs = buildBrandPairs(catBrands, partBrands, args.brand)
  const exact = pairs.filter((p) => p.method === 'EXACT_BRAND_PARTNO').length
  console.log(
    `[link] ${pairs.length} marka çifti (${exact} birebir → CONFIRMED, ` +
      `${pairs.length - exact} takma ad → CANDIDATE)${args.dryRun ? '  [DRY-RUN]' : ''}`
  )
  if (!pairs.length) {
    await db.$disconnect()
    return
  }

  const values = Prisma.join(
    pairs.map(
      (p) =>
        Prisma.sql`(${p.catBrandId}::int, ${p.partBrandId}::int, ${p.method}::text, ${p.status}::text, ${p.confidence}::numeric)`
    )
  )
  const limitSql = args.limit ? Prisma.sql`limit ${args.limit}` : Prisma.empty

  // Tek interactive transaction: temp tablolar aynı oturumda yaşasın, public şemaya
  // kalıcı indeks eklemeden hızlı join yapabilelim.
  const result = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        create temp table bmap (
          cat_brand_id int, part_brand_id int,
          method text, status text, confidence numeric
        ) on commit drop
      `
      await tx.$executeRaw`
        insert into bmap (cat_brand_id, part_brand_id, method, status, confidence)
        values ${values}
      `

      // Sadece ilgili markaların parçalarını normalize et — tüm parts'ı taramaya gerek yok.
      await tx.$executeRaw`
        create temp table pn on commit drop as
        select p.id as part_id, p.brand_id,
               ${Prisma.raw(SQL_NORM('p.part_no'))} as norm
        from parts p
        where p.part_no is not null
          and p.brand_id in (select part_brand_id from bmap)
      `
      await tx.$executeRaw`create index on pn (brand_id, norm)`
      await tx.$executeRaw`analyze pn`

      await tx.$executeRaw`
        create temp table staged on commit drop as
        select cp.id as product_id, pn.part_id, m.method, m.status, m.confidence,
               ${Prisma.raw(SQL_NORM('cp.part_no'))} as matched_code
        from catalog.products cp
        join bmap m on m.cat_brand_id = cp.brand_id
        join pn on pn.brand_id = m.part_brand_id
               and pn.norm = ${Prisma.raw(SQL_NORM('cp.part_no'))}
        where cp.status = 'ACTIVE'
          and length(${Prisma.raw(SQL_NORM('cp.part_no'))}) >= 3
        ${limitSql}
      `

      const [stats] = await tx.$queryRaw<{ satir: bigint; urun: bigint; parca: bigint }[]>`
        select count(*) satir, count(distinct product_id) urun, count(distinct part_id) parca
        from staged
      `

      const byStatus = await tx.$queryRaw<{ status: string; method: string; n: bigint }[]>`
        select status, method, count(*) n from staged group by 1,2 order by 3 desc
      `

      let inserted = 0
      if (!args.dryRun) {
        inserted = await tx.$executeRaw`
          insert into catalog.product_part_links
            (product_id, part_id, match_method, matched_code, confidence, status)
          select product_id, part_id, method, matched_code, confidence, status from staged
          on conflict (product_id, part_id) do nothing
        `
      }
      return { stats, byStatus, inserted }
    },
    { timeout: 900_000, maxWait: 60_000 }
  )

  console.log(
    `[link] aday: ${result.stats.satir} satır · ${result.stats.urun} ürün · ${result.stats.parca} parça`
  )
  for (const r of result.byStatus) {
    console.log(`         ${r.status.padEnd(10)} ${r.method.padEnd(20)} ${r.n}`)
  }
  console.log(
    args.dryRun
      ? '[link] DRY-RUN — hiçbir şey yazılmadı.'
      : `[link] ${result.inserted} yeni link yazıldı.`
  )

  await db.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await db.$disconnect()
  process.exit(1)
})
