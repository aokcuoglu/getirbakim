import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  CSV_BOM,
  CSV_DEFAULT_DELIMITER,
  csvLine,
  formatCsvBoolean,
  formatCsvNumber
} from './csv'
import { PRODUCT_CSV_COLUMNS } from './product-csv-schema'
import { buildProductListFilters, type ProductListFilterInput } from './product-list-sql'

/**
 * "Ürün Listesi" tablosunun CSV export'u (SERVER-only).
 *
 * Ekrandaki filtreler (firma / durum / kapsam / marka / arama) birebir aynı
 * `buildProductListFilters` üzerinden uygulanır — admin ne görüyorsa dosyada o
 * satırlar olur, sayfalama yok.
 *
 * Bellek koruması: satırlar `sp.id` üzerinden keyset ile parti parti çekilir ve
 * anında akışa yazılır; tüm sonuç asla RAM'de tutulmaz. Bu yüzden sıralama
 * ekrandaki (marka, ad) sırasından farklı olarak sp.id'dir — keyset'in tek
 * güvenilir/indeksli anahtarı budur.
 */

/**
 * Tek istekte akıtılacak azami satır; üstünde export reddedilir. Sunucu tarafı
 * parti parti akıttığı için tavan bellek değil, dosyanın kullanılabilirliğidir
 * (1M satır Excel'in 1.048.576 satır sınırının hemen altında kalır).
 */
export const PRODUCT_CSV_EXPORT_MAX_ROWS = 1_000_000

const BATCH = 2_000

/**
 * Salt okunur OEM sütununda gösterilecek azami kod. Yalnız bağlam için var
 * (aynı kodu `oems_manual`'a tekrar girmemek üzere); tamamını yazmak dosyayı
 * satır başına kilobaytlarca şişiriyordu.
 */
const READONLY_OEM_LIMIT = 25

type ExportRow = {
  sid: bigint
  brand_name: string | null
  sku: string | null
  name: string | null
  part_no: string | null
  oem: string | null
  matched: boolean
  canonical_id: bigint | null
  canonical_base_name: string | null
  canonical_part_no: string | null
  name_override: string | null
  selling_price_override: unknown
  lock_price: boolean | null
  note: string | null
  oems_manual: string | null
  oems_readonly: string | null
  has_dinamik: boolean
  has_basbug: boolean
}

/** Numeric kolonlar sürücüye göre string/Decimal/number dönebilir; hepsini karşıla. */
function toNumber(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(String(value))
  return Number.isFinite(n) ? n : null
}

/** Filtreye uyan toplam satır sayısı (export'u başlatmadan önceki eşik kontrolü). */
export async function countProductListExportRows(input: ProductListFilterInput): Promise<number> {
  const { cfg, passiveFilter, approvedBrand, qFilter, statusFilter, coverageFilter } =
    buildProductListFilters(input)

  const [row] = await db.$queryRaw<Array<{ c: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS c
    FROM ${cfg.prodTable} sp
    LEFT JOIN ${cfg.matchTable} m ON m.${cfg.matchFk} = sp.id
    WHERE true
    ${passiveFilter}
    ${approvedBrand}
    ${qFilter}
    ${statusFilter}
    ${coverageFilter}
  `)
  return Number(row?.c ?? 0)
}

async function fetchBatch(
  input: ProductListFilterInput,
  afterId: bigint
): Promise<ExportRow[]> {
  const {
    cfg,
    passiveFilter,
    approvedBrand,
    qFilter,
    statusFilter,
    coverageFilter,
    hasDinamik,
    hasBasbug
  } = buildProductListFilters(input)

  // OEM'ler iki kovaya ayrılır: MANUAL/WEB satırları admin'in sahibi olduğu
  // (ve import'un uzlaştıracağı) küme; DNMK/BSBG/PARTS satırları sync'in yeniden
  // ürettiği salt okunur küme. İkisini tek sütunda vermek, import'ta silinemeyen
  // kodları "silinmiş" göstermek olurdu.
  const oemEntry = Prisma.sql`
    CASE WHEN o.oem_brand <> '' THEN o.oem_brand || ' ' || o.code ELSE o.code END`

  return db.$queryRaw<ExportRow[]>(Prisma.sql`
    SELECT sp.id AS sid, sb.${cfg.brandNameCol} AS brand_name, sp.${cfg.skuCol} AS sku,
      COALESCE(NULLIF(sp.${cfg.nameCol}, ''), sp.${cfg.skuCol}) AS name,
      sp.part_no, sp.${cfg.oemCol} AS oem,
      (m.id IS NOT NULL) AS matched, m.product_id AS canonical_id,
      p.name AS canonical_base_name, p.part_no AS canonical_part_no,
      ov.name_override, ov.selling_price_override, ov.lock_price, ov.note,
      om.v AS oems_manual, orr.v AS oems_readonly,
      ${hasDinamik} AS has_dinamik,
      ${hasBasbug} AS has_basbug
    FROM ${cfg.prodTable} sp
    JOIN ${cfg.brandTable} sb ON sb.id = sp.${cfg.brandIdCol}
    LEFT JOIN ${cfg.matchTable} m ON m.${cfg.matchFk} = sp.id
    LEFT JOIN catalog.products p ON p.id = m.product_id
    LEFT JOIN catalog.product_overrides ov ON ov.product_id = m.product_id
    LEFT JOIN LATERAL (
      SELECT string_agg(t.entry, ', ' ORDER BY t.entry) AS v
      FROM (
        SELECT DISTINCT ${oemEntry} AS entry
        FROM catalog.product_oems o
        WHERE o.product_id = m.product_id AND o.source IN ('MANUAL', 'WEB')
      ) t
    ) om ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(t.entry, ', ' ORDER BY t.entry) AS v
      FROM (
        SELECT DISTINCT ${oemEntry} AS entry
        FROM catalog.product_oems o
        WHERE o.product_id = m.product_id AND o.source NOT IN ('MANUAL', 'WEB')
        ORDER BY 1
        LIMIT ${READONLY_OEM_LIMIT}
      ) t
    ) orr ON true
    WHERE sp.id > ${afterId}
    ${passiveFilter}
    ${approvedBrand}
    ${qFilter}
    ${statusFilter}
    ${coverageFilter}
    ORDER BY sp.id
    LIMIT ${BATCH}
  `)
}

function coverageLabel(row: ExportRow): string {
  if (!row.matched) return ''
  if (row.has_dinamik && row.has_basbug) return 'both'
  if (row.has_dinamik) return 'dinamik'
  if (row.has_basbug) return 'basbug'
  return ''
}

function toCsvValues(supplier: string, row: ExportRow): string[] {
  return [
    supplier,
    row.sid.toString(),
    row.brand_name ?? '',
    row.sku ?? '',
    row.name ?? '',
    row.part_no ?? '',
    row.oem ?? '',
    formatCsvBoolean(row.matched),
    coverageLabel(row),
    row.canonical_id == null ? '' : row.canonical_id.toString(),
    row.canonical_base_name ?? '',
    row.canonical_part_no ?? '',
    row.name_override ?? '',
    formatCsvNumber(toNumber(row.selling_price_override)),
    formatCsvBoolean(Boolean(row.lock_price)),
    row.note ?? '',
    row.oems_manual ?? '',
    row.oems_readonly ?? ''
  ]
}

/**
 * CSV'yi parça parça üretir (BOM + başlık + satırlar). Çağıran bunu doğrudan
 * bir ReadableStream'e yazabilir.
 */
export async function* streamProductListCsv(
  input: ProductListFilterInput,
  delimiter: string = CSV_DEFAULT_DELIMITER
): AsyncGenerator<string> {
  yield CSV_BOM + csvLine([...PRODUCT_CSV_COLUMNS], delimiter)

  let afterId = BigInt(0)
  let emitted = 0
  for (;;) {
    const rows = await fetchBatch(input, afterId)
    if (rows.length === 0) break

    let chunk = ''
    for (const row of rows) {
      chunk += csvLine(toCsvValues(input.supplier, row), delimiter)
      emitted++
    }
    yield chunk

    afterId = rows[rows.length - 1]!.sid
    if (rows.length < BATCH || emitted >= PRODUCT_CSV_EXPORT_MAX_ROWS) break
  }
}

/** İndirilen dosyanın adı — filtreler ada işlenir ki karışmasın. */
export function buildExportFilename(input: ProductListFilterInput, stamp: string): string {
  const parts = ['eslestirme', input.supplier]
  if (input.status && input.status !== 'all') parts.push(input.status)
  if (input.coverage && input.coverage !== 'all') parts.push(`kapsam-${input.coverage}`)
  if (input.brandId != null) parts.push(`marka-${input.brandId}`)
  parts.push(stamp)
  return `${parts.join('_')}.csv`
}
