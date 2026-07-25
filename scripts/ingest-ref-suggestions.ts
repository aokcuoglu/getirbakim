/**
 * harvest-brand-refs.ts çıktısını (JSONL) inceleme kuyruğuna yazar ve
 * onaylanan önerileri kanonik katalog tablolarına uygular.
 *
 * Akış:
 *   1) bun scripts/harvest-brand-refs.ts --site=all         → .data/harvest/aba.jsonl
 *   2) bun scripts/ingest-ref-suggestions.ts --brand=ABA --file=.data/harvest/aba.jsonl [--dry-run]
 *        → catalog.product_ref_suggestions'a PENDING satırlar
 *   3) Admin > Eşleştirme > Zenginleştirme ekranında onay/ret
 *   4) bun scripts/ingest-ref-suggestions.ts --apply
 *        → APPROVED satırlar catalog.product_oems (source='WEB') ve
 *          catalog.product_overrides.name_override'a yazılır, status='APPLIED'
 *
 * --seed-names: web verisi olmadan, mevcut tedarikçi adını SEO başlığına çevirip
 * NAME önerisi üretir (yeni bilgi uydurmaz, yalnız biçim düzeltir).
 *
 * Doğrulama kuralları (OEM):
 *   · normalize kod >= 5 karakter ve en az bir rakam içerir
 *   · ürünün kendi part_no'suyla aynı olamaz (o zaten source='PART_NO')
 *   · aynı ürün+kod+marka için tekrar öneri açılmaz (unique index)
 *   · zaten product_oems'de olan kod atlanır
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { readFile } from 'node:fs/promises'
import { Prisma } from '@prisma/client'
import { db } from '../lib/db'
import { normalizeOem } from '../lib/matching/code-normalization'
import {
  buildSeoProductName,
  isPlaceholderName,
  mergeWebTitles,
  stripVendorCodes
} from '../lib/catalog/seo-name'
import { inferVehicleMakers, sameMakerFamily } from '../lib/catalog/vehicle-makers'
import type { HarvestedRef } from './harvest-brand-refs'

const KIND_OEM = 'OEM'
const KIND_NAME = 'NAME'
const APPLIED_SOURCE = 'WEB'
const ACTOR = 'harvest-script'

interface CatalogProduct {
  id: bigint
  part_no: string
  part_no_norm: string
  name: string
}

interface SuggestionRow {
  productId: bigint
  kind: string
  value: string
  valueNorm: string
  oemBrand: string
  confidence: string
  sourceSite: string
  sourceUrl: string | null
  evidence: string | null
}

async function loadBrandProducts(brand: string): Promise<Map<string, CatalogProduct>> {
  const rows = await db.$queryRaw<CatalogProduct[]>`
    select p.id, p.part_no, p.part_no_norm, p.name
    from catalog.products p
    join catalog.brands b on b.id = p.brand_id
    where b.brand = ${brand}
  `
  return new Map(rows.map((r) => [r.part_no_norm, r]))
}

/** Ürün başına zaten var olan OEM kodları — tekrar öneri açmamak için. */
async function loadExistingOems(productIds: bigint[]): Promise<Map<string, Set<string>>> {
  if (productIds.length === 0) return new Map()
  const rows = await db.$queryRaw<{ product_id: bigint; code_norm: string }[]>`
    select product_id, code_norm from catalog.product_oems
    where product_id in (${Prisma.join(productIds)})
  `
  const out = new Map<string, Set<string>>()
  for (const r of rows) {
    const key = r.product_id.toString()
    if (!out.has(key)) out.set(key, new Set())
    out.get(key)!.add(r.code_norm)
  }
  return out
}

/**
 * OEM önerisinin güven düzeyi.
 *
 *   HIGH   — araç markası tespit edildi ve ürünün kendi adındaki araç bilgisiyle
 *            tutarlı (aynı marka ya da aynı OEM ailesi), ya da ürünün adı zaten
 *            araç bilgisi taşımıyor (çelişecek bir şey yok)
 *   MEDIUM — kaynak araç markası vermemiş
 *   LOW    — marka tespit edildi AMA ürünün adındaki araçlarla çelişiyor.
 *            Tipik hata kaynağı: aynı ABA kodunun başka bir aracın sayfasında
 *            listelenmesi. İnceleyen önce bunlara bakmalı.
 *
 * Ürün adları marka yerine model yazdığı için ("ASTRA G / H VECTRA C"), ad
 * tarafındaki markalar da model haritasıyla çıkarılır.
 */
function scoreOemConfidence(product: CatalogProduct, oemBrand: string | null): string {
  if (!oemBrand) return 'MEDIUM'
  const nameMakers = inferVehicleMakers(product.name)
  if (nameMakers.length === 0) return 'HIGH'
  const brand = oemBrand.trim().toUpperCase()
  return nameMakers.some((m) => sameMakerFamily(m, brand)) ? 'HIGH' : 'LOW'
}

function buildOemSuggestions(
  harvested: HarvestedRef[],
  products: Map<string, CatalogProduct>,
  existing: Map<string, Set<string>>
): { rows: SuggestionRow[]; skipped: Record<string, number> } {
  const rows: SuggestionRow[] = []
  const skipped: Record<string, number> = {
    'ürün yok': 0,
    'kısa/geçersiz kod': 0,
    'ürünün kendi kodu': 0,
    'zaten mevcut': 0
  }

  for (const ref of harvested) {
    const key = normalizeOem(ref.partNo)
    const product = key ? products.get(key) : undefined
    if (!product) {
      skipped['ürün yok']++
      continue
    }
    const have = existing.get(product.id.toString()) ?? new Set<string>()

    for (const oem of ref.oems) {
      const codeNorm = normalizeOem(oem.code)
      if (!codeNorm || codeNorm.length < 5 || !/\d/.test(codeNorm)) {
        skipped['kısa/geçersiz kod']++
        continue
      }
      if (codeNorm === product.part_no_norm) {
        skipped['ürünün kendi kodu']++
        continue
      }
      if (have.has(codeNorm)) {
        skipped['zaten mevcut']++
        continue
      }
      rows.push({
        productId: product.id,
        kind: KIND_OEM,
        value: oem.code.trim(),
        valueNorm: codeNorm,
        oemBrand: oem.brand?.trim().toUpperCase() ?? '',
        confidence: scoreOemConfidence(product, oem.brand),
        sourceSite: ref.sourceSite,
        sourceUrl: ref.sourceUrl,
        evidence: ref.evidence
      })
    }
  }
  return { rows, skipped }
}

function buildNameSuggestion(
  product: CatalogProduct,
  rawName: string,
  brandLabel: string,
  sourceSite: string,
  sourceUrl: string | null,
  confidence: string
): SuggestionRow | null {
  const title = buildSeoProductName({
    brandLabel,
    rawName,
    partNo: product.part_no
  })
  if (!title) return null
  if (title === product.name) return null
  return {
    productId: product.id,
    kind: KIND_NAME,
    value: title,
    valueNorm: title.toUpperCase(),
    oemBrand: '',
    confidence,
    sourceSite,
    sourceUrl,
    evidence: `ham ad: ${rawName.slice(0, 180)}`
  }
}

async function insertSuggestions(rows: SuggestionRow[], dryRun: boolean): Promise<number> {
  if (rows.length === 0 || dryRun) return 0
  let inserted = 0
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map(
      (r) => Prisma.sql`(${r.productId}, ${r.kind}, ${r.value}, ${r.valueNorm}, ${r.oemBrand},
        ${r.confidence}, ${r.sourceSite}, ${r.sourceUrl}, ${r.evidence})`
    )
    inserted += await db.$executeRaw(Prisma.sql`
      insert into catalog.product_ref_suggestions
        (product_id, kind, value, value_norm, oem_brand, confidence, source_site, source_url, evidence)
      values ${Prisma.join(values)}
      on conflict (product_id, kind, value_norm, oem_brand) do nothing
    `)
  }
  return inserted
}

// ---------------------------------------------------------------------------

async function runIngest(opts: {
  brand: string
  file: string
  seedNames: boolean
  dryRun: boolean
  limit?: number
}) {
  const { brand, file, seedNames, dryRun, limit } = opts
  const brandLabel = process.env.HARVEST_BRAND_LABEL ?? 'A.B.A.'

  const products = await loadBrandProducts(brand)
  console.log(`[ingest] ${brand}: ${products.size} kanonik ürün`)

  const harvested: HarvestedRef[] = []
  if (file) {
    const text = await readFile(file, 'utf8')
    for (const line of text.split('\n')) {
      if (line.trim().length > 0) harvested.push(JSON.parse(line) as HarvestedRef)
    }
    console.log(`[ingest] ${harvested.length} toplanmış kayıt okundu: ${file}`)
  }

  const matchedIds = new Set<bigint>()
  for (const ref of harvested) {
    const p = products.get(normalizeOem(ref.partNo) ?? '')
    if (p) matchedIds.add(p.id)
  }
  const existing = await loadExistingOems([...matchedIds])

  const { rows: oemRows, skipped } = buildOemSuggestions(harvested, products, existing)

  // NAME önerileri:
  //   · Yer tutucu adlı ürünlerde ("ABA 25100603") tek kaynak webdir.
  //   · Tedarikçi adı zaten açıklayıcıysa web adı ÖNERİLMEZ: siteler çoğu kez
  //     jenerik ("V KAYIŞ GERGİ RULMANI") ya da tek araca özel başlık kullanıyor,
  //     bu da mevcut ada göre araç bilgisi kaybı ya da çelişki demek. O ürünlerde
  //     yalnız kendi adının biçim düzeltmesi (--seed-names) önerilir.
  //   · Aynı ürün için birden çok site başlığı varsa TEK ada birleştirilir
  //     (mergeWebTitles): siteler parçayı tek araca göre adlandırıyor, birini
  //     seçmek ürünün uyduğu araçların çoğunu adın dışında bırakırdı.
  const nameRows: SuggestionRow[] = []
  const seenNameProducts = new Set<string>()

  const webTitlesByProduct = new Map<
    string,
    { product: CatalogProduct; titles: string[]; sites: Set<string>; url: string | null }
  >()
  for (const ref of harvested) {
    const product = products.get(normalizeOem(ref.partNo) ?? '')
    if (!product || !ref.name) continue
    if (!isPlaceholderName(product.name, brand, product.part_no)) continue
    const key = product.id.toString()
    const entry = webTitlesByProduct.get(key) ?? {
      product,
      titles: [],
      sites: new Set<string>(),
      url: ref.sourceUrl
    }
    entry.titles.push(stripVendorCodes(ref.name))
    entry.sites.add(ref.sourceSite)
    webTitlesByProduct.set(key, entry)
  }

  for (const entry of webTitlesByProduct.values()) {
    // Birleştirme parça tipini bulamazsa (beklenmedik başlık düzeni) ilk başlığa düş.
    const merged = mergeWebTitles(entry.titles) ?? entry.titles[0]
    const row = buildNameSuggestion(
      entry.product,
      merged,
      brandLabel,
      [...entry.sites].join('+'),
      entry.url,
      entry.titles.length > 1 ? 'HIGH' : 'MEDIUM'
    )
    if (row) {
      nameRows.push(row)
      seenNameProducts.add(entry.product.id.toString())
    }
  }

  if (seedNames) {
    for (const product of products.values()) {
      if (seenNameProducts.has(product.id.toString())) continue
      const row = buildNameSuggestion(product, product.name, brandLabel, 'derived', null, 'HIGH')
      if (row) nameRows.push(row)
    }
  }

  const all = limit ? [...oemRows, ...nameRows].slice(0, limit) : [...oemRows, ...nameRows]
  const inserted = await insertSuggestions(all, dryRun)

  console.log(`[ingest] OEM önerisi: ${oemRows.length} · NAME önerisi: ${nameRows.length}`)
  console.log(`[ingest] atlanan: ${JSON.stringify(skipped)}`)
  if (dryRun) {
    console.log('[ingest] DRY-RUN — hiçbir şey yazılmadı. Örnekler:')
    for (const r of all.slice(0, 10)) {
      console.log(
        `   ${r.kind} · ürün ${r.productId} · ${r.oemBrand ? r.oemBrand + ' ' : ''}${r.value} · ${r.sourceSite}`
      )
    }
  } else {
    console.log(`[ingest] ${inserted} yeni öneri yazıldı (tekrarlar atlandı).`)
  }
}

// ---------------------------------------------------------------------------

async function runApply(dryRun: boolean) {
  const approved = await db.$queryRaw<
    {
      id: bigint
      product_id: bigint
      kind: string
      value: string
      value_norm: string
      oem_brand: string
    }[]
  >`
    select id, product_id, kind, value, value_norm, oem_brand
    from catalog.product_ref_suggestions
    where status = 'APPROVED'
    order by kind, id
  `
  if (approved.length === 0) {
    console.log('[apply] Onaylanmış öneri yok.')
    return
  }

  const oems = approved.filter((r) => r.kind === KIND_OEM)
  const names = approved.filter((r) => r.kind === KIND_NAME)
  console.log(`[apply] ${oems.length} OEM · ${names.length} ad önerisi uygulanacak${dryRun ? ' [DRY-RUN]' : ''}`)
  if (dryRun) return

  const touched = new Set<string>()

  if (oems.length > 0) {
    const values = oems.map(
      (r) =>
        Prisma.sql`(${r.product_id}, ${r.value}, ${r.value_norm}, ${r.oem_brand}, ${APPLIED_SOURCE})`
    )
    const n = await db.$executeRaw(Prisma.sql`
      insert into catalog.product_oems (product_id, code, code_norm, oem_brand, source)
      values ${Prisma.join(values)}
      on conflict (product_id, code_norm, oem_brand) do nothing
    `)
    console.log(`[apply] product_oems: ${n} satır eklendi (source='${APPLIED_SOURCE}')`)
    oems.forEach((r) => touched.add(r.product_id.toString()))
  }

  // Ad override'ı: aynı ürün için birden çok onaylı ad varsa en son onaylanan kazanır.
  // product_overrides tek satırlık yan tablo — diğer alanlar (fiyat/kilit/not)
  // KORUNMALI, bu yüzden upsert yerine hedefli update/insert.
  for (const r of names) {
    await db.$executeRaw`
      insert into catalog.product_overrides (product_id, name_override, updated_by)
      values (${r.product_id}, ${r.value}, ${ACTOR})
      on conflict (product_id) do update
        set name_override = excluded.name_override,
            updated_by = excluded.updated_by,
            updated_at = current_timestamp
    `
    touched.add(r.product_id.toString())
  }
  if (names.length > 0) console.log(`[apply] name_override: ${names.length} ürün güncellendi`)

  await db.$executeRaw`
    update catalog.product_ref_suggestions
    set status = 'APPLIED', applied_at = current_timestamp
    where id in (${Prisma.join(approved.map((r) => r.id))})
  `

  // Arama indeksi buradan tazelenemez: lib/search/* 'server-only' işaretli,
  // CLI'dan import edilemiyor. Admin ekranından onaylananlar anında indekslenir;
  // bu toplu yol için indeksi ayrıca tazele.
  console.log(
    `[apply] ${touched.size} ürün değişti — arama indeksi için: bun run search:setup ya da scripts/catalog-reindex.sh`
  )
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const apply = args.includes('--apply')
  const seedNames = args.includes('--seed-names')
  const brand = args.find((a) => a.startsWith('--brand='))?.split('=')[1] ?? 'ABA'
  const file = args.find((a) => a.startsWith('--file='))?.split('=')[1] ?? ''
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '0') || undefined

  if (apply) {
    await runApply(dryRun)
  } else {
    if (!file && !seedNames) {
      console.error('[ingest] --file=<jsonl> ya da --seed-names gerekli.')
      process.exit(1)
    }
    await runIngest({ brand, file, seedNames, dryRun, limit })
  }
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await db.$disconnect()
  process.exit(1)
})
