/**
 * catalog.products.category_id'yi onaylı product_part_links üzerinden doldurur.
 *
 * Neden: katalogdaki 1.085.367 aktif ürünün HİÇBİRİNİN kategorisi yoktu. Kategori
 * sayfaları bu yüzden yalnızca Meilisearch'ün kategori ADI ile eşleştirme
 * yedeğinden ürün bulabiliyordu — kırılgan ve düşük kapsamlı. Kategori bilgisi
 * TecDoc arşivinde (public.parts.category_id) zaten var; onaylı eşleşmesi olan
 * ürün onu devralabilir.
 *
 * Çok kategorili durum: bir ürün birden çok parçaya bağlıysa (~3,3 bin ürün)
 * parçalar farklı kategoride olabiliyor. En çok tekrar eden kategori seçilir;
 * beraberlikte en küçük category_id — sonuç deterministik olsun diye, aksi hâlde
 * her koşuda başka kategori yazıp ürünü sayfalar arasında gezdirirdi.
 *
 * Yalnız category_id'si BOŞ ürünlere yazar: admin `product_overrides
 * .category_override_id` ile elle kategori verebiliyor ve bu script onu ezmemeli.
 *
 * CANDIDATE link'ler adminde onaylandıkça tekrar çalıştırılarak akar.
 *
 * Kullanım:
 *   bun scripts/derive-categories-from-part-links.ts --dry-run
 *   bun scripts/derive-categories-from-part-links.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { db } from '../lib/db'

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const [before] = await db.$queryRaw<{ toplam: bigint; dolu: bigint }[]>`
    select count(*) as toplam,
           count(*) filter (where category_id is not null) as dolu
    from catalog.products
    where status = 'ACTIVE'
  `
  console.log(
    `[kategori] aktif ürün: ${before.toplam} · kategorisi olan: ${before.dolu}` +
      (dryRun ? '  [DRY-RUN]' : '')
  )

  // Ürün başına tek kategori seç: en çok tekrar eden, beraberlikte en küçük id.
  const pickSql = `
    with linked as (
      select l.product_id, p.category_id, count(*) as n
      from catalog.product_part_links l
      join public.parts p on p.id = l.part_id
      where l.status = 'CONFIRMED' and p.category_id is not null
      group by 1, 2
    ), ranked as (
      select product_id, category_id,
             row_number() over (
               partition by product_id
               order by n desc, category_id asc
             ) as rn
      from linked
    )
    select product_id, category_id from ranked where rn = 1
  `

  const [candidate] = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*) as n from (${pickSql}) t
     join catalog.products pr on pr.id = t.product_id
     where pr.status = 'ACTIVE' and pr.category_id is null`
  )
  console.log(`[kategori] yazılabilecek ürün: ${candidate.n}`)

  if (dryRun) {
    const ornek = await db.$queryRawUnsafe<
      { product_id: bigint; urun: string; kategori: string }[]
    >(
      `select t.product_id, pr.name as urun, c.name as kategori
       from (${pickSql}) t
       join catalog.products pr on pr.id = t.product_id
       join public.part_categories c on c.id = t.category_id
       where pr.status = 'ACTIVE' and pr.category_id is null
       limit 5`
    )
    for (const r of ornek) {
      console.log(`  #${r.product_id} ${r.urun.slice(0, 46)} → ${r.kategori}`)
    }
    console.log('[kategori] DRY-RUN — hiçbir şey yazılmadı.')
    return
  }

  const written = await db.$executeRawUnsafe(
    `update catalog.products pr
        set category_id = t.category_id
       from (${pickSql}) t
      where pr.id = t.product_id
        and pr.status = 'ACTIVE'
        and pr.category_id is null`
  )

  const [after] = await db.$queryRaw<{ dolu: bigint }[]>`
    select count(*) filter (where category_id is not null) as dolu
    from catalog.products
    where status = 'ACTIVE'
  `
  console.log(`[kategori] yazılan: ${written} · kategorisi olan (sonra): ${after.dolu}`)
}

main()
  .catch((error) => {
    console.error('[kategori] HATA:', error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
