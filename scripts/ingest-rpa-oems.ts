/**
 * RPA (Google AI Modu) çıktısını inceleme kuyruğuna yazar.
 *
 * Üretici: oem_rpa/ (PostgreSQL → Google AI Modu tarayıcı otomasyonu → parser).
 * Bu script onun JSON çıktısını (`oem_rpa/suggestions.json`) doğrudan
 * `catalog.product_ref_suggestions`'a PENDING olarak aktarır. Böylece RPA
 * önerileri de Gemini/scraper önerileriyle AYNI onay akışından geçer
 * (Admin > Eşleştirme > Zenginleştirme + `ingest-ref-suggestions.ts --apply`).
 *
 * GÜVEN DÜZEYİ — neden hiçbiri HIGH değil: bu veri üretici kataloğundan değil,
 * web aramasından (Google AI Modu) çıkarım — Gemini grounding ile AYNI sınıf.
 *   · atıflı (kaynak URL var)  → MEDIUM
 *   · atıfsız (kaynak yok)     → LOW
 * Atıfsızları da alıyoruz ama ayrı güvenle: toplu onayda LOW dışarıda kalsın.
 *
 * Bu script SADECE OEM işler (Gemini muadili gibi). NAME/isim override başka
 * bir yoldan gider (bkz. ingest-ref-suggestions.ts NAME önerileri).
 *
 * Kullanım:
 *   bun scripts/ingest-rpa-oems.ts --file=oem_rpa/suggestions.json --dry-run
 *   bun scripts/ingest-rpa-oems.ts --file=oem_rpa/suggestions.json --min-confidence=MEDIUM
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
  SUGGESTION_KIND_NAME,
  SUGGESTION_KIND_OEM,
  type SuggestionRow
} from '../lib/catalog/ref-suggestions'
import { db } from '../lib/db'

const SOURCE_SITE = 'rpa-claude'

const args = process.argv.slice(2)
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const FILE = flag('file')
const MIN_CONF = (flag('min-confidence') ?? 'LOW').toUpperCase()
const DRY_RUN = args.includes('--dry-run')

if (!FILE) {
  console.error('--file=<rpa suggestions json> gerekli')
  process.exit(1)
}

interface RpaRow {
  product_id?: string | number
  brand: string
  sku: string
  oem_references: string[]
  oem_brands: string[]
  sources?: string[]
  grounded?: boolean
  confidence?: string | null
  product_name?: string
  error?: string | null
}

const RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(FILE!, 'utf8')) as RpaRow[]
  const resolveBrand = createBrandResolver(await loadOemBrandVocabulary())

  const suggestions: SuggestionRow[] = []
  const nameRows: { productId: bigint; title: string; confidence: string; sourceUrl: string | null; evidence: string }[] = []
  let atlanan = 0
  let idsiz = 0
  const byConf: Record<string, number> = {}

  for (const r of raw) {
    if (r.error) continue
    // product_id RPA girdisinden gelir; yoksa ürün eşleştirilemez — SKU ile
    // tahmin YAPILMAZ, aynı part_no farklı markalarda tekrar edebilir.
    if (r.product_id === undefined || r.product_id === null || r.product_id === '') {
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

    // Parça adı da OEM gibi inceleme kuyruğuna girer; provenance ve insan
    // onayı korunur, mevcut manuel override'a burada dokunulmaz.
    const title = (r.product_name ?? '').trim()
    if (title.length >= 4) {
      const sources = r.sources ?? []
      nameRows.push({ productId, title, confidence, sourceUrl: sources[0] ?? null,
        evidence: `RPA · Google AI Modu ürün adı önerisi · ${sources.length} kaynak` })
    }

    if (!r.oem_references || r.oem_references.length === 0) continue
    const seen = new Set<string>()

    for (const [i, code] of r.oem_references.entries()) {
      const codeNorm = normalizeOem(code)
      // Üretici tarafındaki eleme burada TEKRAR uygulanıyor: kuyruğa yazan yol
      // üreticinin doğru çalıştığına güvenmemeli.
      if (!codeNorm || codeNorm.length < 5 || !/\d/.test(codeNorm)) continue
      if (skuNorm && (codeNorm === skuNorm || codeNorm.startsWith(skuNorm) || skuNorm.startsWith(codeNorm))) continue

      // Tekilleştirme kod+marka'ya göre (product_oems benzersizlik anahtarıyla
      // aynı: product_id, code_norm, oem_brand). Aynı code_norm farklı markada
      // ise (ör. CHRYSLER/DODGE/JEEP 04893445AA — hepsi Stellantis) HEPSİ yazılır.
      const oemBrand = resolveBrand(r.oem_brands[i] ?? '')
      const dedupKey = `${codeNorm}${oemBrand}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)

      const kaynaklar = r.sources ?? []
      suggestions.push({
        productId,
        kind: SUGGESTION_KIND_OEM,
        value: code.trim(),
        valueNorm: codeNorm,
        oemBrand,
        confidence,
        sourceSite: SOURCE_SITE,
        sourceUrl: kaynaklar[0] ?? null,
        evidence:
          `RPA · Google AI Modu (web araması) · ` +
          `${kaynaklar.length} kaynak` +
          (r.product_name ? ` · ad önerisi: ${r.product_name.slice(0, 120)}` : '')
      })
      byConf[confidence] = (byConf[confidence] ?? 0) + 1
    }
  }

  for (const { productId, title, confidence, sourceUrl, evidence } of nameRows) {
    suggestions.push({ productId, kind: SUGGESTION_KIND_NAME, value: title,
      valueNorm: title.trim().toUpperCase(), oemBrand: '', confidence,
      sourceSite: SOURCE_SITE, sourceUrl, evidence })
  }
  const urunler = new Set(suggestions.map((s) => s.productId.toString()))
  console.log(
    `${raw.length} satır okundu → ${suggestions.length} OEM önerisi / ${urunler.size} ürün` +
      ` · ${nameRows.length} NAME önerisi` +
      (DRY_RUN ? ' [DRY-RUN]' : '')
  )
  for (const [c, n] of Object.entries(byConf)) console.log(`  OEM ${c.padEnd(7)} ${n}`)
  if (atlanan > 0) console.log(`  min-confidence altında atlanan: ${atlanan}`)
  if (idsiz > 0) console.log(`  product_id'siz atlanan: ${idsiz}`)

  if (!DRY_RUN && suggestions.length > 0) {
    const n = await insertSuggestions(suggestions)
    console.log(`kuyruğa yazılan (OEM + NAME): ${n} (çakışanlar atlandı)`)
  }

  await db.$disconnect()
}

await main()
