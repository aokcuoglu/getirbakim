/**
 * Barkod (GTIN) doğrulaması.
 *
 * Neden gerekiyor: Dinamik'in `barcode_1/2/3` alanları barkod olmayan değerlerle
 * dolu ve bunlar doğrulanmadan `catalog.product_eans`'e yazılıyordu. Prod'da
 * ölçüldü — 458.150 satırın içinde 52.702 tanesi ürünün KENDİ parça numarası,
 * 25.810 tanesi marka+parça numarası birleşimi (`ABA-10PK1342`), 23.105 ürün de
 * düpedüz `0` koduna bağlanmıştı. Bu satırlar hem ürün sayfasında "EAN" diye
 * görünüyor hem de arama indeksine giriyordu.
 *
 * Kabul kuralı, gerçek veriye karşı ölçülerek seçildi (468.665 ham değer):
 *   yalnız rakam                          → 347.904
 *   + uzunluk 8/12/13/14, hepsi sıfır değil → 294.925
 *   + GTIN kontrol hanesi doğru            → 282.158
 * Kontrol hanesi, biçimi geçenlerin yalnız %4,3'ünü eliyor; yani gerçek
 * barkodları kesmiyor, rakamdan ibaret sahte kodları yakalıyor.
 *
 * DİKKAT: aynı kural toplu aktarımda SQL olarak da yazılı
 * (`validGtinSql`, lib/catalog/catalog-sql.ts) — biri değişirse diğeri de
 * değişmeli. İkisi ayrı çünkü toplu aktarım tek INSERT ... SELECT ile milyonlarca
 * satır işliyor, TS'e taşımak veriyi uygulamadan geçirmek demek olurdu.
 */

/** GTIN uzunlukları: EAN-8, UPC-A, EAN-13, ITF-14. */
const GTIN_LENGTHS = new Set([8, 12, 13, 14])

/**
 * Girdiden barkod adayını çıkarır. Boşluk ve tire ayraç sayılır ("869 123 4567890"),
 * BAŞKA harf/işaret varsa değer barkod değildir ve elenir — aksi hâlde
 * "ABA-10PK1342" gibi parça numaraları rakamları süzülüp barkoda dönüşürdü.
 */
export function normalizeGtin(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (!/^[0-9\s-]+$/.test(trimmed)) return null
  const digits = trimmed.replace(/[\s-]/g, '')
  return digits.length > 0 ? digits : null
}

/**
 * GTIN kontrol hanesi (modulo 10). Son hane dışındaki rakamlar sağdan sola
 * 3,1,3,1… ile çarpılır; toplamın 10'a tamamlayanı son haneye eşit olmalıdır.
 */
function checkDigitMatches(digits: string): boolean {
  const n = digits.length
  let sum = 0
  for (let i = 0; i < n - 1; i++) {
    // Sağdaki veri hanesi 3 ile başlar; soldakiler dönüşümlü.
    const weight = (n - 1 - i) % 2 === 1 ? 3 : 1
    sum += Number(digits[i]) * weight
  }
  return (10 - (sum % 10)) % 10 === Number(digits[n - 1])
}

/** Değer gerçek bir barkod mu. */
export function isValidGtin(raw: string): boolean {
  const digits = normalizeGtin(raw)
  if (digits === null) return false
  if (!GTIN_LENGTHS.has(digits.length)) return false
  // "0", "0000000000000" gibi yer tutucular biçim ve checksum'ı geçebiliyor.
  if (/^0+$/.test(digits)) return false
  return checkDigitMatches(digits)
}

/** Geçerli olanları normalize edilmiş biçimde, tekrarsız döner. */
export function collectValidGtins(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!isValidGtin(value)) continue
    const digits = normalizeGtin(value)
    if (digits === null || seen.has(digits)) continue
    seen.add(digits)
    out.push(digits)
  }
  return out
}
