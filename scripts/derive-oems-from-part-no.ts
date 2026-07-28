/**
 * Orijinal parça markalarında `part_no`'nun KENDİSİ bir OEM numarasıdır —
 * bunu TecDoc arşivinden (public.part_oens) DOĞRULAYIP inceleme kuyruğuna yazar.
 *
 * Neden gerekli: PSA / THAL / ORIJINAL gibi markalar muadil üretici değil,
 * orijinal parça satan kanallar. Kataloğa girerken part_no olarak zaten OEM
 * numarası taşıyorlar, ama `product_oems` boş kaldığı için bu ürünler
 * "OEM'siz" görünüyor ve OEM kazıma hedefi sanılıyor. Ölçüm (2026-07-27,
 * marka başına 150 ürünlük örneklem, ham eşleşme):
 *     PSA %59,3 · THAL %58,7 · ORIJINAL %23,3
 * Buna karşılık gerçek muadil markalarda oran sıfıra yakın (YTT %0, ART %0,
 * GKL %1,3) — yani bu yol markaya özeldir, körlemesine tüm katalog için değil.
 *
 * Kaynak neden güvenilir: veri modelden değil TecDoc arşivinden geliyor.
 * Model tabanlı OEM üretimi ölçüldü ve elendi (uydurma SKU'ların %100'üne
 * numara üretiyordu); burada uydurma riski yok, eşleşme ya vardır ya yoktur.
 *
 * NE YAPMAZ — eşleşen TecDoc parçasının DİĞER OEM'lerini almaz. Ölçüldü: tek
 * bir part_no 532 ayrı parçaya bağlanabiliyor, o parçaların OEM'lerini toplamak
 * alakasız kodlarla kuyruğu doldururdu. Yalnız part_no'nun kendisi yazılır.
 *
 * Kullanım:
 *   bun scripts/derive-oems-from-part-no.ts --dry-run
 *   bun scripts/derive-oems-from-part-no.ts --brand=PSA --limit=1000
 *   bun scripts/derive-oems-from-part-no.ts                 # PSA+THAL+ORIJINAL
 *
 * Bayraklar:
 *   --brand=X       yalnız bu marka (birden çok kez verilebilir)
 *   --limit=N       marka başına en fazla N ürün
 *   --batch=N       tek sorguda taranan ürün sayısı (varsayılan 500)
 *   --max-brands=N  bir kod bundan fazla araç markasına bağlıysa atlanır (varsayılan 8)
 *   --dry-run       kuyruğa yazma, ne bulunduğunu göster
 *
 * Kuyruğa PENDING yazar; onay Admin > Eşleştirme > Zenginleştirme ekranından.
 * Uygulama aşaması bilerek DIŞARIDA: bu öneriler kanonik tabloya
 * `source='PART_NO'` ile girmeli, `ingest-ref-suggestions.ts --apply` ise
 * `source='WEB'` yazar ve ürünün kendi part_no'sunu zaten reddeder.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma } from '@prisma/client'
import { db } from '../lib/db'
import { normalizeOem } from '../lib/matching/code-normalization'
import { createBrandResolver } from '../lib/catalog/oem-sources/oem-brand-vocab'
import {
  insertSuggestions,
  loadOemBrandVocabulary,
  SUGGESTION_KIND_OEM,
  type SuggestionRow
} from '../lib/catalog/ref-suggestions'

const SOURCE_SITE = 'tecdoc-archive'
/** Orijinal parça kanalları — ölçülmüş, gelişigüzel seçilmedi (bkz. başlık). */
const DEFAULT_BRANDS = ['PSA', 'THAL', 'ORIJINAL']

const args = process.argv.slice(2)
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const flagAll = (name: string): string[] =>
  args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.split('=')[1])

const BRANDS = flagAll('brand').length > 0 ? flagAll('brand') : DEFAULT_BRANDS
const LIMIT = flag('limit') ? Number(flag('limit')) : null
const BATCH = Number(flag('batch') ?? 500)
const MAX_BRANDS = Number(flag('max-brands') ?? 8)
const DRY_RUN = args.includes('--dry-run')

interface Product {
  id: bigint
  part_no: string
}

interface ArchiveHit {
  code: string
  brand: string
  kayit: bigint
}

/** OEM'i olmayan ürünler — kuyruğa girmiş olanlar da elenir, tekrar öneri açılmasın. */
async function loadProducts(brand: string): Promise<Product[]> {
  return db.$queryRaw<Product[]>`
    select p.id, p.part_no
    from catalog.products p
    join catalog.brands b on b.id = p.brand_id
    where b.brand = ${brand}
      and not exists (select 1 from catalog.product_oems o where o.product_id = p.id)
      and not exists (
        select 1 from catalog.product_ref_suggestions s
        where s.product_id = p.id and s.kind = ${SUGGESTION_KIND_OEM}
          and s.source_site = ${SOURCE_SITE}
      )
    order by p.id
    ${LIMIT ? Prisma.sql`limit ${LIMIT}` : Prisma.empty}
  `
}

/**
 * Arşivde bu kodların hangileri OEM olarak geçiyor, hangi araç markalarıyla.
 * Ham kod eşleşmesi kullanılır (part_oens.code index'li); normalize tarama
 * 33,9M satırda bağlantıyı koparıyor ve buradaki iddia zaten "birebir aynı
 * numara" olduğu için gevşetmeye gerek yok.
 */
async function lookupArchive(codes: string[]): Promise<Map<string, ArchiveHit[]>> {
  if (codes.length === 0) return new Map()
  const rows = await db.$queryRaw<ArchiveHit[]>`
    select po.code, po.brand, count(*)::bigint as kayit
    from public.part_oens po
    where po.code in (${Prisma.join(codes)})
    group by po.code, po.brand
  `
  const map = new Map<string, ArchiveHit[]>()
  for (const r of rows) {
    const list = map.get(r.code) ?? []
    list.push(r)
    map.set(r.code, list)
  }
  return map
}

async function main(): Promise<void> {
  const resolveBrand = createBrandResolver(await loadOemBrandVocabulary())

  let grandTotal = 0
  let grandMatched = 0
  let grandRows = 0
  let grandInserted = 0
  let grandSkippedGeneric = 0

  for (const brand of BRANDS) {
    const products = await loadProducts(brand)
    if (products.length === 0) {
      console.log(`${brand}: işlenecek ürün yok`)
      continue
    }

    let matched = 0
    let skippedGeneric = 0
    const suggestions: SuggestionRow[] = []
    const samples: string[] = []

    for (let i = 0; i < products.length; i += BATCH) {
      const chunk = products.slice(i, i + BATCH)
      // Çok kısa / rakamsız kodlar OEM sayılmaz — gürültüyü baştan ele.
      // normalizeOem null dönebilir (normalize edilince boşalan kodlar).
      const usable = chunk.flatMap((p) => {
        const norm = normalizeOem(p.part_no)
        if (!norm || norm.length < 5 || !/\d/.test(norm)) return []
        return [{ ...p, norm }]
      })
      const hits = await lookupArchive([...new Set(usable.map((p) => p.part_no))])

      for (const p of usable) {
        const found = hits.get(p.part_no)
        if (!found || found.length === 0) continue

        // Bir kod çok sayıda araç markasına bağlıysa jeneriktir (farklı
        // üreticilerde tesadüfen aynı numara) — kanıt değeri düşer, atlanır.
        if (found.length > MAX_BRANDS) {
          skippedGeneric++
          continue
        }

        matched++
        const kayitToplam = found.reduce((s, f) => s + Number(f.kayit), 0)
        const markalar = found.map((f) => f.brand).join(', ')

        // Arşivde "CITROËN/PEUGEOT" gibi birleşik yazımlar var; bölünmezse aynı
        // ürüne hem CITROËN hem CITROËN/PEUGEOT satırı açılır. Böl, sözlüğe
        // bağla, tekrarı at — unique key oem_brand içerdiği için tekrar
        // engellenmez, burada elenmeli.
        const seenBrands = new Set<string>()
        for (const f of found) {
          for (const raw of f.brand.split('/')) {
            const oemBrand = resolveBrand(raw)
            if (oemBrand === '' || seenBrands.has(oemBrand)) continue
            seenBrands.add(oemBrand)
            suggestions.push({
              productId: p.id,
              kind: SUGGESTION_KIND_OEM,
              value: p.part_no,
              valueNorm: p.norm,
              oemBrand,
              confidence: 'HIGH',
              sourceSite: SOURCE_SITE,
              sourceUrl: null,
              evidence:
                `part_no TecDoc arşivinde OEM olarak geçiyor · ` +
                `araç markası: ${f.brand} · ` +
                `arşiv kaydı: ${Number(f.kayit)} (kod toplamı ${kayitToplam}, ${found.length} marka: ${markalar})`
            })
          }
        }

        if (samples.length < 5) samples.push(`${p.part_no} → ${markalar}`)
      }
    }

    let inserted = 0
    if (!DRY_RUN && suggestions.length > 0) {
      inserted = await insertSuggestions(suggestions)
    }

    const pct = ((matched / products.length) * 100).toFixed(1)
    console.log(
      `${brand.padEnd(10)} ürün ${String(products.length).padStart(6)} · ` +
        `eşleşen ${String(matched).padStart(6)} (%${pct}) · ` +
        `öneri satırı ${String(suggestions.length).padStart(6)}` +
        (DRY_RUN ? ' · [dry-run]' : ` · yazılan ${inserted}`) +
        (skippedGeneric > 0 ? ` · jenerik atlanan ${skippedGeneric}` : '')
    )
    for (const s of samples) console.log(`             ${s}`)

    grandTotal += products.length
    grandMatched += matched
    grandRows += suggestions.length
    grandInserted += inserted
    grandSkippedGeneric += skippedGeneric
  }

  console.log(`
──────────────────────────────────────────────
taranan ürün      : ${grandTotal.toLocaleString('tr-TR')}
part_no = OEM     : ${grandMatched.toLocaleString('tr-TR')} (%${grandTotal ? ((grandMatched / grandTotal) * 100).toFixed(1) : '0'})
öneri satırı      : ${grandRows.toLocaleString('tr-TR')}
jenerik atlanan   : ${grandSkippedGeneric.toLocaleString('tr-TR')}
kuyruğa yazılan   : ${DRY_RUN ? '(dry-run)' : grandInserted.toLocaleString('tr-TR')}
──────────────────────────────────────────────
Onay: Admin > Eşleştirme > Zenginleştirme (kaynak: ${SOURCE_SITE})`)

  await db.$disconnect()
}

await main()
