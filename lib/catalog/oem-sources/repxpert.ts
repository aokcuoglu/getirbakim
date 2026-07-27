/**
 * REPXPERT (Schaeffler) — TecDoc kataloğunun tamamı üzerinden OEM çapraz referansı.
 *
 * Neden bu kaynak: elimizdeki diğer kaynaklar marka başına tek tek ekleniyor
 * (bilstein üç markayı, TecAlliance kataloğu MAHLE'yi kapsıyor) ve katalogdaki
 * 633 markanın çoğu açıkta kalıyordu. REPXPERT canlı TecDoc verisini yayınlıyor:
 * VALEO, DELPHI, HELLA gibi kendi kataloğuna erişemediğimiz markalar da burada.
 *
 * Uç nokta sitenin kendi SAP Commerce (Spartacus) OCC servisidir:
 *
 *   GET /api/Repxpert-TR/products/<kod>/oenumbers?lang=tr&curr=RXP&catalogCountry=TR
 *   → {"oenumbers":[{"manufacturer":{"name":"VOLVO"},
 *                    "numbers":[{"number":"21602741","normalizedNumber":"21602741"}]}]}
 *
 * ÜRÜN KODU HESAPLANABİLİR — arama yapmaya gerek yok:
 *
 *   Ext-TA-<base64("<tecdocMarkaId>:<parçaNo>")>       (padding '=' atılır)
 *   örn. base64("101:01092") → "Ext-TA-MTAxOjAxMDky"   (FEBI BILSTEIN 01092)
 *
 * Yani ürün başına TEK istek. Marka id'si TecDoc tedarikçi numarasıdır ve
 * `public.part_brands.id` ile birebir aynıdır (FEBI 101, VALEO 21, DELPHI 89).
 *
 * DİKKAT — parça numarası biçimi: kod, numaranın TecDoc'taki YAZILIŞINI ister
 * (ASMET'te "01.044", noktasız hâli değil). Katalogdaki yazılış tutmazsa servis
 * 400 döner. Bu tek başına bırakıldığında sessiz ve büyük bir veri kaybıydı:
 * BOSCH "0 445 110 274"ü, SWAG "10 92 6750"yi, HELLA "1ND 010 377-071"i
 * boşluklu yazıyor, katalog ise sıkıştırılmış tutuyor — bu markaların TÜM
 * ürünleri "kaynakta yok" sayılıp checkpoint'e yazıldı (42 bin ürün).
 *
 * Bu yüzden 400'de iki düzeltme denenir:
 *   1. Numaranın başındaki marka öneki atılır ("REINZ 01-31555-01" → "01-31555-01").
 *   2. Arama ucuna (/products/search) sorulur; yanıt hem TecDoc'taki yazılışı
 *      hem ürün kodunu verir, OEM'ler o kodla çekilir.
 * İkisi de tutmazsa sonuç gerçekten yoktur; uydurma sonuç üretilmez.
 *
 * DİKKAT — taşıma katmanı: servisin önünde Akamai bot yönetimi var; düz
 * sunucu-taraflı fetch "Access denied" alır. Bu yüzden istek `RepxpertTransport`
 * arkasına alındı ve üretimde gerçek tarayıcı oturumundan geçirilir
 * (bkz. repxpert-browser.ts). Testler sahte taşıma verir.
 */
import { normalizeOem } from '../../matching/code-normalization'
import { findArticleCode, searchPath, stripBrandPrefix } from './repxpert-search'
import type { OemLookup, OemSource, SourcedOem } from './types'

const SITE = 'repxpert.com.tr'
const ORIGIN = `https://www.${SITE}`
const API_BASE = `${ORIGIN}/api/Repxpert-TR`
const QUERY = 'lang=tr&curr=RXP&catalogCountry=TR'

/** OCC servisine giden tek istek biçimi; üretimde tarayıcı, testte sahte. */
export interface RepxpertTransport {
  /** ORIGIN'e göreli yol. Ağ hatası fırlatır; HTTP hatası `status` ile döner. */
  get(path: string): Promise<{ status: number; body: unknown }>
}

/** base64url değil, düz base64 — yalnız sondaki '=' dolgusu atılır. */
export function encodeProductCode(tecdocBrandId: number, partNo: string): string {
  const raw = `${tecdocBrandId}:${partNo.trim()}`
  return `Ext-TA-${Buffer.from(raw, 'utf8').toString('base64').replace(/=+$/, '')}`
}

export function oeNumbersPath(code: string): string {
  return `/api/Repxpert-TR/products/${encodeURIComponent(code)}/oenumbers?${QUERY}`
}

/** İncelemecinin aynı sonucu göreceği sayfa. */
export function productUrl(code: string): string {
  return `${ORIGIN}/tr/catalog/p-${code}`
}

interface OeNumbersPayload {
  oenumbers?:
    | {
        manufacturer?: { name?: string | null } | null
        numbers?: { number?: string | null; normalizedNumber?: string | null }[] | null
      }[]
    | null
}

/**
 * Yanıttan OEM'leri çıkarır.
 *
 * Burada bilstein/TecAlliance'taki gibi "numarası eşleşiyor mu" denetimi YOK:
 * bu uç bulanık arama değil, kimliği verilen ürünün kendi kaydıdır — hangi
 * ürünü sorduğumuzu kodun kendisi belirliyor. Yine de parçanın kendi numarası
 * OEM listesine düşerse elenir (o zaten source='PART_NO').
 */
export function parseOeNumbers(payload: unknown, partNo: string): SourcedOem[] {
  const groups = (payload as OeNumbersPayload | null)?.oenumbers
  if (!Array.isArray(groups)) return []

  const wanted = normalizeOem(partNo)
  const oems: SourcedOem[] = []
  const seen = new Set<string>()

  for (const group of groups) {
    const make = group?.manufacturer?.name?.trim() || null
    for (const entry of group?.numbers ?? []) {
      const code = entry?.number?.trim()
      if (!code) continue
      const codeNorm = normalizeOem(code)
      if (!codeNorm || codeNorm === wanted) continue
      // Servis aynı numarayı hem boşluklu hem bitişik veriyor ("191 422 803" /
      // "191422803"); normalize anahtar ikisini tek satıra indirir.
      const key = `${make ?? ''}|${codeNorm}`
      if (seen.has(key)) continue
      seen.add(key)
      oems.push({ brand: make, code })
    }
  }
  return oems
}

export interface RepxpertOptions {
  transport: RepxpertTransport
  /** Katalog markası (büyük harf) → TecDoc marka id'si. */
  brandIds: Record<string, number>
}

export function createRepxpertSource(options: RepxpertOptions): OemSource {
  const { transport } = options
  // Anahtarlar çağrı sırasında normalize edilmesin diye bir kez sabitlenir.
  const brandIds = new Map(
    Object.entries(options.brandIds).map(([brand, id]) => [brand.trim().toUpperCase(), id])
  )
  /** Doğrudan kodun tutmadığı, aramanın tuttuğu markalar (koşu boyunca). */
  const searchFirst = new Set<string>()

  return {
    site: SITE,
    // Veri TecDoc'un kendisi: üreticilerin TecAlliance'a verdiği çapraz referans.
    authoritative: true,

    brands: () => [...brandIds.keys()],

    supports: (brand: string) => brandIds.has(brand.trim().toUpperCase()),

    async lookup(brand: string, partNo: string): Promise<OemLookup> {
      const key = brand.trim().toUpperCase()
      const brandId = brandIds.get(key)
      if (brandId === undefined) throw new Error(`${SITE} bu markayı kapsamıyor: ${brand}`)

      // Denenecek yazılışlar: katalogdaki hâli ve marka öneki atılmış hâli.
      // İkincisi tek başına bir düzeltmedir — "REINZ 01-31555-01" için doğru
      // kodu aramaya gitmeden kurar.
      const stripped = stripBrandPrefix(brand, partNo)
      const spellings = [partNo.trim(), ...(stripped !== partNo.trim() ? [stripped] : [])]

      const empty: OemLookup = {
        matched: false,
        oems: [],
        description: null,
        sourceUrl: productUrl(encodeProductCode(brandId, spellings[0]))
      }

      /** Verilen yazılıştan kod kurup dener. Ürün yoksa null. */
      const byCode = async (code: string): Promise<OemLookup | null> => {
        const { status, body } = await transport.get(oeNumbersPath(code))
        // 400/404 = bu kod karşılığında ürün yok. Katalogdaki numara TecDoc'taki
        // yazılışla tutmuyor ya da marka bu numarayı yayınlamıyor demektir;
        // hata değil, sonuçsuz sorgu.
        if (status === 400 || status === 404) return null
        if (status !== 200) throw new Error(`${SITE} ${status} ${brand} ${partNo}`)
        return { ...empty, matched: true, oems: parseOeNumbers(body, partNo), sourceUrl: productUrl(code) }
      }

      const direct = async (): Promise<OemLookup | null> => {
        for (const spelling of spellings) {
          const hit = await byCode(encodeProductCode(brandId, spelling))
          if (hit) return hit
        }
        return null
      }

      /**
       * Yazılış tahmin edilemiyorsa siteye sorulur: arama, numaranın TecDoc'taki
       * yazılışını ve ürün kodunu birlikte veriyor.
       */
      const viaSearch = async (): Promise<OemLookup | null> => {
        const { status, body } = await transport.get(searchPath(spellings[spellings.length - 1]))
        if (status === 400 || status === 404) return null
        if (status !== 200) throw new Error(`${SITE} arama ${status} ${brand} ${partNo}`)

        const code = findArticleCode(body, brand, partNo)
        return code === null ? null : await byCode(code)
      }

      // Bazı markaların TÜM numaraları boşluklu yazılıyor (BOSCH, SWAG, HELLA);
      // orada doğrudan kodu her üründe yeniden denemek istek başına bir saniye
      // israf eder. Markada en son hangi yol tuttuysa sıraya o geçer; yanılırsa
      // öbür yol yine deneniyor, yani kendi kendini düzeltir.
      const order = searchFirst.has(key) ? [viaSearch, direct] : [direct, viaSearch]
      for (const attempt of order) {
        const hit = await attempt()
        if (!hit) continue
        if (attempt === viaSearch) searchFirst.add(key)
        else searchFirst.delete(key)
        return hit
      }
      return empty
    }
  }
}
