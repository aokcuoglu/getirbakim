/**
 * CSV üretimi/ayrıştırması — admin toplu (export → Excel'de düzenle → import)
 * akışları için. Tarayıcı ve sunucu tarafında da kullanılabilir (DB bağımlılığı
 * yok).
 *
 * Excel-TR uyumu iki noktada kritik:
 *   - Ayraç `;` olmalı; virgülle yazılan dosya TR yerelinde tek sütuna düşer.
 *   - Dosya UTF-8 BOM ile başlamalı; yoksa Türkçe karakterler bozulur.
 * Import tarafı yine de ayracı otomatik tespit eder, böylece dosya Google
 * Sheets/LibreOffice'ten virgüllü ya da sekmeli dönse de okunur.
 */

export const CSV_BOM = '\uFEFF'

/** Excel-TR varsayılanı. Export bunu kullanır; import otomatik tespit eder. */
export const CSV_DEFAULT_DELIMITER = ';'

const CANDIDATE_DELIMITERS = [';', ',', '\t'] as const

/**
 * Excel/LibreOffice bu karakterlerle başlayan hücreyi formül olarak çalıştırır.
 * Export bunları tek tırnakla kaçırır, import aynı öneki simetrik olarak soyar —
 * böylece gidiş-dönüş değerleri bozmaz.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

/** Bir hücreyi CSV'ye yazılacak biçime getirir (gerekiyorsa tırnaklar). */
export function csvCell(value: unknown, delimiter: string = CSV_DEFAULT_DELIMITER): string {
  if (value == null) return ''
  let s = String(value)
  if (s === '') return ''
  if (FORMULA_PREFIX.test(s)) s = `'${s}`
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Bir satırı CRLF sonlu CSV metnine çevirir. */
export function csvLine(values: unknown[], delimiter: string = CSV_DEFAULT_DELIMITER): string {
  return values.map((v) => csvCell(v, delimiter)).join(delimiter) + '\r\n'
}

/** csvCell()'in eklediği formül kaçış önekini geri alır. */
export function unescapeCsvCell(value: string): string {
  if (value.startsWith("'") && FORMULA_PREFIX.test(value.slice(1))) return value.slice(1)
  return value
}

/** İlk mantıksal satırda (tırnak dışında) en çok geçen ayracı seçer. */
export function detectCsvDelimiter(text: string): string {
  const body = text.startsWith(CSV_BOM) ? text.slice(1) : text
  const counts = new Map<string, number>(CANDIDATE_DELIMITERS.map((d) => [d, 0]))
  let inQuotes = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"') {
      if (inQuotes && body[i + 1] === '"') {
        i++
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) break
    if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1)
  }
  let best = CSV_DEFAULT_DELIMITER
  let bestCount = 0
  for (const d of CANDIDATE_DELIMITERS) {
    const c = counts.get(d) ?? 0
    if (c > bestCount) {
      best = d
      bestCount = c
    }
  }
  return best
}

/**
 * RFC 4180 ayrıştırıcı, satır satır: tırnaklı alanlar, `""` kaçışı, alan içi
 * satır sonu ve CRLF/LF/CR karışımını taşır. Tamamen boş satırlar atılır (Excel
 * dosya sonuna boş satır eklemeyi sever).
 *
 * Generator olması bilinçli: yüz binlerce satırlık dosyada tüm satırları bir
 * `string[][]` içinde tutmak gigabaytlara çıkıyor. Çağıran satırı işleyip
 * bırakabilsin diye tek tek üretilir.
 */
export function* iterateCsvRows(
  text: string,
  delimiter: string = CSV_DEFAULT_DELIMITER
): Generator<string[]> {
  const body = text.startsWith(CSV_BOM) ? text.slice(1) : text
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && body[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') yield row
      row = []
      continue
    }
    field += ch
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') yield row
  }
}

/** `iterateCsvRows`'un tümünü toplayan kolaylık sarmalayıcısı (küçük girdiler için). */
export function parseCsvRows(text: string, delimiter: string = CSV_DEFAULT_DELIMITER): string[][] {
  return Array.from(iterateCsvRows(text, delimiter))
}

/**
 * TR/EN karışık sayı biçimlerini okur: `1.234,56`, `1234,56`, `1234.56`, `1234`.
 * Boş hücre `null`, çözülemeyen hücre `NaN` döner (çağıran ikisini ayırmalı).
 */
export function parseCsvNumber(raw: string): number | null {
  const s = raw.replace(/[\s\u00A0]/g, '')
  if (!s) return null

  let t = s
  const lastComma = t.lastIndexOf(',')
  const lastDot = t.lastIndexOf('.')

  if (lastComma >= 0 && lastDot >= 0) {
    // İkisi de varsa sondaki ondalık ayracıdır, diğeri binlik ayracıdır.
    const decimal = lastComma > lastDot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    t = t.split(thousands).join('')
    t = t.replace(decimal, '.')
  } else if (lastComma >= 0) {
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.split(',').join('') : t.replace(/,/g, '.')
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.split('.').join('')
  }

  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

/** Para hücresi: TR ondalık ayracıyla iki hane (`1234.5` → `1234,50`). */
export function formatCsvNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return value.toFixed(2).replace('.', ',')
}

const TRUE_WORDS = new Set([
  '1', 'true', 'evet', 'e', 'yes', 'y', 'x', 'dogru', 'doğru', 'var', 'acik', 'açık'
])
const FALSE_WORDS = new Set([
  '0', 'false', 'hayir', 'hayır', 'h', 'no', 'n', 'yanlis', 'yanlış', 'yok', 'kapali', 'kapalı'
])

/** Boş hücre `false`; anlaşılmayan hücre `null` (çağıran hata üretir). */
export function parseCsvBoolean(raw: string): boolean | null {
  const s = raw.trim().toLowerCase()
  if (!s) return false
  if (TRUE_WORDS.has(s)) return true
  if (FALSE_WORDS.has(s)) return false
  return null
}

/** Boolean hücresinin yazımı — Excel'in DOĞRU/YANLIŞ otomatik dönüşümüne girmez. */
export function formatCsvBoolean(value: boolean): string {
  return value ? 'EVET' : 'HAYIR'
}
