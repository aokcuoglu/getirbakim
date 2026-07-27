/**
 * REPXPERT arama ucu — yalnız TecDoc MARKA ID'si öğrenmek için.
 *
 * OEM çekiminde arama kullanılmaz (ürün kodu hesaplanabiliyor, bkz. repxpert.ts);
 * ama kodu kurabilmek için markanın TecDoc id'si gerekir ve yerel arşiv
 * katalogdaki 633 markanın yalnız 61'ini biliyor. Kalanı buradan öğrenilir:
 * bir parça numarası aranır, dönen sonuçların ürün kodundan marka id'si okunur.
 *
 * Ürün kodu iki biçimde geliyor:
 *   Ext-TA-<base64("<markaId>:<parçaNo>")>   — TecDoc'un çoğu markası
 *   TA-<markaId>-<makaleId>                  — Schaeffler'in kendi markaları
 *
 * DİKKAT — arama BULANIK: "01092" sorgusu 7.777 sonuç döndürüyor ve ilk
 * sıralar Schaeffler ürünleri. Bu yüzden yalnız numarası birebir eşleşen VE
 * marka adı tutan kayıt kabul edilir; iki farklı marka id'si aynı anda
 * tutuyorsa hiçbiri kabul edilmez — yanlış id, o markanın tüm ürünlerini
 * başka bir markanın kataloğuna sorar.
 */
import { normalizeOem } from '../../matching/code-normalization'

const QUERY = 'lang=tr&curr=RXP&catalogCountry=TR'
/** Yanıtı küçük tutar: marka id'si için kod ve marka adı yeter. */
const FIELDS = 'products(code,name,brand(DEFAULT),catalogArticleNumber),pagination(DEFAULT)'

export function searchPath(partNo: string, pageSize = 40): string {
  const params = new URLSearchParams({
    fields: FIELDS,
    query: `${partNo}:relevance`,
    pageSize: String(pageSize),
    source: 'globalsearch'
  })
  return `/api/Repxpert-TR/products/search?${params.toString()}&${QUERY}`
}

/** Ürün kodundan TecDoc marka id'si. Tanınmayan biçimde null. */
export function brandIdFromCode(code: string): number | null {
  const ext = /^Ext-TA-(.+)$/.exec(code)
  if (ext) {
    let decoded: string
    try {
      decoded = Buffer.from(ext[1], 'base64').toString('utf8')
    } catch {
      return null
    }
    const id = Number(decoded.split(':')[0])
    return Number.isInteger(id) && id > 0 ? id : null
  }
  const plain = /^TA-(\d+)-/.exec(code)
  if (plain) return Number(plain[1])
  return null
}

/** Karşılaştırma için marka adı: harf/rakam dışı her şey atılır. */
function brandKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Katalog markası ile sitedeki marka adı aynı firmayı mı gösteriyor.
 *
 * Birebir eşitlik yetmez: katalogda "FEBI", sitede "FEBI BILSTEIN"; katalogda
 * "VICTORREINZ", sitede "VICTOR REINZ". Bu yüzden biri diğerinin başlangıcı
 * olabilir. Kısa adların yanlış eşleşmemesi için en az 3 karakter aranır —
 * "GKL" gibi üç harfli markalar rastgele bir "GKLX"e bağlanmasın diye
 * kapsama yönü değil, uzunluk sınırı korur.
 */
export function brandNamesAgree(catalogBrand: string, siteBrand: string): boolean {
  const a = brandKey(catalogBrand)
  const b = brandKey(siteBrand)
  if (a.length < 3 || b.length < 3) return false
  return a === b || a.startsWith(b) || b.startsWith(a)
}

interface SearchProduct {
  code?: string | null
  brand?: { name?: string | null } | null
  catalogArticleNumber?: string | null
}

/**
 * Numaranın başındaki marka adını atar.
 *
 * Katalogda bazı markalar numarayı marka önekiyle tutuyor
 * ("REINZ 01-31555-01"), TecDoc'taki makale numarası ise yalnız "01-31555-01".
 * Önek atılmazsa ne ürün kodu kurulabilir ne de arama sonucu eşleşir.
 *
 * Yalnız GERÇEKTEN marka olan önek atılır: baştaki harf öbeği marka adının
 * başı ya da sonu olacak ("REINZ" ⊂ "VICTORREINZ", "FEBI" ⊂ "FEBI BILSTEIN").
 * Rakamla başlayan numaralara dokunulmaz — HELLA'nın "1ND010377-071"indeki
 * "1ND" marka değil, numaranın kendisidir.
 */
export function stripBrandPrefix(catalogBrand: string, partNo: string): string {
  const trimmed = partNo.trim()
  const match = /^([A-Za-z]{3,})[\s-]+(.+)$/.exec(trimmed)
  if (!match) return trimmed

  const prefix = brandKey(match[1])
  const brand = brandKey(catalogBrand)
  if (!brand.startsWith(prefix) && !brand.endsWith(prefix)) return trimmed

  // Geriye numara olarak okunabilecek bir şey kalmalı; yoksa önek sanılan şey
  // numaranın kendisidir ("ELRING SET").
  const rest = match[2].trim()
  if (rest.length < 3 || !/\d/.test(rest)) return trimmed
  return rest
}

/**
 * Arama yanıtından, sorulan ürünün sitedeki KODUNU çıkarır.
 *
 * Neden gerekli: ürün kodu numaranın TecDoc'taki yazılışından kuruluyor
 * (bkz. repxpert.ts) ama katalog numarayı sıkıştırılmış tutuyor
 * ("0445110274" ↔ "0 445 110 274"). Yazılışı tahmin etmek yerine siteye
 * sorulur; arama yanıtı hem doğru yazılışı hem kodu veriyor.
 *
 * Kabul koşulu `learnBrandId` ile aynı katılıkta: numara birebir (normalize)
 * eşleşecek, marka adı tutacak ve tek bir kod kalacak. Belirsizlikte null —
 * yanlış kod, başka bir ürünün OEM'lerini bu ürüne yazardı.
 */
export function findArticleCode(
  payload: unknown,
  catalogBrand: string,
  partNo: string
): string | null {
  const products = (payload as { products?: SearchProduct[] } | null)?.products
  if (!Array.isArray(products)) return null

  const wanted = normalizeOem(stripBrandPrefix(catalogBrand, partNo))
  if (!wanted) return null

  const codes = new Set<string>()
  for (const product of products) {
    const code = product?.code?.trim()
    const siteBrand = product?.brand?.name?.trim()
    if (!code || !siteBrand) continue
    if (normalizeOem(product?.catalogArticleNumber ?? '') !== wanted) continue
    if (!brandNamesAgree(catalogBrand, siteBrand)) continue
    codes.add(code)
  }

  return codes.size === 1 ? [...codes][0] : null
}

export interface BrandIdCandidate {
  brandId: number
  siteBrand: string
  /** Bu id'yi doğrulayan ürünün sitedeki kodu — kanıt. */
  code: string
}

/**
 * Arama yanıtından, sorulan markanın TecDoc id'sini çıkarır.
 *
 * Kabul koşulu: parça numarası birebir eşleşecek, marka adı tutacak ve
 * bu koşulu sağlayan TEK BİR marka id'si olacak. Belirsizlikte null.
 */
export function learnBrandId(
  payload: unknown,
  catalogBrand: string,
  partNo: string
): BrandIdCandidate | null {
  const products = (payload as { products?: SearchProduct[] } | null)?.products
  if (!Array.isArray(products)) return null

  const wanted = normalizeOem(partNo)
  if (!wanted) return null

  const hits = new Map<number, BrandIdCandidate>()
  for (const product of products) {
    const code = product?.code?.trim()
    const siteBrand = product?.brand?.name?.trim()
    if (!code || !siteBrand) continue
    if (normalizeOem(product?.catalogArticleNumber ?? '') !== wanted) continue
    if (!brandNamesAgree(catalogBrand, siteBrand)) continue

    const brandId = brandIdFromCode(code)
    if (brandId === null) continue
    if (!hits.has(brandId)) hits.set(brandId, { brandId, siteBrand, code })
  }

  // Tek aday varsa öğrenildi; birden çoksa hangisi olduğu belli değil.
  return hits.size === 1 ? [...hits.values()][0] : null
}
