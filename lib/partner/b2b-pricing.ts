import { Prisma } from '@prisma/client'

/**
 * Partner (B2B) fiyat çözümü — `app/api/partner/v1/*` (BAK-183).
 *
 * NEDEN VİTRİN FİYATI DOĞRUDAN YANSITILMAZ: `catalog.products.min_selling_price_try`
 * son kullanıcı fiyatıdır (KDV hariç, bkz. lib/catalog/store-view.ts). Partner bir
 * atölyedir, son kullanıcı değil — ona vitrin fiyatını vermek B2B'yi anlamsız
 * kılar. Bu modül vitrin fiyatını TABAN alır, üzerine partner iskontosunu uygular
 * ve sonucu MALİYETİN ALTINA düşmeyecek şekilde kırpar.
 *
 * Para birimi TRY, tüm çıktılar KDV HARİÇ ve **kuruş** (tam sayı) — tüketici
 * taraf (BakımX) fiyatları kuruş olarak taşır, ondalık `Decimal` sınırdan
 * geçmez.
 */

export const PARTNER_CURRENCY = 'TRY'

/** Katalog KDV oranı (bps; 2000 = %20) — lib/catalog/store-view.ts ile aynı. */
export const PARTNER_VAT_RATE_BPS = 2000

/** İskonto oranının okunduğu ortam değişkeni. */
export const PARTNER_DISCOUNT_ENV = 'PARTNER_B2B_DISCOUNT_BPS'

/**
 * Yapılandırma yoksa uygulanan iskonto: **sıfır**.
 *
 * Bilinçli olarak "0" — ticari oran (BAK-183) henüz kararlaştırılmadı ve bir
 * varsayılan uydurmak, kimsenin onaylamadığı bir marjı sessizce üretime taşır.
 * Sıfır iskonto en kötü ihtimalle "pahalı" görünür; uydurulmuş bir oran ise
 * zarar ettirir. Oran belirlendiğinde `PARTNER_B2B_DISCOUNT_BPS` ile verilir.
 */
export const DEFAULT_PARTNER_DISCOUNT_BPS = 0

/** Anlamlı üst sınır — %90'dan fazla iskonto yapılandırma hatasıdır. */
export const MAX_PARTNER_DISCOUNT_BPS = 9000

/**
 * TRY (ondalık) → kuruş (tam sayı), yarı yukarı yuvarlama.
 *
 * KAYAN NOKTA İLE YAPILMAZ: `1.005 * 100` ikili tabanda `100.49999…` verir ve
 * `Math.round` 101 yerine 100 döndürür — `EPSILON` düzeltmesi de bu farkı
 * (~1e-14) kapatmaya yetmez. Fiyat kolonları zaten `Decimal(12,2)`; dönüşüm de
 * aynı kesin aritmetikte yapılır, böylece kuruş her zaman veritabanındaki
 * değerin tam karşılığıdır.
 */
export function toKurus(
  value: Prisma.Decimal | number | string | null | undefined
): number | null {
  if (value == null) return null

  let decimal: Prisma.Decimal
  try {
    decimal = new Prisma.Decimal(value)
  } catch {
    // Sayıya çevrilemeyen girdi (boş dize, "abc") fiyat DEĞİL — yokluk sayılır.
    return null
  }
  if (!decimal.isFinite()) return null
  if (decimal.lessThanOrEqualTo(0)) return 0

  return decimal.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber()
}

/** Ortamdaki iskonto oranını bps olarak çözer; geçersiz değer varsayılana düşer. */
export function resolvePartnerDiscountBps(raw: string | undefined | null): number {
  if (raw == null || raw.trim() === '') return DEFAULT_PARTNER_DISCOUNT_BPS
  const parsed = Number(raw.trim())
  if (!Number.isFinite(parsed)) return DEFAULT_PARTNER_DISCOUNT_BPS
  const rounded = Math.round(parsed)
  if (rounded <= 0) return DEFAULT_PARTNER_DISCOUNT_BPS
  return Math.min(rounded, MAX_PARTNER_DISCOUNT_BPS)
}

export interface PartnerPriceInput {
  /** Vitrin satış fiyatı, KDV hariç TRY (`products.min_selling_price_try`). */
  sellingPriceExVat: Prisma.Decimal | number | string | null | undefined
  /** Bizim net maliyetimiz, KDV hariç TRY (`product_offers.net_cost_try`). */
  netCostExVat: Prisma.Decimal | number | string | null | undefined
  discountBps: number
}

export interface PartnerPriceView {
  /** Vitrin (liste) fiyatı — kuruş, KDV hariç. Fiyat yoksa null. */
  listPriceKurus: number | null
  /** Partnerin ödeyeceği fiyat — kuruş, KDV hariç. Fiyat yoksa null. */
  b2bPriceKurus: number | null
  /**
   * GERÇEKTEN uygulanan iskonto (bps) — maliyet tabanı devreye girdiğinde
   * istenen orandan küçük olur. Tüketici taraf oranı iki fiyattan geri
   * hesaplamasın diye taşınır (BakımX `discountBps` deseniyle aynı gerekçe).
   */
  discountBps: number
  vatRateBps: number
  currency: string
  /** Maliyet tabanı, istenen iskontoyu kırptı mı. */
  floorApplied: boolean
}

/**
 * İstenen iskontoyu uygular, sonucu net maliyetin altına DÜŞÜRMEZ.
 *
 * Maliyet tabanı olmadan, tedarikçi zammı ile bir sonraki rollup arasındaki
 * pencerede zararına satış sözü verebilirdik — partner o fiyatı görüp sipariş
 * ederdi. Maliyet bilinmiyorsa (null) taban uygulanmaz; o durumda vitrin
 * fiyatının zaten marj içerdiğini varsayıyoruz.
 */
export function resolvePartnerPrice(input: PartnerPriceInput): PartnerPriceView {
  const listPriceKurus = toKurus(input.sellingPriceExVat)
  const base = {
    vatRateBps: PARTNER_VAT_RATE_BPS,
    currency: PARTNER_CURRENCY
  }

  if (listPriceKurus == null || listPriceKurus === 0) {
    return {
      ...base,
      listPriceKurus,
      b2bPriceKurus: listPriceKurus,
      discountBps: 0,
      floorApplied: false
    }
  }

  const requested = Math.min(Math.max(input.discountBps, 0), MAX_PARTNER_DISCOUNT_BPS)
  const discounted = Math.floor(
    (listPriceKurus * (10000 - requested)) / 10000 + Number.EPSILON + 0.5
  )

  const floorKurus = toKurus(input.netCostExVat)
  const floorApplied = floorKurus != null && floorKurus > discounted
  const b2bPriceKurus = floorApplied ? Math.min(floorKurus, listPriceKurus) : discounted

  // Uygulanan oranı fiyatlardan geri hesapla — taban devreye girdiyse istenen
  // oran yanlış bilgi olurdu.
  const effectiveBps = Math.round(((listPriceKurus - b2bPriceKurus) / listPriceKurus) * 10000)

  return {
    ...base,
    listPriceKurus,
    b2bPriceKurus,
    discountBps: Math.max(effectiveBps, 0),
    floorApplied
  }
}
