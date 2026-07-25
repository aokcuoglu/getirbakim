/**
 * Bir markanın OEM çapraz referanslarını ve ürün adlarını açık web
 * kataloglarından toplar; sonucu JSONL olarak yazar (DB'ye DOKUNMAZ).
 *
 * Neden bu yol: ABA için üretici e-kataloğu sorgu döndürmüyor, TecDoc'ta
 * (public.part_brands) ABA hiç yok ve Dinamik'in oem_no alanı bu markada
 * tamamen boş. Kod başına arama motoru sorgusu ise güvenilmez (ABA kodları
 * indexlenmiyor). Buna karşılık bazı Türk yedek parça siteleri ABA'yı MARKA
 * KATALOĞU olarak yayınlıyor ve her kartta ABA kodu + OEM numarası yapısal
 * duruyor — deterministik, anahtar gerektirmeyen, kaynağı URL'ye kadar
 * izlenebilir bir kaynak.
 *
 * Çıktı satırı (JSONL):
 *   { partNo, name, oems: [{ brand, code }], sourceSite, sourceUrl, evidence }
 *
 * Kullanım:
 *   bun scripts/harvest-brand-refs.ts --site=aksam --limit=5     # deneme
 *   bun scripts/harvest-brand-refs.ts --site=aksam
 *   bun scripts/harvest-brand-refs.ts --site=otoerdem
 *   bun scripts/harvest-brand-refs.ts --site=all --out=.data/harvest/aba.jsonl
 *
 * Nazik davranır: istekler seri, aralarında gecikme var, User-Agent gerçek.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { stripVendorCodes } from '../lib/catalog/seo-name'
import { inferVehicleMaker } from '../lib/catalog/vehicle-makers'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const DELAY_MS = Number(process.env.HARVEST_DELAY_MS ?? 700)

export interface HarvestedOem {
  /** Araç markası (FIAT, BMW…); site vermiyorsa null. */
  brand: string | null
  /** OEM kodu, sitedeki biçimiyle. */
  code: string
}

export interface HarvestedRef {
  /** Marka içi parça numarası (ABA kodu). */
  partNo: string
  /** Sitedeki ürün adı (ham). */
  name: string | null
  oems: HarvestedOem[]
  sourceSite: string
  sourceUrl: string
  /** Kararı destekleyen ham metin parçası. */
  evidence: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'user-agent': UA, 'accept-language': 'tr-TR,tr;q=0.9', ...(init?.headers ?? {}) },
      redirect: 'follow'
    })
    if (!res.ok) {
      console.warn(`[harvest] ${res.status} ${url}`)
      return null
    }
    return await res.text()
  } catch (e) {
    console.warn(`[harvest] hata ${url}: ${(e as Error).message}`)
    return null
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&Uuml;/g, 'Ü')
    .replace(/&uuml;/g, 'ü')
    .replace(/&Ouml;/g, 'Ö')
    .replace(/&ouml;/g, 'ö')
    .replace(/&Ccedil;/g, 'Ç')
    .replace(/&ccedil;/g, 'ç')
    .replace(/&raquo;/g, '»')
    .replace(/&laquo;/g, '«')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
}

const clean = (value: string) => decodeEntities(value).replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------------
// aksamyedekparca.com — ABA marka listesi. Kart başına: ad + tek OEM + ABA kodu.
// ---------------------------------------------------------------------------

const AKSAM_SITE = 'aksamyedekparca.com'
const AKSAM_BRAND_PAGE = (page: number) =>
  `https://www.aksamyedekparca.com/index.php?p=Products&pub_id=1046&sort_type=rel-desc&page=${page}`

async function harvestAksam(limitPages?: number): Promise<HarvestedRef[]> {
  const out = new Map<string, HarvestedRef>()
  const maxPages = limitPages ?? 40

  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchText(AKSAM_BRAND_PAGE(page))
    if (!html) break

    let found = 0
    for (const block of html.split('<li class="items_col').slice(1)) {
      const link = block.match(
        /href="(https:\/\/www\.aksamyedekparca\.com\/aba\/[^"]+\/aba-([0-9A-Za-z.\-]+))"/
      )
      if (!link) continue
      const url = decodeEntities(link[1])
      const partNo = link[2].toUpperCase()
      const name = block.match(/<div class="name"><a[^>]*>([^<]+)<\/a>/)
      const oem = block.match(
        /prd_oemCode"><span class="left">OEM:<\/span><span[^>]*>([^<]*)<\/span>/
      )
      const oemCode = oem ? clean(oem[1]) : ''
      if (out.has(partNo)) continue
      out.set(partNo, {
        partNo,
        name: name ? clean(name[1]) : null,
        // Site araç markasını ayrı vermiyor → brand null (oem_brand '' olarak yazılır).
        oems: oemCode.length > 0 ? [{ brand: null, code: oemCode }] : [],
        sourceSite: AKSAM_SITE,
        sourceUrl: url,
        evidence: oemCode ? `OEM: ${oemCode}` : null
      })
      found++
    }

    console.log(`[harvest] ${AKSAM_SITE} sayfa ${page}: +${found} (toplam ${out.size})`)
    if (found === 0) break
    await sleep(DELAY_MS)
  }

  return [...out.values()]
}

// ---------------------------------------------------------------------------
// otoerdem.com — "aba rulman" arama listesi + ürün sayfası. Ürün sayfasında
// "Oem No: A - B - C" ve başlıkta "ABA-<kod>" ile araç markası bulunur.
// ---------------------------------------------------------------------------

const ERDEM_SITE = 'otoerdem.com'
const ERDEM_LIST = (page: number) =>
  `https://www.otoerdem.com/urunara.html?q=${encodeURIComponent('aba rulman')}&sayfa=${page}`


async function harvestOtoerdem(limitPages?: number): Promise<HarvestedRef[]> {
  // 1) Liste sayfalarından ürün URL'lerini topla.
  const urls = new Set<string>()
  const maxPages = limitPages ?? 40
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchText(ERDEM_LIST(page))
    if (!html) break
    const before = urls.size
    for (const m of html.matchAll(/href="\/?([a-zA-Z0-9-]+-urun-(\d+)\.html)"/g)) {
      urls.add(`https://www.otoerdem.com/${m[1]}`)
    }
    console.log(`[harvest] ${ERDEM_SITE} liste ${page}: +${urls.size - before} (toplam ${urls.size})`)
    if (urls.size === before) break
    await sleep(DELAY_MS)
  }

  // Aynı ürünün OEM'li/OEM'siz slug varyantları var — urun-<id> bazında tekilleştir.
  const byId = new Map<string, string>()
  for (const url of urls) {
    const id = url.match(/-urun-(\d+)\.html$/)?.[1]
    if (!id) continue
    const existing = byId.get(id)
    // Daha uzun slug OEM numaralarını da taşıyor; onu tercih et.
    if (!existing || url.length > existing.length) byId.set(id, url)
  }
  console.log(`[harvest] ${ERDEM_SITE}: ${byId.size} tekil ürün sayfası`)

  // 2) Ürün sayfalarından ABA kodu + OEM listesini çıkar.
  const out: HarvestedRef[] = []
  let n = 0
  for (const url of byId.values()) {
    n++
    const html = await fetchText(url)
    await sleep(DELAY_MS)
    if (!html) continue

    const parsed = parseOtoerdemProduct(html, url)
    if (!parsed) continue
    out.push(parsed)
    if (n % 20 === 0) console.log(`[harvest] ${ERDEM_SITE}: ${n}/${byId.size} sayfa, ${out.length} kayıt`)
  }
  return out
}

/** otoerdem ürün sayfasından ABA kodu, ad ve OEM listesini çıkarır. */
export function parseOtoerdemProduct(html: string, url: string): HarvestedRef | null {
  const title = clean(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '')
  // ABA kodu yalnız "ABA-25100603" / "ABA 25100603" biçiminde güvenilir.
  // Katalogdaki biçimler: 8 hane (25xxxxxx), nPKnnnn kayış, YKnnnnnn, sonek varyantları.
  const abaCode = html.match(
    /ABA[\s-]?((?:[0-9]{8}(?:[.\-X][0-9A-Z]{1,3})?)|(?:[0-9]{1,2}PK[0-9]{3,4}[A-Z0-9]{0,2})|(?:YK[0-9]{6}[A-Z0-9.]{0,3}))/i
  )?.[1]
  if (!abaCode) return null

  // "Oem No: 60624147 - 55190053 - 60813307" — satır HTML attribute'una taşabildiği
  // için tırnak/işaret görülünce kesilir.
  const oemLine = html.match(/Oem\s*No\s*:?\s*([^<>"\n]{3,300})/i)?.[1]
  const codes = new Set<string>()
  if (oemLine) {
    for (const raw of clean(oemLine).split(/[-,/;]|\s{2,}/)) {
      const code = raw.trim().toUpperCase()
      if (!/^[0-9A-Z][0-9A-Z.\s]{3,24}$/.test(code)) continue
      if (code.replace(/[^0-9A-Z]/g, '').length < 5) continue
      // Ürünün kendi ABA kodunu OEM sayma.
      if (code.replace(/[^0-9A-Z]/g, '') === abaCode.toUpperCase()) continue
      codes.add(code.replace(/\s+/g, ' ').trim())
    }
  }

  // Marka çıkarımı YALNIZ başlığın ürün kısmından yapılır: otoerdem'in başlık
  // kuyruğu site adını taşıyor ("» Oto Erdem Renault Fiat Yedek Parça") ve tüm
  // ürünlere RENAULT/FIAT bulaştırırdı.
  const titleHead = title.split(/[»|]/)[0]
  const maker = inferVehicleMaker(titleHead)
  // Başlıktaki "» Oto Erdem …" kuyruğunu, OEM numaralarını ve satıcı stok
  // kodlarını (SUS-BG0040-02, SAGEM-2012 gibi rakam içeren tireli kodlar)
  // addan ayıkla — bunlar başlığa girerse SEO değil gürültü olur.
  const name = stripVendorCodes(titleHead.replace(/ABA[\s-]?[0-9A-Z]+/gi, ' '))

  return {
    partNo: abaCode.toUpperCase(),
    name: name.length > 3 ? name : null,
    oems: [...codes].map((code) => ({ brand: maker, code })),
    sourceSite: ERDEM_SITE,
    sourceUrl: url,
    evidence: oemLine ? `Oem No: ${clean(oemLine).slice(0, 200)}` : null
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const site = args.find((a) => a.startsWith('--site='))?.split('=')[1] ?? 'all'
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '0') || undefined
  const out = args.find((a) => a.startsWith('--out='))?.split('=')[1] ?? '.data/harvest/aba.jsonl'

  const rows: HarvestedRef[] = []
  if (site === 'aksam' || site === 'all') rows.push(...(await harvestAksam(limit)))
  if (site === 'otoerdem' || site === 'all') rows.push(...(await harvestOtoerdem(limit)))
  if (rows.length === 0) {
    console.error(`[harvest] hiç kayıt toplanmadı (site=${site}) — çıktı yazılmadı.`)
    process.exit(1)
  }

  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

  const withOem = rows.filter((r) => r.oems.length > 0).length
  const oemCount = rows.reduce((n, r) => n + r.oems.length, 0)
  console.log(
    `[harvest] ${rows.length} ürün · ${withOem} tanesinde OEM · toplam ${oemCount} OEM satırı → ${out}`
  )
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
