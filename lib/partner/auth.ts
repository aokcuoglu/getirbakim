import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Partner API kimlik doğrulaması — `app/api/partner/v1/*` (BAK-183).
 *
 * NEDEN AYRI BİR SIR: `CRON_SECRET` (app/api/internal/catalog/sync/route.ts)
 * BÜTÜN internal uçları açar — sync tetikleme, reindex, tedarikçi çekme. Bir
 * partnere verilen anahtar yalnız okuma uçlarını açmalı ve tek tek iptal
 * edilebilmeli. Bu yüzden partner anahtarları AYRI bir ortam değişkeninde
 * ({@link PARTNER_KEYS_ENV}) tutulur ve bu modül `CRON_SECRET`'i hiç okumaz.
 *
 * Biçim: `PARTNER_API_KEYS="bakimx:sk_xxx,baskapartner:sk_yyy"` — virgülle
 * ayrılmış `partnerKodu:anahtar` çiftleri. Tek bir partneri iptal etmek için o
 * çifti listeden çıkarmak yeter; diğerleri çalışmaya devam eder.
 */

export const PARTNER_KEYS_ENV = 'PARTNER_API_KEYS'
/** Separate, fail-closed credentials for binding quotes and order operations. */
export const PARTNER_ORDER_KEYS_ENV = 'PARTNER_ORDER_API_KEYS'

export function resolveScopedPartner(
  authorizationHeader: string | null | undefined,
  scope: 'catalog' | 'orders',
  catalogKeys: string | null | undefined,
  orderKeys: string | null | undefined
): PartnerIdentity | null {
  if (scope === 'catalog') return resolvePartner(authorizationHeader, catalogKeys)
  // An accidentally reused read credential never gains write authority.
  if (resolvePartner(authorizationHeader, catalogKeys)) return null
  return resolvePartner(authorizationHeader, orderKeys)
}

/** En kısa kabul edilebilir anahtar. Kısa/boş bir değer yanlışlıkla girilmiş
 *  sayılır ve HİÇ yüklenmez — yoksa `PARTNER_API_KEYS="bakimx:"` gibi bir yazım
 *  hatası boş bir anahtarla kapıyı açardı. */
export const MIN_PARTNER_KEY_LENGTH = 16

export interface PartnerIdentity {
  /** Log/metrik için partner kodu — anahtarın kendisi asla loglanmaz. */
  code: string
}

/**
 * `PARTNER_API_KEYS` değerini `anahtar → partnerKodu` eşlemesine çevirir.
 * Bozuk/kısa girdiler sessizce ATILIR, sürecin tamamı reddedilmez: tek bir
 * hatalı çift yüzünden çalışan partnerlerin de kapısı kapanmasın.
 */
export function parsePartnerKeys(raw: string | undefined | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!raw) return map

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    // Anahtarın kendisi ':' içerebilir — yalnız İLK ayraçtan böl.
    const separator = trimmed.indexOf(':')
    if (separator <= 0) continue

    const code = trimmed.slice(0, separator).trim()
    const key = trimmed.slice(separator + 1).trim()
    if (!code || key.length < MIN_PARTNER_KEY_LENGTH) continue

    // Aynı anahtar iki partnere verilmişse İLK tanım kazanır; sessizce
    // üzerine yazmak, iptal edildiği sanılan bir partneri geri açardı.
    if (!map.has(key)) map.set(key, code)
  }

  return map
}

/**
 * Sabit zamanlı karşılaştırma. Ham değerleri değil SHA-256 özetlerini
 * karşılaştırırız: `timingSafeEqual` farklı uzunlukta girdide fırlatır, yani
 * ham karşılaştırma anahtarın UZUNLUĞUNU sızdırır.
 */
function secretEquals(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest()
  const digestB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(digestA, digestB)
}

/** `Authorization: Bearer <anahtar>` başlığından ham anahtarı çıkarır. */
export function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token ? token : null
}

/**
 * İsteği partner kimliğine çözer; eşleşme yoksa `null`.
 *
 * Anahtar tanımlı DEĞİLSE (`PARTNER_API_KEYS` boş) her istek reddedilir —
 * "yapılandırılmamış" durumu açık kapı değil, kapalı kapıdır.
 */
export function resolvePartner(
  authorizationHeader: string | null | undefined,
  rawKeys: string | undefined | null
): PartnerIdentity | null {
  const token = extractBearerToken(authorizationHeader)
  if (!token) return null

  const keys = parsePartnerKeys(rawKeys)
  if (keys.size === 0) return null

  // Map.get() ile doğrudan aramak anahtarı hash tablosunda arar ve zamanlama
  // sızdırır; tanımlı her anahtara karşı sabit zamanlı karşılaştırma yapılır.
  let matched: string | null = null
  for (const [key, code] of keys) {
    if (secretEquals(token, key)) matched = code
  }

  return matched ? { code: matched } : null
}
