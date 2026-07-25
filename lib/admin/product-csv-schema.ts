/**
 * Ürün eşleştirme tablosunun CSV sözleşmesi — export ve import AYNI bu dosyadan
 * beslenir (client-safe: DB/`server-only` bağımlılığı yok, import diyaloğu da
 * sütun listesini buradan gösterir).
 *
 * Satır kimliği `supplier` + `supplier_product_id` çiftidir; bu iki sütun
 * dosyada bulunmak ZORUNDA ve düzenlenemez.
 *
 * Import'un tek güvenlik kuralı: **yalnız dosyada BULUNAN sütunlar yazılır.**
 * Bir sütunu tamamen silerseniz o alan hiç dokunulmaz; sütun duruyor ama hücre
 * boşsa alan TEMİZLENİR (ör. `canonical_product_id` boş → eşleştirme kopar).
 */

/** Satırı tekilleştiren, düzenlenemez anahtar sütunlar. */
export const PRODUCT_CSV_KEY_COLUMNS = ['supplier', 'supplier_product_id'] as const

/** Bilgi amaçlı, import'un tümüyle yok saydığı sütunlar. */
export const PRODUCT_CSV_READONLY_COLUMNS = [
  'brand',
  'sku',
  'supplier_name',
  'part_no',
  'supplier_oem',
  'matched',
  'coverage',
  'canonical_base_name',
  'canonical_part_no',
  'oems_readonly'
] as const

/** Düzenlenip geri yüklenebilen sütunlar. */
export const PRODUCT_CSV_EDITABLE_COLUMNS = [
  'canonical_product_id',
  'name_override',
  'selling_price_override',
  'lock_price',
  'note',
  'oems_manual'
] as const

export type ProductCsvEditableColumn = (typeof PRODUCT_CSV_EDITABLE_COLUMNS)[number]

/** Export'un yazdığı sütun sırası. */
export const PRODUCT_CSV_COLUMNS = [
  'supplier',
  'supplier_product_id',
  'brand',
  'sku',
  'supplier_name',
  'part_no',
  'supplier_oem',
  'matched',
  'coverage',
  'canonical_product_id',
  'canonical_base_name',
  'canonical_part_no',
  'name_override',
  'selling_price_override',
  'lock_price',
  'note',
  'oems_manual',
  'oems_readonly'
] as const

export type ProductCsvColumn = (typeof PRODUCT_CSV_COLUMNS)[number]

export const PRODUCT_CSV_COLUMN_HELP: Record<ProductCsvColumn, string> = {
  supplier: 'Anahtar — dinamik | basbug. Değiştirmeyin.',
  supplier_product_id: 'Anahtar — tedarikçi ham satırının id’si. Değiştirmeyin.',
  brand: 'Salt okunur — tedarikçideki marka adı.',
  sku: 'Salt okunur — tedarikçi stok kodu.',
  supplier_name: 'Salt okunur — tedarikçideki ham ürün adı.',
  part_no: 'Salt okunur — tedarikçi part_no.',
  supplier_oem: 'Salt okunur — tedarikçi satırının ham OEM alanı.',
  matched: 'Salt okunur — satır kanonik ürüne bağlı mı.',
  coverage: 'Salt okunur — kanonik ürünün tedarikçi kapsamı.',
  canonical_product_id:
    'DÜZENLENEBİLİR — bağlanacak kanonik ürün id’si. Boş bırakılırsa mevcut eşleşme KOPARILIR; farklı bir id yazılırsa satır o ürüne taşınır.',
  canonical_base_name: 'Salt okunur — kanonik ürünün asıl adı (products.name).',
  canonical_part_no: 'Salt okunur — kanonik ürünün part_no’su.',
  name_override:
    'DÜZENLENEBİLİR — mağazada/aramada görünecek özel ad. Boş = override kaldırılır, asıl ada dönülür.',
  selling_price_override:
    'DÜZENLENEBİLİR — TL satış fiyatı override’ı (ör. 1.249,90). Boş = override kaldırılır.',
  lock_price:
    'DÜZENLENEBİLİR — EVET/HAYIR. EVET ise override fiyatı politikayı ezer; fiyat girilmeden EVET yapılamaz.',
  note: 'DÜZENLENEBİLİR — serbest admin notu.',
  oems_manual:
    'DÜZENLENEBİLİR — elle girilen OEM listesi, virgülle ayrık «MARKA KOD» (ör. "DAF 1812163, SCANIA 2043169"). Listeden çıkardığınız kod SİLİNİR.',
  oems_readonly:
    'Salt okunur — tedarikçi/TecDoc kaynaklı OEM’lerden bir örneklem (ilk 25). Import tarafından yok sayılır.'
}

const HEADER_ALIASES: Record<string, ProductCsvColumn> = {
  firma: 'supplier',
  tedarikci: 'supplier',
  supplier_id: 'supplier_product_id',
  urun_id: 'supplier_product_id',
  kanonik_urun_id: 'canonical_product_id',
  product_id: 'canonical_product_id',
  ad_override: 'name_override',
  fiyat_override: 'selling_price_override',
  fiyat_kilit: 'lock_price',
  not: 'note',
  oem: 'oems_manual',
  oems: 'oems_manual'
}

const KNOWN = new Set<string>(PRODUCT_CSV_COLUMNS)

/** Başlık hücresini kanonik sütun adına indirger (küçük harf, boşluk toleranslı). */
export function normalizeCsvHeader(raw: string): ProductCsvColumn | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
  if (KNOWN.has(key)) return key as ProductCsvColumn
  return HEADER_ALIASES[key] ?? null
}

export function isEditableCsvColumn(col: string): col is ProductCsvEditableColumn {
  return (PRODUCT_CSV_EDITABLE_COLUMNS as readonly string[]).includes(col)
}
