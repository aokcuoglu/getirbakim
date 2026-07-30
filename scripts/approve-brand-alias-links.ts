/**
 * catalog.product_part_links üzerindeki CANDIDATE link'leri toplu onaylar.
 *
 * Neden script: BRAND_ALIAS link'lerinde part_no zaten BİREBİR eşleşiyor
 * (bkz. link-catalog-products-to-parts.ts) — 0.80 skoru kod benzerliği değil,
 * "marka adı birebir tutmadı, elle yazılmış takma addan geldi" demek. Yani
 * incelenecek şey satır satır kod değil, takma ad çiftinin kendisi. Çift başına
 * karar verilir, kuyruk da çift başına onaylanır.
 *
 * Onaydan önce her marka çifti için özet basılır ve --dry-run ile hiçbir şey
 * yazılmadan görülebilir. Onay = link CONFIRMED olur; resim/özellik/araç
 * uyumluluğu read-through olduğu için anında vitrinde görünür. OEM'ler AKMAZ,
 * ardından `bun scripts/derive-oems-from-part-links.ts` koşulmalıdır.
 *
 * Kullanım:
 *   bun scripts/approve-brand-alias-links.ts --dry-run
 *   bun scripts/approve-brand-alias-links.ts --brand FEBI
 *   bun scripts/approve-brand-alias-links.ts --reviewer alpkaan
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma } from '@prisma/client'
import { db } from '../lib/db'

interface Args {
  dryRun: boolean
  brand: string | null
  method: string
  reviewer: string
}

function parseArgs(): Args {
  const a = process.argv.slice(2)
  const get = (f: string) => {
    const i = a.indexOf(f)
    return i >= 0 && a[i + 1] ? a[i + 1] : null
  }
  return {
    dryRun: a.includes('--dry-run'),
    brand: get('--brand')?.toUpperCase() ?? null,
    method: get('--method') ?? 'BRAND_ALIAS',
    reviewer: get('--reviewer') ?? 'bulk-approve-script',
  }
}

interface PairRow {
  cat_brand: string
  part_brand: string
  n: bigint
  urun: bigint
  oemli: bigint
  toplam_oem: bigint
}

async function main() {
  const args = parseArgs()
  const brandFilter = args.brand

  // Marka çifti kırılımı: onay kararı bu tablodan verilir. Takma ad çiftlerinden
  // biri yanlış eşlenmişse burada tek satır olarak görünür ve --brand ile hariç
  // tutulabilir; satır satır gezmeye gerek kalmaz.
  const pairs = await db.$queryRaw<PairRow[]>`
    select cb.brand as cat_brand, coalesce(pb.name, '(marka yok)') as part_brand,
           count(*) n,
           count(distinct l.product_id) urun,
           count(*) filter (where o.n > 0) oemli,
           coalesce(sum(o.n), 0) toplam_oem
    from catalog.product_part_links l
    join catalog.products p on p.id = l.product_id
    join catalog.brands cb on cb.id = p.brand_id
    join parts pt on pt.id = l.part_id
    left join part_brands pb on pb.id = pt.brand_id
    cross join lateral (
      select count(*) n from part_oens po where po.part_id = l.part_id
    ) o
    where l.status = 'CANDIDATE'
      and l.match_method = ${args.method}
      and (${brandFilter}::text is null or cb.brand = ${brandFilter}::text)
    group by 1, 2
    order by n desc
  `

  if (!pairs.length) {
    console.log('[onay] onay bekleyen link yok.')
    await db.$disconnect()
    return
  }

  console.log(`[onay] ${args.method}${brandFilter ? ` · ${brandFilter}` : ''}${args.dryRun ? '  [DRY-RUN]' : ''}`)
  console.log('       katalog markası  →  parça markası           link    ürün   OEM’li      OEM')
  let toplam = BigInt(0)
  for (const r of pairs) {
    toplam += r.n
    console.log(
      `       ${r.cat_brand.padEnd(16)} →  ${r.part_brand.padEnd(22)} ` +
        `${String(r.n).padStart(6)}  ${String(r.urun).padStart(6)}  ` +
        `${String(r.oemli).padStart(6)}  ${String(r.toplam_oem).padStart(9)}`
    )
  }
  console.log(`       ${'TOPLAM'.padEnd(42)} ${String(toplam).padStart(6)}`)

  if (args.dryRun) {
    console.log('[onay] DRY-RUN — hiçbir şey yazılmadı.')
    await db.$disconnect()
    return
  }

  const brandSql = brandFilter
    ? Prisma.sql`and exists (
        select 1 from catalog.products p
        join catalog.brands cb on cb.id = p.brand_id
        where p.id = l.product_id and cb.brand = ${brandFilter}
      )`
    : Prisma.empty

  const updated = await db.$executeRaw`
    update catalog.product_part_links l
    set status = 'CONFIRMED', reviewed_at = now(), reviewed_by = ${args.reviewer}
    where l.status = 'CANDIDATE'
      and l.match_method = ${args.method}
      ${brandSql}
  `

  console.log(`[onay] ${updated} link CONFIRMED.`)
  console.log('       Sırada: bun scripts/derive-oems-from-part-links.ts')

  await db.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await db.$disconnect()
  process.exit(1)
})
