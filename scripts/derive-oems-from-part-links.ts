/**
 * catalog.product_oems içindeki source='PARTS' satırlarını
 * catalog.product_part_links üzerinden yeniden üretir.
 *
 * Neden: bu satırlar daha önce tek seferlik SQL ile yazılmıştı; hangi ürünün
 * hangi parçadan, hangi yöntemle eşleştiği hiçbir yerde kayıtlı değildi. Artık
 * her OEM satırı bir link kaydına, o da bir match_method/confidence'a kadar
 * izlenebilir ve istendiği zaman baştan üretilebilir.
 *
 * Yalnız status='CONFIRMED' link'lerden türetir. CANDIDATE link'ler adminde
 * onaylandıkça bu script tekrar çalıştırılarak akar.
 *
 * source='PART_NO' satırlarına (PSA/ORIJINAL/IOEOPEL, ürünün kendi part_no'su)
 * DOKUNMAZ — onlar parts köprüsünden gelmiyor.
 *
 * Kullanım:
 *   bun scripts/derive-oems-from-part-links.ts --dry-run
 *   bun scripts/derive-oems-from-part-links.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma } from '@prisma/client'
import { db } from '../lib/db'

const SOURCE = 'PARTS'
const SQL_NORM = (col: string) => `upper(regexp_replace(${col}, '[^A-Za-z0-9]', '', 'g'))`

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const [before] = await db.$queryRaw<{ n: bigint }[]>`
    select count(*) n from catalog.product_oems where source = ${SOURCE}
  `
  console.log(`[oem] mevcut source='${SOURCE}': ${before.n} satır${dryRun ? '  [DRY-RUN]' : ''}`)

  const result = await db.$transaction(
    async (tx) => {
      // Ürün başına (code_norm, oem_brand) bazında tekilleştir; aynı ürün birden
      // fazla parçaya bağlı olabilir ve parçalar aynı OEM kodunu paylaşabilir.
      // Marka tekilleştirmeye dahil: tek bir OEM kodu araç markası grubunun
      // tamamında geçer (55284051 → FIAT / ALFA ROMEO / LANCIA / ABARTH) ve
      // hepsi ayrı satır olarak korunmalı.
      //
      // order by, distinct on ile aynı öneki paylaşmak zorunda — ham `code`
      // tiebreak'i aynı normalize koda ait biçim varyantları ("55 284 051" vs
      // "55284051") arasındaki seçimi deterministik yapar.
      await tx.$executeRaw`
        create temp table staged on commit drop as
        select distinct on (l.product_id, ${Prisma.raw(SQL_NORM('po.code'))}, coalesce(btrim(po.brand), ''))
               l.product_id,
               po.code,
               ${Prisma.raw(SQL_NORM('po.code'))} as code_norm,
               coalesce(btrim(po.brand), '') as oem_brand
        from catalog.product_part_links l
        join part_oens po on po.part_id = l.part_id
        where l.status = 'CONFIRMED'
          and length(${Prisma.raw(SQL_NORM('po.code'))}) between 4 and 30
          and ${Prisma.raw(SQL_NORM('po.code'))} ~ '[0-9]'
        order by l.product_id, ${Prisma.raw(SQL_NORM('po.code'))}, coalesce(btrim(po.brand), ''), po.code
      `
      const [staged] = await tx.$queryRaw<{ satir: bigint; urun: bigint }[]>`
        select count(*) satir, count(distinct product_id) urun from staged
      `

      if (dryRun) return { staged, deleted: 0, inserted: 0 }

      const deleted = await tx.$executeRaw`
        delete from catalog.product_oems where source = ${SOURCE}
      `
      const inserted = await tx.$executeRaw`
        insert into catalog.product_oems (product_id, code, code_norm, oem_brand, source)
        select product_id, code, code_norm, oem_brand, ${SOURCE} from staged
        on conflict (product_id, code_norm, oem_brand) do nothing
      `
      return { staged, deleted, inserted }
    },
    { timeout: 900_000, maxWait: 60_000 }
  )

  console.log(`[oem] türetilen: ${result.staged.satir} satır · ${result.staged.urun} ürün`)
  if (dryRun) {
    console.log('[oem] DRY-RUN — hiçbir şey yazılmadı.')
  } else {
    console.log(`[oem] ${result.deleted} eski satır silindi, ${result.inserted} yeni satır yazıldı.`)
    console.log('      (fark, mevcut BSBG/PART_NO satırlarıyla code_norm çakışmasından gelir)')
  }

  await db.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await db.$disconnect()
  process.exit(1)
})
