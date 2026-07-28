/**
 * Gemini + Google Search grounding çıktısını inceleme kuyruğuna yazar.
 *
 * Üretici script `.data/llm-oem-test/gemini-oem-grounded.py` (Vertex AI); bu
 * script onun JSON çıktısını `catalog.product_ref_suggestions`'a PENDING
 * olarak aktarır. Böylece LLM önerileri de scraper önerileriyle AYNI onay
 * akışından geçer (admin ekranı + `approve-oem-suggestions.ts`).
 *
 * GÜVEN DÜZEYİ — neden hiçbiri HIGH değil: bu veri üretici kataloğundan değil,
 * web aramasından çıkarım. Ölçüm (2026-07-28, 500 ürün, kaynaksız markalar):
 * isabet %39, marka bazında %22 (PSA) ile %52 (KRAFTVOLL) arasında değişiyor.
 *   · atıflı (grounding_chunks dolu) → MEDIUM
 *   · atıfsız (model aradı ama atıf üretmedi) → LOW
 * Atıfsızları da alıyoruz ama ayrı güvenle: toplu onayda LOW dışarıda kalsın.
 *
 * Kullanım:
 *   bun scripts/ingest-gemini-oems.ts --file=.data/llm-oem-test/cost-500-result.json --dry-run
 *   bun scripts/ingest-gemini-oems.ts --file=... --min-confidence=MEDIUM
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { readFile } from 'node:fs/promises'
import { normalizeOem } from '../lib/matching/code-normalization'
import { createBrandResolver } from '../lib/catalog/oem-sources/oem-brand-vocab'
import {
  insertSuggestions,
  loadOemBrandVocabulary,
  SUGGESTION_KIND_OEM,
  type SuggestionRow
} from '../lib/catalog/ref-suggestions'
import { db } from '../lib/db'

const SOURCE_SITE = 'gemini-grounding'

const args = process.argv.slice(2)
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const FILE = flag('file')
const MIN_CONF = (flag('min-confidence') ?? 'LOW').toUpperCase()
const DRY_RUN = args.includes('--dry-run')

if (!FILE) {
  console.error('--file=<gemini json> gerekli')
  process.exit(1)
}

interface GeminiRow {
  product_id?: string
  brand: string
  sku: string
  supplier_name: string
  oem_references: string[]
  oem_brands: string[]
  sources?: string[]
  search_queries?: string[]
  confidence?: string | null
  grounded?: boolean
  error?: string | null
}

const RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(FILE!, 'utf8')) as GeminiRow[]
  const resolveBrand = createBrandResolver(await loadOemBrandVocabulary())

  const suggestions: SuggestionRow[] = []
  let atlanan = 0
  let idsiz = 0
  const byConf: Record<string, number> = {}

  for (const r of raw) {
    if (r.error || r.oem_references.length === 0) continue
    // product_id üretici CSV'sinden gelir; yoksa ürün eşleştirilemez — SKU ile
    // tahmin YAPILMAZ, aynı part_no farklı markalarda tekrar edebilir.
    if (!r.product_id) {
      idsiz++
      continue
    }
    const confidence = r.confidence ?? (r.grounded ? 'MEDIUM' : 'LOW')
    if ((RANK[confidence] ?? 0) < (RANK[MIN_CONF] ?? 0)) {
      atlanan++
      continue
    }

    const productId = BigInt(r.product_id)
    const skuNorm = normalizeOem(r.sku)
    const seen = new Set<string>()

    for (const [i, code] of r.oem_references.entries()) {
      const codeNorm = normalizeOem(code)
      // Python tarafındaki eleme burada TEKRAR uygulanıyor: kuyruğa yazan yol
      // üreticinin doğru çalıştığına güvenmemeli.
      if (!codeNorm || codeNorm.length < 5 || !/\d/.test(codeNorm)) continue
      if (skuNorm && (codeNorm === skuNorm || codeNorm.startsWith(skuNorm) || skuNorm.startsWith(codeNorm))) continue
      if (seen.has(codeNorm)) continue
      seen.add(codeNorm)

      const kaynaklar = r.sources ?? []
      suggestions.push({
        productId,
        kind: SUGGESTION_KIND_OEM,
        value: code.trim(),
        valueNorm: codeNorm,
        oemBrand: resolveBrand(r.oem_brands[i] ?? ''),
        confidence,
        sourceSite: SOURCE_SITE,
        sourceUrl: kaynaklar[0] ?? null,
        evidence:
          `Gemini + Google Search grounding · ` +
          `${kaynaklar.length} kaynak` +
          (r.search_queries?.length ? ` · arama: ${r.search_queries.slice(0, 3).join(' | ')}` : '')
      })
      byConf[confidence] = (byConf[confidence] ?? 0) + 1
    }
  }

  const urunler = new Set(suggestions.map((s) => s.productId.toString()))
  console.log(
    `${raw.length} satır okundu → ${suggestions.length} öneri / ${urunler.size} ürün` +
      (DRY_RUN ? ' [DRY-RUN]' : '')
  )
  for (const [c, n] of Object.entries(byConf)) console.log(`  ${c.padEnd(7)} ${n}`)
  if (atlanan > 0) console.log(`  min-confidence altında atlanan: ${atlanan}`)
  if (idsiz > 0) console.log(`  product_id'siz atlanan: ${idsiz}`)

  if (!DRY_RUN && suggestions.length > 0) {
    const n = await insertSuggestions(suggestions)
    console.log(`kuyruğa yazılan: ${n} (çakışanlar atlandı)`)
  }

  await db.$disconnect()
}

await main()
