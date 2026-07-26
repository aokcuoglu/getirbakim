/**
 * TecAlliance (TecDoc) marka katalogları.
 *
 * Bazı üreticiler kendi e-kataloglarını TecAlliance'ın barındırdığı
 * web.tecalliance.net üzerinde yayınlıyor. O arayüzün kullandığı JSON servisi
 * anahtar istemiyor ve OEM çapraz referansını araç markasıyla birlikte veriyor:
 *
 *   POST https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint
 *   { "getArticles": { "provider": <katalog kimliği>, "searchQuery": "<kod>", ... } }
 *
 * `provider` KATALOĞU seçer, markayı değil: MAHLE kataloğu (22620) yalnız
 * MAHLE/KNECHT ürünlerini döndürür, başka markanın numarası sorulursa boş
 * döner. Bu yüzden her marka için kendi provider kimliği gerekir.
 *
 * Neden local TecDoc arşivi yetmiyor: `public.parts` içindeki MAHLE kümesi bu
 * ürünleri kapsamıyor — web servisinde OEM'iyle birlikte bulunan TX1076D,
 * ACP 106 000P, CR 2104 000S kodlarının hiçbiri arşivde yok. Arşiv donmuş bir
 * kesit, servis ise güncel.
 *
 * DİKKAT — bulanık eşleşme: servis `prefix_or_suffix` ile arıyor, yani "LX95"
 * sorgusuna "LX 952" döner. Numara normalize edilip birebir karşılaştırılmazsa
 * başka bir parçanın OEM'leri bu ürüne yazılırdı.
 */
import { normalizeOem } from '../../matching/code-normalization'
import type { OemLookup, OemSource, SourcedOem } from './types'

const SITE = 'tecalliance-catalog'
const ENDPOINT =
  'https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint'

/**
 * Katalog markası → TecAlliance kataloğu. `provider` servise gider, `slug`
 * yalnız incelemecinin aynı sonucu göreceği kanıt adresini kurar. İkisi de
 * kataloğun kendi arayüzünün trafiğinden alınır.
 */
const BRAND_TO_CATALOG: Record<string, { provider: number; slug: string }> = {
  MAHLE: { provider: 22620, slug: 'mahle-catalog' },
  KNECHT: { provider: 22620, slug: 'mahle-catalog' }
}

/** Kataloğun kendi arayüzünün gönderdiği gövde; yalnız aramaya gereken alanlar. */
function buildRequest(provider: number, partNo: string) {
  return {
    getArticles: {
      applyDqmRules: true,
      articleCountry: 'DE',
      provider,
      lang: 'en',
      searchQuery: partNo,
      searchMatchType: 'prefix_or_suffix',
      searchType: 10,
      page: 1,
      perPage: 20,
      includeAll: false,
      includeLinkages: false,
      includeGenericArticles: true,
      includeArticleCriteria: false,
      includeMisc: false,
      includeImages: false,
      includeArticleText: true,
      includeOEMNumbers: true,
      includeComparableNumbers: false,
      includeTradeNumbers: false,
      includePrices: false
    }
  }
}

interface TecDocArticle {
  articleNumber?: string
  mfrName?: string
  articleText?: { text?: string }[] | null
  genericArticles?: { genericArticleDescription?: string }[] | null
  oemNumbers?: { articleNumber?: string; mfrName?: string }[] | null
}

/**
 * Yanıttan aranan parçaya AİT OEM'leri çıkarır.
 * Numarası birebir eşleşmeyen kayıtlar (bulanık sonuçlar) yok sayılır.
 */
export function parseArticles(payload: unknown, partNo: string): OemLookup {
  const wanted = normalizeOem(partNo)
  const empty: OemLookup = { matched: false, oems: [], description: null, sourceUrl: '' }
  if (!wanted) return empty

  const articles = (payload as { articles?: TecDocArticle[] } | null)?.articles
  if (!Array.isArray(articles)) return empty

  const oems: SourcedOem[] = []
  const seen = new Set<string>()
  let description: string | null = null
  let matched = false

  for (const article of articles) {
    if (normalizeOem(article?.articleNumber ?? '') !== wanted) continue
    matched = true
    description ??=
      article.genericArticles?.[0]?.genericArticleDescription?.trim() ||
      article.articleText?.[0]?.text?.trim() ||
      null

    for (const oem of article.oemNumbers ?? []) {
      const code = oem?.articleNumber?.trim()
      if (!code) continue
      const codeNorm = normalizeOem(code)
      // Parçanın kendi numarası OEM değildir (o zaten source='PART_NO').
      if (!codeNorm || codeNorm === wanted) continue
      const make = oem?.mfrName?.trim() || null
      const key = `${make ?? ''}|${codeNorm}`
      if (seen.has(key)) continue
      seen.add(key)
      oems.push({ brand: make, code })
    }
  }

  return { ...empty, matched, oems, description }
}

export interface TecDocCatalogOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export function createTecDocCatalogSource(options: TecDocCatalogOptions = {}): OemSource {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 25_000

  return {
    site: SITE,
    // Üreticinin TecDoc üzerinden yayınladığı kendi kataloğu.
    authoritative: true,

    brands: () => Object.keys(BRAND_TO_CATALOG),

    supports: (brand: string) => BRAND_TO_CATALOG[brand.trim().toUpperCase()] !== undefined,

    async lookup(brand: string, partNo: string) {
      const catalog = BRAND_TO_CATALOG[brand.trim().toUpperCase()]
      if (!catalog) throw new Error(`${SITE} bu markayı kapsamıyor: ${brand}`)
      const { provider, slug } = catalog

      const res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Servis yalnız katalog arayüzünün kökeninden gelen isteklere yanıt veriyor.
          origin: 'https://web.tecalliance.net',
          referer: 'https://web.tecalliance.net/'
        },
        body: JSON.stringify(buildRequest(provider, partNo)),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) throw new Error(`${SITE} ${res.status} ${partNo}`)

      const result = parseArticles(await res.json(), partNo)
      // Kanıt adresi: incelemecinin aynı sonucu göreceği katalog araması.
      return {
        ...result,
        sourceUrl: `https://web.tecalliance.net/${slug}/en/parts/search?query=${encodeURIComponent(partNo)}`
      }
    }
  }
}
