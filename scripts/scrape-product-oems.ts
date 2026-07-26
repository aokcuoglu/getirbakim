/**
 * catalog.products'taki OEM'i olmayan ürünlerin OEM çapraz referanslarını web
 * kaynaklarından çeker ve inceleme kuyruğuna (catalog.product_ref_suggestions)
 * PENDING olarak yazar. Kanonik tablolara DOĞRUDAN YAZMAZ — onay
 * Admin > Eşleştirme > Zenginleştirme ekranından ya da
 * `bun scripts/ingest-ref-suggestions.ts --apply` ile uygulanır.
 *
 * Kaynaklar lib/catalog/oem-sources/ altındaki adapter'lardır; her adapter
 * yalnız kapsadığı markaları bildirir, script hedefleri ona göre seçer.
 *   · bilstein group partsfinder — febi / SWAG / Blue Print (ücretsiz, resmi)
 *   · TecAlliance kataloğu — MAHLE / KNECHT
 *   · REPXPERT (--repxpert) — TecDoc'un tamamı, ürün başına tek istek; gerçek
 *     tarayıcı oturumu açar (bot koruması), bu yüzden açıkça istenmelidir
 *   · web aramalı model (--llm) — marka bağımsız, ÜCRETLİ, ürün başına çağrı
 *
 * Kullanım:
 *   bun scripts/scrape-product-oems.ts --brand=FEBI --limit=20 --dry-run
 *   bun scripts/scrape-product-oems.ts --brand=FEBI --limit=2000
 *   bun scripts/scrape-product-oems.ts --all --concurrency=3
 *   bun scripts/scrape-product-oems.ts --repxpert --brand=VALEO --limit=200
 *   bun scripts/scrape-product-oems.ts --brand=ABA --llm --limit=10 --dry-run
 *   bun scripts/scrape-product-oems.ts --list-sources
 *
 * Bayraklar:
 *   --brand=X        yalnız bu marka (birden çok kez verilebilir)
 *   --all            kaynakların kapsadığı, katalogda var olan tüm markalar
 *   --limit=N        marka başına en fazla N ürün
 *   --concurrency=N  eşzamanlı istek (varsayılan 3 — kaynağa nazik davran)
 *   --delay=MS       istekler arası bekleme (varsayılan 300)
 *   --retry=N        geçici hatada yeniden deneme (varsayılan 2)
 *   --dry-run        hiçbir şey yazma, ne bulunduğunu göster
 *   --no-checkpoint  daha önce sorgulanıp boş dönen ürünleri de yeniden sor
 *   --llm            resmi kataloğu olmayan markalarda web aramalı modeli kullan
 *                    (ANTHROPIC_API_KEY gerekir; ürün başına ücret doğar —
 *                     koşu sonunda harcanan token/arama özeti yazılır)
 *   --llm-model=X    model kimliği (varsayılan claude-opus-5)
 *   --llm-effort=X   low | medium | high (varsayılan low)
 *   --repxpert       REPXPERT kaynağını aç (tarayıcı oturumu açılır)
 *   --repxpert-headless  tarayıcıyı gizli aç (UYARI: bot korumasına takılıyor)
 *   --repxpert-interval=MS  istekler arası ALT SINIR (varsayılan 1000 ≈ 1/sn);
 *                    --concurrency ne olursa olsun bu tempo aşılmaz
 *
 * Yeniden çalıştırma ucuzdur: önerisi olan ürünler SQL'de, sorgulanıp sonuç
 * çıkmayanlar checkpoint dosyasında (.data/scrape/<site>.attempted) elenir.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { Prisma } from '@prisma/client'
import { db } from '../lib/db'
import { createOemSources } from '../lib/catalog/oem-sources'
import type { LlmWebSource, OemLookup, OemSource } from '../lib/catalog/oem-sources'
import {
  createRepxpertBrowserTransport,
  type RepxpertBrowserTransport
} from '../lib/catalog/oem-sources/repxpert-browser'
import { loadRepxpertBrandIds } from '../lib/catalog/oem-sources/repxpert-brands'
import { createBrandResolver } from '../lib/catalog/oem-sources/oem-brand-vocab'
import {
  insertSuggestions,
  loadOemBrandVocabulary,
  SUGGESTION_KIND_OEM,
  type SuggestionRow
} from '../lib/catalog/ref-suggestions'
import { normalizeOem } from '../lib/matching/code-normalization'
import { inferVehicleMakers, sameMakerFamily } from '../lib/catalog/vehicle-makers'

const CHECKPOINT_DIR = '.data/scrape'
/** Öneriler bu sayıya ulaşınca yazılır — uzun koşu yarıda kesilirse iş kaybolmasın. */
const FLUSH_EVERY = 200

interface Target {
  id: bigint
  part_no: string
  name: string
  brand: string
}

interface Stats {
  queried: number
  matched: number
  withOem: number
  suggested: number
  inserted: number
  failed: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Hedef seçimi
// ---------------------------------------------------------------------------

/** Kaynağın kapsadığı markalardan katalogda GERÇEKTEN bulunanlar. */
async function brandsInCatalog(candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) return []
  const rows = await db.$queryRaw<{ brand: string }[]>`
    select b.brand
    from catalog.brands b
    where upper(b.brand) in (${Prisma.join(candidates.map((c) => c.toUpperCase()))})
      and exists (select 1 from catalog.products p where p.brand_id = b.id)
  `
  return rows.map((r) => r.brand)
}

/**
 * OEM'i olmayan ürünler. 'PART_NO' kaynaklı satır OEM sayılmaz: o, ürünün kendi
 * numarasının kopyasıdır, çapraz referans değildir.
 *
 * Bu kaynakta daha önce öneri açılmış ürünler dışlanır — reddedilmiş öneriyi
 * tekrar üretmek incelemeciyi aynı kararı iki kez vermeye zorlar.
 */
async function loadTargets(site: string, brand: string, limit: number | null): Promise<Target[]> {
  const rows = await db.$queryRaw<Target[]>`
    select p.id, p.part_no, p.name, b.brand
    from catalog.products p
    join catalog.brands b on b.id = p.brand_id
    where b.brand = ${brand}
      and p.status = 'ACTIVE'
      and not exists (
        select 1 from catalog.product_oems o
        where o.product_id = p.id and o.source <> 'PART_NO'
      )
      and not exists (
        select 1 from catalog.product_ref_suggestions s
        where s.product_id = p.id and s.kind = ${SUGGESTION_KIND_OEM} and s.source_site = ${site}
      )
    order by p.id
    ${limit ? Prisma.sql`limit ${limit}` : Prisma.empty}
  `
  return rows
}

// ---------------------------------------------------------------------------
// Checkpoint — sorgulanmış ama sonuç çıkmamış ürünler
// ---------------------------------------------------------------------------

const checkpointPath = (site: string) => `${CHECKPOINT_DIR}/${site}.attempted`

async function loadCheckpoint(site: string): Promise<Set<string>> {
  try {
    const text = await readFile(checkpointPath(site), 'utf8')
    return new Set(text.split('\n').filter((line) => line.trim().length > 0))
  } catch {
    return new Set()
  }
}

async function appendCheckpoint(site: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await mkdir(CHECKPOINT_DIR, { recursive: true })
  await appendFile(checkpointPath(site), ids.join('\n') + '\n', 'utf8')
}

// ---------------------------------------------------------------------------
// Öneri kurma
// ---------------------------------------------------------------------------

/**
 * Güven düzeyi.
 *
 * Resmi üretici kataloğu (authoritative) taban HIGH'dır; ürünün KENDİ adındaki
 * araç bilgisiyle çeliştiğinde MEDIUM'a iner. Çelişki neden LOW değil: ürün
 * adları çoğu kez yer tutucu ("FEBI 19570") ya da tek bir aracı anan tedarikçi
 * metni; resmi listeyle uyuşmaması genelde adın eksikliğinden kaynaklanır.
 *
 * Çıkarımsal kaynak (web araması) HIGH'a ÇIKAMAZ — kaynak sayfası doğru
 * okunmuş olsa bile sayfanın kendisi yanlış olabilir. Taban MEDIUM, ad
 * çelişkisinde LOW: incelemeci önce bunlara bakmalı.
 */
function scoreConfidence(productName: string, oemBrand: string, authoritative: boolean): string {
  if (oemBrand.length === 0) return authoritative ? 'MEDIUM' : 'LOW'
  const nameMakers = inferVehicleMakers(productName)
  if (nameMakers.length === 0) return authoritative ? 'HIGH' : 'MEDIUM'
  const agrees = nameMakers.some((m) => sameMakerFamily(m, oemBrand.toUpperCase()))
  if (authoritative) return agrees ? 'HIGH' : 'MEDIUM'
  return agrees ? 'MEDIUM' : 'LOW'
}

function buildRows(
  target: Target,
  lookup: { oems: { brand: string | null; code: string }[]; description: string | null; sourceUrl: string },
  source: Pick<OemSource, 'site' | 'authoritative'>,
  resolveBrand: (raw: string) => string
): SuggestionRow[] {
  const partNoNorm = normalizeOem(target.part_no)
  const rows: SuggestionRow[] = []
  const seen = new Set<string>()

  for (const oem of lookup.oems) {
    const codeNorm = normalizeOem(oem.code)
    // Kodun anlamlı olması için: en az 5 karakter ve içinde rakam.
    // Kısa/harf-only "kodlar" kaynaklarda çoğu kez ölçü ya da not oluyor.
    if (!codeNorm || codeNorm.length < 5 || !/\d/.test(codeNorm)) continue
    if (codeNorm === partNoNorm) continue

    const oemBrand = oem.brand ? resolveBrand(oem.brand) : ''
    const key = `${codeNorm}|${oemBrand}`
    if (seen.has(key)) continue
    seen.add(key)

    rows.push({
      productId: target.id,
      kind: SUGGESTION_KIND_OEM,
      value: oem.code.trim(),
      valueNorm: codeNorm,
      oemBrand,
      confidence: scoreConfidence(target.name, oemBrand, source.authoritative),
      sourceSite: source.site,
      sourceUrl: lookup.sourceUrl || null,
      evidence: [lookup.description, `${oemBrand || 'OEM'}: ${oem.code.trim()}`]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 500)
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Koşu
// ---------------------------------------------------------------------------

interface RunOptions {
  source: OemSource
  brand: string
  limit: number | null
  concurrency: number
  delayMs: number
  retries: number
  dryRun: boolean
  useCheckpoint: boolean
  resolveBrand: (raw: string) => string
}

async function lookupWithRetry(
  source: OemSource,
  target: Target,
  retries: number
): Promise<OemLookup> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await source.lookup(target.brand, target.part_no, target.name)
    } catch (e) {
      lastError = e
      // Üstel geri çekilme: kaynak yavaşladıysa ya da hız sınırı uyguladıysa
      // aynı tempoda ısrar etmek durumu kötüleştirir.
      if (attempt < retries) await sleep(1000 * 2 ** attempt)
    }
  }
  throw lastError
}

async function runBrand(opts: RunOptions): Promise<Stats> {
  const { source, brand, dryRun, useCheckpoint, resolveBrand } = opts
  const stats: Stats = { queried: 0, matched: 0, withOem: 0, suggested: 0, inserted: 0, failed: 0 }

  const targets = await loadTargets(source.site, brand, opts.limit)
  const checkpoint = useCheckpoint ? await loadCheckpoint(source.site) : new Set<string>()
  const queue = targets.filter((t) => !checkpoint.has(t.id.toString()))

  console.log(
    `[scrape] ${brand}: OEM'siz ${targets.length} ürün · ${targets.length - queue.length} tanesi daha önce sorulmuş → ${queue.length} sorgulanacak`
  )
  if (queue.length === 0) return stats

  const pending: SuggestionRow[] = []
  const attempted: string[] = []
  let cursor = 0

  const flush = async () => {
    if (pending.length > 0 && !dryRun) {
      stats.inserted += await insertSuggestions(pending.splice(0))
    } else {
      pending.length = 0
    }
    if (attempted.length > 0 && !dryRun) {
      await appendCheckpoint(source.site, attempted.splice(0))
    } else {
      attempted.length = 0
    }
  }

  const worker = async () => {
    while (cursor < queue.length) {
      const target = queue[cursor++]
      const at = cursor
      try {
        const lookup = await lookupWithRetry(source, target, opts.retries)
        stats.queried++
        if (lookup.matched) stats.matched++

        const rows = buildRows(target, lookup, source, resolveBrand)
        if (rows.length > 0) {
          stats.withOem++
          stats.suggested += rows.length
          pending.push(...rows)
          if (dryRun && stats.withOem <= 10) {
            console.log(
              `   ${brand} ${target.part_no} → ${rows.map((r) => `${r.oemBrand || '?'} ${r.value}`).join(', ')}`
            )
          }
        } else {
          // Kaynakta yok ya da OEM'i yok: bir daha sorma.
          attempted.push(target.id.toString())
        }
      } catch (e) {
        // Başarısız ürün checkpoint'e YAZILMAZ: sonraki koşuda tekrar denensin.
        stats.failed++
        if (stats.failed <= 5) console.warn(`[scrape] hata ${brand} ${target.part_no}: ${(e as Error).message}`)
      }

      if (at % 100 === 0) {
        console.log(
          `[scrape] ${brand} ${at}/${queue.length} · eşleşen ${stats.matched} · OEM'li ${stats.withOem} · hata ${stats.failed}`
        )
      }
      if (pending.length >= FLUSH_EVERY) await flush()
      if (opts.delayMs > 0) await sleep(opts.delayMs)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker))
  await flush()
  return stats
}

// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const flag = (name: string) => argv.includes(`--${name}`)
  const value = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const num = (name: string, fallback: number) => {
    const raw = value(name)
    const parsed = raw === undefined ? NaN : Number(raw)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return {
    brands: argv.filter((a) => a.startsWith('--brand=')).map((a) => a.slice(8).toUpperCase()),
    all: flag('all'),
    listSources: flag('list-sources'),
    limit: Number.isFinite(Number(value('limit'))) && value('limit') ? Number(value('limit')) : null,
    concurrency: num('concurrency', 3),
    delayMs: num('delay', 300),
    retries: num('retry', 2),
    dryRun: flag('dry-run'),
    useCheckpoint: !flag('no-checkpoint'),
    llm: flag('llm'),
    llmModel: value('llm-model'),
    llmEffort: value('llm-effort'),
    repxpert: flag('repxpert'),
    repxpertHeadless: flag('repxpert-headless'),
    repxpertIntervalMs: num('repxpert-interval', 1000)
  }
}

/**
 * Açık tarayıcı; koşu nasıl biterse bitsin (hata dahil) kapatılmalı, yoksa
 * süreç asılı kalır.
 */
let openBrowser: RepxpertBrowserTransport | null = null

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.llm && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      '[scrape] --llm için ANTHROPIC_API_KEY gerekli (web aramalı model kaynağı ücretlidir).'
    )
    process.exit(1)
  }

  // REPXPERT tarayıcı açar; koşu nasıl biterse bitsin kapatılmalı.
  let repxpertTransport: RepxpertBrowserTransport | null = null
  let repxpertBrandIds: Record<string, number> | null = null
  if (args.repxpert) {
    const { brandIds, fromArchive, fromOverrides } = await loadRepxpertBrandIds()
    console.log(
      `[scrape] repxpert marka haritası: ${Object.keys(brandIds).length} marka (arşiv ${fromArchive} · dosya ${fromOverrides})`
    )
    repxpertTransport = openBrowser = await createRepxpertBrowserTransport({
      headless: args.repxpertHeadless,
      minIntervalMs: args.repxpertIntervalMs
    })
    console.log(`[scrape] repxpert ${await repxpertTransport.describeSession()}`)
    repxpertBrandIds = brandIds
  }

  const sources = await createOemSources({
    llm: args.llm
      ? {
          model: args.llmModel,
          effort: (args.llmEffort as 'low' | 'medium' | 'high' | undefined) ?? 'low'
        }
      : false,
    repxpert:
      repxpertTransport && repxpertBrandIds
        ? { transport: repxpertTransport, brandIds: repxpertBrandIds }
        : false
  })

  if (args.listSources) {
    for (const s of sources) {
      const scope = s.brands().length > 0 ? s.brands().join(', ') : 'tüm markalar'
      console.log(`${s.site} (${s.authoritative ? 'resmi' : 'çıkarımsal'}): ${scope}`)
    }
    return
  }

  // Marka → kaynak eşlemesi: her marka onu kapsayan ilk kaynağa gider.
  // --all yalnız MARKA BİLDİREN kaynakları kapsar: web aramalı kaynak marka
  // bağımsızdır, onu --all ile tüm katalog üzerinde çalıştırmak ürün başına
  // ücretli bir çağrı demek olurdu. Onun için markayı açıkça vermek gerekir.
  const requested = args.all
    ? await brandsInCatalog([...new Set(sources.flatMap((s) => s.brands()))])
    : args.brands
  if (requested.length === 0) {
    console.error('[scrape] --brand=<MARKA> ya da --all gerekli. Kapsanan markalar için --list-sources.')
    process.exit(1)
  }

  const plan: { source: OemSource; brand: string }[] = []
  for (const brand of requested) {
    const source = sources.find((s) => s.supports(brand))
    if (!source) {
      console.warn(`[scrape] ${brand}: kapsayan kaynak yok, atlanıyor.`)
      continue
    }
    plan.push({ source, brand })
  }
  if (plan.length === 0) process.exit(1)

  const resolveBrand = createBrandResolver(await loadOemBrandVocabulary())
  const total: Stats = { queried: 0, matched: 0, withOem: 0, suggested: 0, inserted: 0, failed: 0 }

  for (const { source, brand } of plan) {
    const stats = await runBrand({
      source,
      brand,
      limit: args.limit,
      concurrency: args.concurrency,
      delayMs: args.delayMs,
      retries: args.retries,
      dryRun: args.dryRun,
      useCheckpoint: args.useCheckpoint,
      resolveBrand
    })
    for (const key of Object.keys(total) as (keyof Stats)[]) total[key] += stats[key]
  }

  console.log(
    `[scrape] BİTTİ · sorgulanan ${total.queried} · kaynakta bulunan ${total.matched} · OEM çıkan ${total.withOem} · öneri ${total.suggested} · yazılan ${total.inserted} · hata ${total.failed}`
  )

  // Ücretli kaynağın tüketimi: ne harcandığı koşu sonunda görünmeli, faturada
  // değil. Fiyatlar değişebildiği için para değil, sayaç raporlanır.
  const llm = sources.find((s) => 'usage' in s) as LlmWebSource | undefined
  if (llm) {
    const u = llm.usage()
    console.log(
      `[scrape] model kullanımı · istek ${u.requests} · web araması ${u.webSearches} · girdi ${u.inputTokens.toLocaleString('tr-TR')} token · çıktı ${u.outputTokens.toLocaleString('tr-TR')} token`
    )
  }
  if (args.dryRun) console.log('[scrape] DRY-RUN — hiçbir şey yazılmadı.')
  else if (total.inserted > 0) console.log('[scrape] İnceleme: Admin > Eşleştirme > Zenginleştirme')
}

main()
  .then(async () => {
    await openBrowser?.close()
    await db.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await openBrowser?.close()
    await db.$disconnect()
    process.exit(1)
  })
