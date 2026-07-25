import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { parseOemEntries } from '@/lib/matching/code-normalization'
import { refreshProductRollupsForIds } from '@/lib/catalog/refresh-product-rollups'
import { syncProductSearchDocuments } from '@/lib/search/sync-product-document'
import {
  detectCsvDelimiter,
  iterateCsvRows,
  parseCsvBoolean,
  parseCsvNumber,
  unescapeCsvCell
} from './csv'
import {
  isEditableCsvColumn,
  normalizeCsvHeader,
  PRODUCT_CSV_EDITABLE_COLUMNS,
  type ProductCsvColumn,
  type ProductCsvEditableColumn
} from './product-csv-schema'
import { manualLinkSupplierRow, unlinkSupplierRow } from './product-manual-match'
import { PRODUCT_LIST_CONFIG } from './product-list-sql'
import type { ProductListSupplier } from './product-match-shared'

/**
 * CSV içe aktarma (SERVER-only): export edilen tablo Excel'de düzenlenip geri
 * yüklenir.
 *
 * Sözleşme (bkz. `product-csv-schema.ts`):
 *   - Satır kimliği `supplier` + `supplier_product_id`.
 *   - YALNIZ dosyada bulunan düzenlenebilir sütunlar yazılır. Sütunu silmek =
 *     "bu alana dokunma"; sütun durup hücrenin boş olması = "bu alanı temizle".
 *
 * Akış her zaman iki adımlı: önce `validate` (hiç yazmaz, ne olacağını sayar),
 * sonra `apply`. Doğrulamada hata alan satır uygulanmaz — kısmi satır yazımı yok.
 */

/**
 * Okunabilecek azami satır — export tavanıyla eşit, yani indirilen dosya olduğu
 * gibi geri yüklenebilir. Dosyanın tamamı belleğe alındığı için bu tavana yakın
 * dosyalar isteği ağırlaştırır (bkz. import route'undaki boyut tavanı).
 */
export const PRODUCT_CSV_IMPORT_MAX_ROWS = 1_000_000
/**
 * Tek istekte uygulanacak azami DEĞİŞEN satır. Asıl maliyet bağla/kopar
 * adımlarıdır: her biri ayrı transaction olduğu için satır başına birkaç ms
 * sürer. Ad/fiyat/not/OEM yazımları toplu (500'lük partiler) gittiği için ucuz.
 */
export const PRODUCT_CSV_IMPORT_MAX_CHANGES = 50_000
/** Yanıtta döndürülen örnek/hata sayısı (UI listesi için). */
const SAMPLE_LIMIT = 100

export type ProductCsvImportMode = 'validate' | 'apply'

export type ProductCsvImportIssue = { line: number; message: string }

export type ProductCsvImportChange = {
  line: number
  supplier: ProductListSupplier
  supplierProductId: string
  label: string
  actions: string[]
}

export type ProductCsvImportResult = {
  mode: ProductCsvImportMode
  delimiter: string
  totalRows: number
  /** Dosyada bulunan ve bu yüzden yazılacak olan düzenlenebilir sütunlar. */
  editableColumns: ProductCsvEditableColumn[]
  /** Tanınmayan, yok sayılan başlıklar. */
  ignoredHeaders: string[]
  changedRows: number
  unchangedRows: number
  counts: {
    link: number
    relink: number
    unlink: number
    override: number
    oems: number
  }
  appliedRows: number
  errorCount: number
  errors: ProductCsvImportIssue[]
  changes: ProductCsvImportChange[]
  /** Yazma sonrası tazelenen kanonik ürün sayısı. */
  touchedProducts: number
}

export class ProductCsvImportError extends Error {}

/* ── Ayrıştırma ───────────────────────────────────────────────────────────── */

type ParsedRow = {
  line: number
  supplier: ProductListSupplier
  supplierProductId: bigint
  cells: Partial<Record<ProductCsvColumn, string>>
}

type ParsedHeader = {
  delimiter: string
  index: Map<ProductCsvColumn, number>
  editableColumns: ProductCsvEditableColumn[]
  ignoredHeaders: string[]
}

function parseHeader(text: string): ParsedHeader {
  const delimiter = detectCsvDelimiter(text)
  const first = iterateCsvRows(text, delimiter).next()
  if (first.done) throw new ProductCsvImportError('Dosya boş.')

  const index = new Map<ProductCsvColumn, number>()
  const ignoredHeaders: string[] = []
  first.value.forEach((cell, i) => {
    const col = normalizeCsvHeader(unescapeCsvCell(cell))
    if (!col) {
      if (cell.trim()) ignoredHeaders.push(cell.trim())
      return
    }
    // Aynı sütun iki kez varsa ilki geçerli sayılır.
    if (!index.has(col)) index.set(col, i)
  })

  if (!index.has('supplier') || !index.has('supplier_product_id')) {
    throw new ProductCsvImportError(
      'Başlık satırında `supplier` ve `supplier_product_id` sütunları bulunmalı. Dosyayı yeniden dışa aktarıp o dosyayı düzenleyin.'
    )
  }

  const editableColumns = PRODUCT_CSV_EDITABLE_COLUMNS.filter((c) => index.has(c))
  if (editableColumns.length === 0) {
    throw new ProductCsvImportError(
      `Dosyada düzenlenebilir sütun yok. Şunlardan en az biri bulunmalı: ${PRODUCT_CSV_EDITABLE_COLUMNS.join(', ')}.`
    )
  }

  return { delimiter, index, editableColumns, ignoredHeaders }
}

/**
 * Gövde satırlarını tek tek üretir — dosyanın tamamını `string[][]` olarak
 * tutmak 1M satırda gigabaytlara çıkıyordu. Kimliği bozuk satırlar `errors`'a
 * yazılıp atlanır; `seen` tekrar eden satırları yakalar.
 */
function* streamParsedRows(
  text: string,
  header: ParsedHeader,
  errors: ProductCsvImportIssue[],
  seen: Map<string, number>,
  /** Kimliği okunamadığı için hiç işlenmeyen satır sayısı. */
  stats: { skipped: number }
): Generator<ParsedRow> {
  const { delimiter, index } = header
  let line = 1
  let isHeader = true

  for (const cells of iterateCsvRows(text, delimiter)) {
    if (isHeader) {
      isHeader = false
      continue
    }
    line++

    if (line - 1 > PRODUCT_CSV_IMPORT_MAX_ROWS) {
      throw new ProductCsvImportError(
        `Dosyada ${PRODUCT_CSV_IMPORT_MAX_ROWS.toLocaleString('tr-TR')} satırdan fazlası var; tek seferde bu kadarı işlenebilir. Dosyayı bölün.`
      )
    }

    const get = (col: ProductCsvColumn): string => {
      const at = index.get(col)
      if (at == null) return ''
      return unescapeCsvCell(cells[at] ?? '').trim()
    }

    const supplierRaw = get('supplier').toLowerCase()
    if (supplierRaw !== 'dinamik' && supplierRaw !== 'basbug') {
      errors.push({ line, message: `Geçersiz firma "${get('supplier')}" (dinamik | basbug).` })
      stats.skipped++
      continue
    }
    const idRaw = get('supplier_product_id')
    if (!/^\d+$/.test(idRaw)) {
      errors.push({ line, message: `Geçersiz supplier_product_id "${idRaw}".` })
      stats.skipped++
      continue
    }

    const key = `${supplierRaw}:${idRaw}`
    const dup = seen.get(key)
    if (dup != null) {
      errors.push({ line, message: `Bu satır ${dup}. satırda zaten var (${key}).` })
      stats.skipped++
      continue
    }
    seen.set(key, line)

    const rowCells: Partial<Record<ProductCsvColumn, string>> = {}
    for (const col of index.keys()) {
      if (isEditableCsvColumn(col)) rowCells[col] = get(col)
    }
    rowCells.sku = get('sku')

    yield {
      line,
      supplier: supplierRaw as ProductListSupplier,
      supplierProductId: BigInt(idRaw),
      cells: rowCells
    }
  }
}

/* ── Mevcut durumun okunması ──────────────────────────────────────────────── */

type SupplierState = {
  brandId: number
  sku: string
  currentProductId: bigint | null
}

type ProductState = {
  brandId: number
  nameOverride: string | null
  price: number | null
  lockPrice: boolean
  note: string | null
  /** Bu ürünü tutan tedarikçi ham satırları (offer başına bir tane). */
  offerRowId: Record<ProductListSupplier, bigint | null>
  /** MANUAL/WEB OEM'ler: `codeNorm|MARKA` → saklanan ham değerler. */
  manualOems: Map<string, { code: string; codeNorm: string; brand: string }>
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function toNumber(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(String(value))
  return Number.isFinite(n) ? n : null
}

/** Tedarikçi ham satırlarını (yalnız APPROVED marka altındakiler) toplu okur. */
async function loadSupplierStates(
  supplier: ProductListSupplier,
  ids: bigint[]
): Promise<Map<string, SupplierState>> {
  const cfg = PRODUCT_LIST_CONFIG[supplier]
  const out = new Map<string, SupplierState>()

  for (const part of chunk(ids, 1_000)) {
    const rows = await db.$queryRaw<
      Array<{ sid: bigint; brand_id: number; sku: string | null; product_id: bigint | null }>
    >(Prisma.sql`
      SELECT sp.id AS sid, bm.brand_id, sp.${cfg.skuCol} AS sku, m.product_id
      FROM ${cfg.prodTable} sp
      JOIN catalog.brand_mappings bm
        ON bm.${cfg.mapFk} = sp.${cfg.brandIdCol} AND bm.mapping_status = 'APPROVED'
      LEFT JOIN catalog.product_offers m ON m.${cfg.matchFk} = sp.id
      WHERE sp.id IN (${Prisma.join(part)})
    `)
    for (const r of rows) {
      out.set(r.sid.toString(), {
        brandId: r.brand_id,
        sku: r.sku ?? r.sid.toString(),
        currentProductId: r.product_id
      })
    }
  }
  return out
}

function oemKey(codeNorm: string, brand: string): string {
  return `${codeNorm}|${brand.trim().toUpperCase()}`
}

/** Hedef kanonik ürünlerin override + offer + manuel OEM durumunu toplu okur. */
async function loadProductStates(ids: bigint[]): Promise<Map<string, ProductState>> {
  const out = new Map<string, ProductState>()
  if (ids.length === 0) return out

  for (const part of chunk(ids, 1_000)) {
    const rows = await db.$queryRaw<
      Array<{
        id: bigint
        brand_id: number
        name_override: string | null
        selling_price_override: unknown
        lock_price: boolean | null
        note: string | null
        dinamik_row: bigint | null
        basbug_row: bigint | null
      }>
    >(Prisma.sql`
      SELECT p.id, p.brand_id, ov.name_override, ov.selling_price_override, ov.lock_price, ov.note,
        od.dinamik_product_id AS dinamik_row, ob.basbug_product_id AS basbug_row
      FROM catalog.products p
      LEFT JOIN catalog.product_overrides ov ON ov.product_id = p.id
      LEFT JOIN catalog.product_offers od ON od.product_id = p.id AND od.supplier_code = 'dinamik'
      LEFT JOIN catalog.product_offers ob ON ob.product_id = p.id AND ob.supplier_code = 'basbug'
      WHERE p.id IN (${Prisma.join(part)})
    `)
    for (const r of rows) {
      out.set(r.id.toString(), {
        brandId: r.brand_id,
        nameOverride: r.name_override?.trim() || null,
        price: toNumber(r.selling_price_override),
        lockPrice: Boolean(r.lock_price),
        note: r.note?.trim() || null,
        offerRowId: { dinamik: r.dinamik_row, basbug: r.basbug_row },
        manualOems: new Map()
      })
    }

    const oems = await db.$queryRaw<
      Array<{ product_id: bigint; code: string; code_norm: string; oem_brand: string }>
    >(Prisma.sql`
      SELECT product_id, code, code_norm, oem_brand
      FROM catalog.product_oems
      WHERE product_id IN (${Prisma.join(part)}) AND source IN ('MANUAL', 'WEB')
    `)
    for (const o of oems) {
      const state = out.get(o.product_id.toString())
      if (!state) continue
      state.manualOems.set(oemKey(o.code_norm, o.oem_brand), {
        code: o.code,
        codeNorm: o.code_norm,
        brand: o.oem_brand
      })
    }
  }
  return out
}

/* ── Planlama ─────────────────────────────────────────────────────────────── */

type OverrideField = 'name_override' | 'selling_price_override' | 'lock_price' | 'note'

/**
 * Dosyada BULUNAN her override alanının HEDEF (nihai) değeri — sadece değişenler
 * değil. Upsert `ON CONFLICT ... SET x = EXCLUDED.x` ile yazdığı için, değişmeyen
 * bir alan da INSERT satırında güncel değeriyle yer almalı; yoksa varsayılanla
 * (NULL/false) ezilirdi.
 */
type OverridePatch = {
  values: Partial<Record<OverrideField, string | number | boolean | null>>
  changed: boolean
}

type OemPatch = {
  add: Array<{ code: string; codeNorm: string; brand: string }>
  remove: Array<{ codeNorm: string; brand: string }>
}

type PlannedRow = {
  line: number
  supplier: ProductListSupplier
  supplierProductId: bigint
  label: string
  unlinkFrom: bigint | null
  linkTo: bigint | null
  targetProductId: bigint | null
  /** Hedef üründeki bu tedarikçi yuvasını DB'de tutan ham satır (varsa). */
  occupantRowId: bigint | null
  override: OverridePatch | null
  oems: OemPatch | null
  /** Bu satırın hedef ürün üzerinde talep ettiği alan değerleri (çakışma denetimi). */
  claims: Array<[string, string]>
  actions: string[]
}

type Plan = {
  rows: PlannedRow[]
  errors: ProductCsvImportIssue[]
  counts: ProductCsvImportResult['counts']
  /** Kimliği okunup işlenen satır sayısı. */
  processedRows: number
  /** Kimliği okunamadığı için hiç işlenmeyen satır sayısı. */
  skippedRows: number
}

/**
 * Tek seferde DB durumu yüklenen satır sayısı. Dosya bu boyutta pencerelere
 * bölünür; her pencere işlenip bırakıldığı için bellek dosya boyutundan değil
 * pencere boyutundan etkilenir.
 */
const WINDOW = 20_000

function samePrice(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a == null && b == null
  return Math.abs(a - b) < 0.005
}

/** Bir pencerelik ham satırı planlanmış değişikliklere çevirir. */
async function planWindow(
  window: ParsedRow[],
  present: Set<ProductCsvEditableColumn>,
  errors: ProductCsvImportIssue[],
  out: PlannedRow[]
): Promise<void> {
  const supplierStates: Record<ProductListSupplier, Map<string, SupplierState>> = {
    dinamik: await loadSupplierStates(
      'dinamik',
      window.filter((r) => r.supplier === 'dinamik').map((r) => r.supplierProductId)
    ),
    basbug: await loadSupplierStates(
      'basbug',
      window.filter((r) => r.supplier === 'basbug').map((r) => r.supplierProductId)
    )
  }

  // 1. geçiş: satır kimliğini doğrula, hedef kanonik ürünü belirle.
  type Stage1 = {
    row: ParsedRow
    state: SupplierState
    target: bigint | null
    unlinkFrom: bigint | null
    linkTo: bigint | null
  }
  const stage1: Stage1[] = []

  for (const row of window) {
    const state = supplierStates[row.supplier].get(row.supplierProductId.toString())
    if (!state) {
      errors.push({
        line: row.line,
        message: `${row.supplier}:${row.supplierProductId} bulunamadı ya da markası onaylı değil.`
      })
      continue
    }

    let target = state.currentProductId
    let unlinkFrom: bigint | null = null
    let linkTo: bigint | null = null

    if (present.has('canonical_product_id')) {
      const cell = row.cells.canonical_product_id ?? ''
      let desired: bigint | null = null
      if (cell) {
        if (!/^\d+$/.test(cell)) {
          errors.push({ line: row.line, message: `Geçersiz canonical_product_id "${cell}".` })
          continue
        }
        desired = BigInt(cell)
      }

      if (desired == null && state.currentProductId != null) {
        unlinkFrom = state.currentProductId
      } else if (desired != null && state.currentProductId == null) {
        linkTo = desired
      } else if (desired != null && state.currentProductId !== desired) {
        unlinkFrom = state.currentProductId
        linkTo = desired
      }
      target = desired
    }

    stage1.push({ row, state, target, unlinkFrom, linkTo })
  }

  const productStates = await loadProductStates(
    Array.from(
      new Set(
        stage1
          .flatMap((s) => [s.target, s.unlinkFrom, s.linkTo])
          .filter((v): v is bigint => v != null)
          .map((v) => v.toString())
      )
    ).map((v) => BigInt(v))
  )

  for (const { row, state, target, unlinkFrom, linkTo } of stage1) {
    const actions: string[] = []
    const rowErrors: string[] = []
    const claims: Array<[string, string]> = []
    const label = state.sku || `${row.supplier}:${row.supplierProductId}`
    let occupantRowId: bigint | null = null

    // Yuva doluluk / çakışma denetimi burada YAPILMAZ: dosyanın ilerisindeki bir
    // satır bu yuvayı boşaltıyor olabilir. Yalnız DB'deki mevcut sahibi kaydedip
    // kararı, tüm pencereler bittikten sonraki uzlaştırma geçişine bırakıyoruz.
    if (linkTo != null) {
      const targetState = productStates.get(linkTo.toString())
      if (!targetState) {
        rowErrors.push(`Kanonik ürün ${linkTo} bulunamadı.`)
      } else {
        if (targetState.brandId !== state.brandId) {
          rowErrors.push(
            `Kanonik ürün ${linkTo} farklı markada; eşleştirme yalnız aynı marka altında yapılabilir.`
          )
        }
        occupantRowId = targetState.offerRowId[row.supplier]
      }
    }

    // Override / OEM düzenlemeleri hedef kanonik ürüne yazılır.
    const targetState = target == null ? null : productStates.get(target.toString())
    if (target != null && !targetState) rowErrors.push(`Kanonik ürün ${target} bulunamadı.`)

    const override: OverridePatch = { values: {}, changed: false }
    const oems: OemPatch = { add: [], remove: [] }

    // "Anlamlı" = alanı gerçekten dolduran değer. Export her satıra `lock_price`
    // için HAYIR yazdığı ve boş hücreler "temizle" demek olduğu için, bunlar
    // hedefsiz satırda uyarı üretmemeli.
    const hasMeaningfulEdit = (
      ['name_override', 'selling_price_override', 'note', 'oems_manual'] as const
    ).some((c) => present.has(c) && (row.cells[c] ?? '') !== '')
      || (present.has('lock_price') && parseCsvBoolean(row.cells.lock_price ?? '') === true)

    if (target == null) {
      // Bağı koparılan satırda diğer hücreler eski ürünü anlatır; yazılacak hedef
      // olmadığı için sessizce yok sayılır. Hiç bağlanmamış satırda ise admin
      // gerçekten yanlış yere yazmaya çalışıyordur — o zaman uyar.
      if (unlinkFrom == null && hasMeaningfulEdit) {
        rowErrors.push(
          'Bu satır bir kanonik ürüne bağlı değil; ad/fiyat/not/OEM alanları yazılamaz. Önce canonical_product_id verin.'
        )
      }
    } else if (targetState) {
      const claim = (field: string, value: string) => claims.push([field, value])

      if (present.has('name_override')) {
        const next = (row.cells.name_override ?? '').trim() || null
        claim('name_override', next ?? '')
        override.values.name_override = next
        if (next !== targetState.nameOverride) {
          override.changed = true
          actions.push(next ? `ad → "${next}"` : 'ad override kaldırıldı')
        }
      }

      let nextPrice = targetState.price
      if (present.has('selling_price_override')) {
        const parsedPrice = parseCsvNumber(row.cells.selling_price_override ?? '')
        if (parsedPrice != null && Number.isNaN(parsedPrice)) {
          rowErrors.push(`Geçersiz fiyat "${row.cells.selling_price_override}".`)
        } else if (parsedPrice != null && parsedPrice < 0) {
          rowErrors.push('Fiyat negatif olamaz.')
        } else {
          nextPrice = parsedPrice
          claim('selling_price_override', parsedPrice == null ? '' : parsedPrice.toFixed(2))
          override.values.selling_price_override = parsedPrice
          if (!samePrice(parsedPrice, targetState.price)) {
            override.changed = true
            actions.push(parsedPrice == null ? 'fiyat override kaldırıldı' : `fiyat → ${parsedPrice}`)
          }
        }
      }

      if (present.has('lock_price')) {
        const next = parseCsvBoolean(row.cells.lock_price ?? '')
        if (next == null) {
          rowErrors.push(`Geçersiz lock_price "${row.cells.lock_price}" (EVET | HAYIR).`)
        } else {
          if (next && nextPrice == null) {
            rowErrors.push('Fiyatı kilitlemek için selling_price_override dolu olmalı.')
          }
          claim('lock_price', String(next))
          override.values.lock_price = next
          if (next !== targetState.lockPrice) {
            override.changed = true
            actions.push(next ? 'fiyat kilitlendi' : 'fiyat kilidi açıldı')
          }
        }
      }

      if (present.has('note')) {
        const next = (row.cells.note ?? '').trim() || null
        claim('note', next ?? '')
        override.values.note = next
        if (next !== targetState.note) {
          override.changed = true
          actions.push(next ? 'not güncellendi' : 'not silindi')
        }
      }

      if (present.has('oems_manual')) {
        const cell = row.cells.oems_manual ?? ''
        const wanted = new Map<string, { code: string; codeNorm: string; brand: string }>()
        for (const entry of parseOemEntries(cell)) {
          const brand = entry.brand?.trim().toUpperCase() ?? ''
          wanted.set(oemKey(entry.codeNorm, brand), {
            code: entry.code,
            codeNorm: entry.codeNorm,
            brand
          })
        }
        claim(
          'oems_manual',
          Array.from(wanted.keys()).sort().join(',')
        )

        for (const [key, value] of wanted) {
          if (!targetState.manualOems.has(key)) oems.add.push(value)
        }
        for (const [key, value] of targetState.manualOems) {
          if (!wanted.has(key)) {
            oems.remove.push({ codeNorm: value.codeNorm, brand: value.brand })
          }
        }
        if (oems.add.length > 0) actions.push(`+${oems.add.length} OEM`)
        if (oems.remove.length > 0) actions.push(`−${oems.remove.length} OEM`)
      }
    }

    if (rowErrors.length > 0) {
      // Aynı hata birden çok kontrolden gelebilir (ör. hedef ürün hem bağlama
      // hem yazma kontrolünde bulunamaz); satır başına tekilleştir.
      for (const message of new Set(rowErrors)) errors.push({ line: row.line, message })
      continue
    }

    if (unlinkFrom != null) {
      actions.unshift(linkTo != null ? `${unlinkFrom} → ${linkTo} taşındı` : `${unlinkFrom} bağı koparıldı`)
    } else if (linkTo != null) {
      actions.unshift(`${linkTo} ile eşleştirildi`)
    }

    const hasOems = oems.add.length > 0 || oems.remove.length > 0
    if (!override.changed && !hasOems && unlinkFrom == null && linkTo == null) continue

    out.push({
      line: row.line,
      supplier: row.supplier,
      supplierProductId: row.supplierProductId,
      label,
      unlinkFrom,
      linkTo,
      targetProductId: target,
      occupantRowId,
      override: override.changed ? override : null,
      oems: hasOems ? oems : null,
      // Yalnız GERÇEKTEN değişen satırlar alan talep eder. Değişmeyen bir satır
      // zaten DB'deki değeri taşıdığı için bir başkasının düzenlemesine itiraz
      // etmez — aksi hâlde aynı ürüne bağlı ikinci tedarikçi satırı, tek taraflı
      // her düzenlemede sahte "çakışma" üretirdi.
      claims: override.changed || hasOems ? claims : [],
      actions
    })
  }
}

/**
 * Pencereler bittikten sonraki tek geçiş: tedarikçi yuvası ve alan çakışmaları
 * ancak dosyanın TAMAMI görüldükten sonra karara bağlanabilir (ileriki bir satır
 * bir yuvayı boşaltıyor olabilir). Yalnız değişen satırlar üzerinde çalışır,
 * bu yüzden dosya boyutundan bağımsız olarak ucuzdur.
 */
function reconcilePlan(rows: PlannedRow[]): {
  kept: PlannedRow[]
  errors: ProductCsvImportIssue[]
} {
  const errors: ProductCsvImportIssue[] = []
  const kept: PlannedRow[] = []

  // Uygulama önce tüm koparmaları yaptığı için, koparılan yuvalar bağlamalar
  // sırasında boş olacaktır.
  const freed = new Set<string>()
  for (const r of rows) {
    if (r.unlinkFrom != null) freed.add(`${r.unlinkFrom}:${r.supplier}`)
  }

  const slotClaims = new Map<string, number>()
  const fieldClaims = new Map<string, { line: number; value: string }>()

  for (const r of rows) {
    const rowErrors: string[] = []

    if (r.linkTo != null) {
      const slot = `${r.linkTo}:${r.supplier}`
      if (
        r.occupantRowId != null &&
        r.occupantRowId !== r.supplierProductId &&
        !freed.has(slot)
      ) {
        rowErrors.push(
          `Kanonik ürün ${r.linkTo} bu firmadan zaten bağlı (ham satır ${r.occupantRowId}). Önce onu koparın.`
        )
      }
      const claimedBy = slotClaims.get(slot)
      if (claimedBy != null) {
        rowErrors.push(`Kanonik ürün ${r.linkTo} bu firma için ${claimedBy}. satırda da isteniyor.`)
      } else {
        slotClaims.set(slot, r.line)
      }
    }

    for (const [field, value] of r.claims) {
      const key = `${r.targetProductId}:${field}`
      const prev = fieldClaims.get(key)
      if (prev && prev.value !== value) {
        rowErrors.push(
          `${field} için ${prev.line}. satır farklı bir değer yazıyor (aynı kanonik ürün ${r.targetProductId}).`
        )
      } else {
        fieldClaims.set(key, { line: r.line, value })
      }
    }

    if (rowErrors.length > 0) {
      for (const message of new Set(rowErrors)) errors.push({ line: r.line, message })
      continue
    }
    kept.push(r)
  }

  return { kept, errors }
}

function countPlan(rows: PlannedRow[]): ProductCsvImportResult['counts'] {
  const counts = { link: 0, relink: 0, unlink: 0, override: 0, oems: 0 }
  for (const r of rows) {
    if (r.unlinkFrom != null && r.linkTo != null) counts.relink++
    else if (r.unlinkFrom != null) counts.unlink++
    else if (r.linkTo != null) counts.link++
    if (r.override) counts.override++
    if (r.oems) counts.oems++
  }
  return counts
}

/**
 * Dosyayı pencere pencere planlar. Her pencerede yalnız o pencerenin DB durumu
 * yüklenir ve pencere bittiğinde bırakılır; bellekte kalan tek şey DEĞİŞEN
 * satırlardır (değişiklik tavanıyla sınırlı).
 */
async function buildPlan(
  text: string,
  header: ParsedHeader,
  present: Set<ProductCsvEditableColumn>
): Promise<Plan> {
  const errors: ProductCsvImportIssue[] = []
  const seen = new Map<string, number>()
  const changed: PlannedRow[] = []
  const stats = { skipped: 0 }
  let processedRows = 0
  let window: ParsedRow[] = []

  const flush = async () => {
    if (window.length === 0) return
    await planWindow(window, present, errors, changed)
    window = []
    if (changed.length > PRODUCT_CSV_IMPORT_MAX_CHANGES) {
      throw new ProductCsvImportError(
        `Değişen satır sayısı ${PRODUCT_CSV_IMPORT_MAX_CHANGES.toLocaleString('tr-TR')} tavanını aştı; tek seferde bu kadarı uygulanabilir. Dosyayı bölün.`
      )
    }
  }

  for (const row of streamParsedRows(text, header, errors, seen, stats)) {
    processedRows++
    window.push(row)
    if (window.length >= WINDOW) await flush()
  }
  await flush()

  const { kept, errors: conflictErrors } = reconcilePlan(changed)
  errors.push(...conflictErrors)

  return {
    rows: kept,
    errors,
    counts: countPlan(kept),
    processedRows,
    skippedRows: stats.skipped
  }
}

/* ── Uygulama ─────────────────────────────────────────────────────────────── */

const OVERRIDE_COLUMNS: Record<OverrideField, { sql: Prisma.Sql; cast: string }> = {
  name_override: { sql: Prisma.raw('name_override'), cast: 'text' },
  selling_price_override: { sql: Prisma.raw('selling_price_override'), cast: 'numeric(12,2)' },
  lock_price: { sql: Prisma.raw('lock_price'), cast: 'boolean' },
  note: { sql: Prisma.raw('note'), cast: 'text' }
}

const OVERRIDE_FIELDS: OverrideField[] = [
  'name_override',
  'selling_price_override',
  'lock_price',
  'note'
]

/**
 * Override'ları toplu upsert eder. Yazılan kolon kümesi dosyada BULUNAN
 * sütunlardan gelir; dosyada olmayan alan hiç SET edilmez, mevcut değeri kalır.
 */
async function applyOverrides(
  rows: PlannedRow[],
  present: Set<ProductCsvEditableColumn>,
  actor: string
): Promise<void> {
  const targets = rows.filter((r) => r.override && r.targetProductId != null)
  if (targets.length === 0) return

  const fields = OVERRIDE_FIELDS.filter((f) => present.has(f))
  if (fields.length === 0) return

  // Aynı ürün birden çok satırda geçebilir (dinamik + başbuğ); çelişki planlama
  // aşamasında elendiği için son yazan aynı değeri yazar.
  const byProduct = new Map<string, PlannedRow>()
  for (const r of targets) byProduct.set(r.targetProductId!.toString(), r)

  const columnSql = fields.map((f) => OVERRIDE_COLUMNS[f].sql)
  const setSql = fields.map(
    (f) => Prisma.sql`${OVERRIDE_COLUMNS[f].sql} = EXCLUDED.${OVERRIDE_COLUMNS[f].sql}`
  )

  for (const part of chunk(Array.from(byProduct.entries()), 500)) {
    const values = part.map(([productId, row]) => {
      const cells = fields.map((f) => {
        // lock_price NOT NULL; alan hiç yazılmamışsa DB varsayılanına düş.
        const value = row.override!.values[f] ?? (f === 'lock_price' ? false : null)
        return Prisma.sql`${value}::${Prisma.raw(OVERRIDE_COLUMNS[f].cast)}`
      })
      return Prisma.sql`(${BigInt(productId)}::bigint, ${actor}::text, NOW(), ${Prisma.join(cells)})`
    })

    await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.product_overrides (product_id, updated_by, updated_at, ${Prisma.join(columnSql)})
      VALUES ${Prisma.join(values)}
      ON CONFLICT (product_id) DO UPDATE SET
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW(),
        ${Prisma.join(setSql)}
    `)
  }
}

async function applyOems(rows: PlannedRow[]): Promise<void> {
  const adds: Prisma.Sql[] = []
  const removes: Prisma.Sql[] = []

  for (const row of rows) {
    if (!row.oems || row.targetProductId == null) continue
    const pid = row.targetProductId
    for (const a of row.oems.add) {
      adds.push(Prisma.sql`(${pid}::bigint, ${a.code}::text, ${a.codeNorm}::text, ${a.brand}::text, 'MANUAL')`)
    }
    for (const r of row.oems.remove) {
      removes.push(Prisma.sql`(${pid}::bigint, ${r.codeNorm}::text, ${r.brand}::text)`)
    }
  }

  for (const part of chunk(removes, 500)) {
    // Yalnız admin'in sahibi olduğu satırlar silinebilir; DNMK/BSBG/PARTS
    // kaynakları sync tarafından yeniden üretilir.
    await db.$executeRaw(Prisma.sql`
      DELETE FROM catalog.product_oems
      WHERE source IN ('MANUAL', 'WEB')
        AND (product_id, code_norm, oem_brand) IN (${Prisma.join(part)})
    `)
  }

  for (const part of chunk(adds, 500)) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.product_oems (product_id, code, code_norm, oem_brand, source)
      VALUES ${Prisma.join(part)}
      ON CONFLICT (product_id, code_norm, oem_brand) DO NOTHING
    `)
  }
}

/* ── Giriş noktası ────────────────────────────────────────────────────────── */

export async function runProductCsvImport(input: {
  text: string
  mode: ProductCsvImportMode
  actor: string
}): Promise<ProductCsvImportResult> {
  const header = parseHeader(input.text)
  const present = new Set(header.editableColumns)
  const plan = await buildPlan(input.text, header, present)

  // Hatalı satırlar ne "değişen" ne de "değişmeyen" sayılır; bir satır birden
  // çok hata üretebildiği için satır bazında tekilleştirilir. Atlanan satırlar
  // (kimliği okunamayanlar) zaten processedRows'a girmediği için ayrı eklenir.
  const errorLines = new Set(plan.errors.map((e) => e.line))
  const processedWithErrors = Math.max(0, errorLines.size - plan.skippedRows)

  const base: ProductCsvImportResult = {
    mode: input.mode,
    delimiter: header.delimiter,
    totalRows: plan.processedRows + plan.skippedRows,
    editableColumns: header.editableColumns,
    ignoredHeaders: header.ignoredHeaders,
    changedRows: plan.rows.length,
    unchangedRows: Math.max(0, plan.processedRows - processedWithErrors - plan.rows.length),
    counts: plan.counts,
    appliedRows: 0,
    errorCount: plan.errors.length,
    errors: plan.errors.slice(0, SAMPLE_LIMIT),
    changes: plan.rows.slice(0, SAMPLE_LIMIT).map((r) => ({
      line: r.line,
      supplier: r.supplier,
      supplierProductId: r.supplierProductId.toString(),
      label: r.label,
      actions: r.actions
    })),
    touchedProducts: 0
  }

  if (input.mode === 'validate') return base

  if (plan.rows.length > PRODUCT_CSV_IMPORT_MAX_CHANGES) {
    throw new ProductCsvImportError(
      `${plan.rows.length.toLocaleString('tr-TR')} satır değişiyor; tek seferde en fazla ${PRODUCT_CSV_IMPORT_MAX_CHANGES.toLocaleString('tr-TR')} değişiklik uygulanabilir. Dosyayı bölün.`
    )
  }

  const failures: ProductCsvImportIssue[] = []
  const applied = new Set<number>()
  const touched = new Set<string>()

  const markTouched = (id: bigint | null) => {
    if (id != null) touched.add(id.toString())
  }

  // 1) Önce tüm koparmalar — böylece aynı dosyadaki bir başka satır boşalan
  //    tedarikçi yuvasını devralabilir.
  for (const row of plan.rows) {
    if (row.unlinkFrom == null) continue
    try {
      await unlinkSupplierRow({
        supplier: row.supplier,
        supplierProductId: row.supplierProductId
      })
      markTouched(row.unlinkFrom)
      applied.add(row.line)
    } catch (error) {
      failures.push({ line: row.line, message: `Kopartma başarısız: ${String(error)}` })
    }
  }

  // 2) Bağlamalar.
  const failedLines = new Set(failures.map((f) => f.line))
  for (const row of plan.rows) {
    if (row.linkTo == null || failedLines.has(row.line)) continue
    const result = await manualLinkSupplierRow({
      supplier: row.supplier,
      supplierProductId: row.supplierProductId,
      productId: row.linkTo,
      reviewedBy: input.actor
    })
    if (!result.ok) {
      failures.push({ line: row.line, message: `Bağlama başarısız (${result.reason}).` })
      failedLines.add(row.line)
      continue
    }
    markTouched(row.linkTo)
    applied.add(row.line)
  }

  // 3) Override + OEM yazımları (bağlama başarısız olan satırlar hariç).
  const writable = plan.rows.filter((r) => !failedLines.has(r.line))
  await applyOverrides(writable, present, input.actor)
  await applyOems(writable)
  for (const row of writable) {
    if (row.override || row.oems) {
      markTouched(row.targetProductId)
      applied.add(row.line)
    }
  }

  // 4) Fiyat/stok rollup'ı ve arama dokümanı tazelensin.
  const touchedIds = Array.from(touched).map((v) => BigInt(v))
  await refreshProductRollupsForIds(touchedIds)
  await syncProductSearchDocuments(touchedIds)

  return {
    ...base,
    appliedRows: applied.size,
    errorCount: plan.errors.length + failures.length,
    errors: [...plan.errors, ...failures].slice(0, SAMPLE_LIMIT),
    touchedProducts: touched.size
  }
}
