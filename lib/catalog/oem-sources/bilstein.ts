/**
 * bilstein group partsfinder — febi / SWAG / Blue Print resmi kataloğu.
 *
 * Neden bu kaynak: bu üç marka katalogda ~77 bin ürün tutuyor ve yarısından
 * çoğunda OEM yok. Üreticinin kendi kataloğu OEM'i araç markasıyla birlikte
 * yapısal veriyor, yani perakende sitelerinden kazınan metne göre hem daha
 * doğru hem izlenebilir.
 *
 * Uç nokta partsfinder arayüzünün kendi kullandığı JSON:API servisidir; anahtar
 * istemez ama `accept: application/vnd.api+json` ZORUNLUDUR — normal
 * `application/json` ile 406 döner.
 *
 * Dikkat: arama ucu bulanık sonuç da döndürür (numara bulunamayınca benzer
 * ürünler gelir), bu yüzden dönen kayıtların numarası normalize edilip
 * aranan numarayla birebir karşılaştırılır. SWAG numaraları katalogda bitişik
 * ("91941894"), serviste boşluklu ("91 94 1894") yazılıyor; normalize
 * karşılaştırma bunu da çözer.
 */
import { normalizeOem } from '../../matching/code-normalization'
import type { OemLookup, OemSource, SourcedOem } from './types'

const SITE = 'partsfinder.bilsteingroup.com'
const API = `https://${SITE}/api/articles`
const PAGE_URL = `https://${SITE}/en/search`
const ACCEPT = 'application/vnd.api+json'

/** Katalogdaki marka adı → servisteki marka kodu. */
const BRAND_TO_API: Record<string, string> = {
  FEBI: 'FEBI',
  'FEBI BILSTEIN': 'FEBI',
  SWAG: 'SWAG',
  BLUEPRINT: 'BLUE_PRINT',
  'BLUE PRINT': 'BLUE_PRINT',
  MOTAIR: 'MOTAIR'
}

/**
 * Servis araç tipini tek değer alıyor; binek katalogda baskın olduğu için önce
 * CAR sorulur, sonuç çıkmazsa TRUCK denenir (ikinci istek yalnız gerektiğinde).
 */
const VEHICLE_TYPES = ['CAR', 'TRUCK'] as const

interface BilsteinArticle {
  id?: string
  attributes?: {
    articleDescription?: string | null
    bgBrand?: string | null
    oeNumbers?: { make?: string | null; numbers?: string[] | null }[] | null
  }
}

export function searchUrl(apiBrand: string, partNo: string, vehicleType: string): string {
  const params = new URLSearchParams({
    'filter[phrase]': partNo,
    'filter[country]': 'TR',
    'filter[brands]': apiBrand,
    'filter[vehicleType]': vehicleType,
    'page[number]': '0',
    'page[size]': '20'
  })
  return `${API}?${params.toString()}`
}

/**
 * Servis yanıtından aranan parçaya AİT OEM'leri çıkarır.
 * Numarası birebir eşleşmeyen kayıtlar (bulanık sonuçlar) yok sayılır.
 */
export function parseArticles(payload: unknown, partNo: string): OemLookup {
  const wanted = normalizeOem(partNo)
  const empty: OemLookup = {
    matched: false,
    oems: [],
    description: null,
    sourceUrl: `${PAGE_URL}?q=${encodeURIComponent(partNo)}`
  }
  if (!wanted) return empty

  const data = (payload as { data?: BilsteinArticle[] } | null)?.data
  if (!Array.isArray(data)) return empty

  const oems: SourcedOem[] = []
  const seen = new Set<string>()
  let description: string | null = null
  let matched = false

  for (const article of data) {
    if (normalizeOem(article?.id ?? '') !== wanted) continue
    matched = true
    description ??= article.attributes?.articleDescription?.trim() || null

    for (const group of article.attributes?.oeNumbers ?? []) {
      const make = group?.make?.trim() || null
      for (const raw of group?.numbers ?? []) {
        const code = raw?.trim()
        if (!code) continue
        const codeNorm = normalizeOem(code)
        // Parçanın kendi numarası OEM değildir (o zaten source='PART_NO').
        if (!codeNorm || codeNorm === wanted) continue
        const key = `${make ?? ''}|${codeNorm}`
        if (seen.has(key)) continue
        seen.add(key)
        oems.push({ brand: make, code })
      }
    }
  }

  return { ...empty, matched, oems, description }
}

export interface BilsteinOptions {
  /** Test ve hız sınırlama için dışarıdan verilebilir. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export function createBilsteinSource(options: BilsteinOptions = {}): OemSource {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 20_000

  async function query(apiBrand: string, partNo: string, vehicleType: string): Promise<OemLookup> {
    const url = searchUrl(apiBrand, partNo, vehicleType)
    const res = await doFetch(url, {
      headers: { accept: ACCEPT },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) throw new Error(`${SITE} ${res.status} ${vehicleType} ${partNo}`)
    return parseArticles(await res.json(), partNo)
  }

  return {
    site: SITE,
    // Üreticinin kendi kataloğu.
    authoritative: true,

    brands() {
      return Object.keys(BRAND_TO_API)
    },

    supports(brand: string) {
      return BRAND_TO_API[brand.trim().toUpperCase()] !== undefined
    },

    async lookup(brand: string, partNo: string) {
      const apiBrand = BRAND_TO_API[brand.trim().toUpperCase()]
      if (!apiBrand) throw new Error(`${SITE} bu markayı kapsamıyor: ${brand}`)

      let last: OemLookup | null = null
      for (const vehicleType of VEHICLE_TYPES) {
        const result = await query(apiBrand, partNo, vehicleType)
        if (result.matched) return result
        last = result
      }
      return last as OemLookup
    }
  }
}
