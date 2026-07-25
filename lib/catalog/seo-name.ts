/**
 * Tedarikçiden gelen ham ürün adını vitrin/SEO başlığına çevirir.
 *
 * Neden: Dinamik adları tamamen büyük harf ve Türkçe karaktersiz geliyor
 * ("ALTERNATOR GERGI RULMANI CLIO KANGOO MEGANE 1.4"). Arama hacmi olan başlık
 * ise marka + parça tipi + araç/model sırasını ve doğru Türkçe yazımı istiyor
 * ("A.B.A. Alternatör Gergi Rulmanı Clio Kangoo Megane 1.4").
 *
 * Bu dönüşüm YENİ BİLGİ ÜRETMEZ — yalnız var olan metni yeniden biçimlendirir.
 * Araç uyumluluğu/OEM gibi doğrulanması gereken veriler web önerisi akışından
 * (catalog.product_ref_suggestions) geçer, buradan değil.
 */

/** Türkçe'ye duyarlı büyütme (i → İ, ı → I). */
function trUpper(value: string): string {
  return value.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase()
}

/**
 * Sözlükte olmayan token'lar için başlık biçimi — Türkçe DEĞİL, standart
 * küçültme kullanır. Bu token'ların neredeyse tamamı yabancı model adı
 * (CLIO, INSIGNIA, TRANSIT); Türkçe küçültme "Clıo" üretirdi. Türkçe sözcükler
 * WORD_FIXES'ten doğru yazımıyla geldiği için bu yol onları hiç görmez.
 */
function foreignTitle(word: string): string {
  if (word.length === 0) return word
  return word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()
}

/**
 * Diyakritiksiz büyük harfli tedarikçi sözcükleri → doğru Türkçe yazım.
 * Anahtarlar normalize edilmiş (büyük harf, noktalama yok) biçimde tutulur.
 */
const WORD_FIXES: Record<string, string> = {
  // Parça tipleri
  ALTERNATOR: 'Alternatör',
  GERGI: 'Gergi',
  GERGISI: 'Gergisi',
  RULMAN: 'Rulman',
  RULMANI: 'Rulmanı',
  RULMANLI: 'Rulmanlı',
  KAYIS: 'Kayış',
  KAYISI: 'Kayışı',
  KANALLI: 'Kanallı',
  TRIGER: 'Triger',
  EKSANTRIK: 'Eksantrik',
  DISLISI: 'Dişlisi',
  DISLI: 'Dişli',
  KASNAK: 'Kasnak',
  KASNAGI: 'Kasnağı',
  KUTUK: 'Kütük',
  KUTUGU: 'Kütüğü',
  KUTUKLU: 'Kütüklü',
  BILYA: 'Bilya',
  BILYASI: 'Bilyası',
  BILYALI: 'Bilyalı',
  DEVIRDAIM: 'Devirdaim',
  DEVIRDAIMLI: 'Devirdaimli',
  DEVIRDAIMSIZ: 'Devirdaimsiz',
  TITRESIM: 'Titreşim',
  AMORTISOR: 'Amortisör',
  AMORTISORLU: 'Amortisörlü',
  KOMPLE: 'Komple',
  TAKIM: 'Takım',
  TAKIMI: 'Takımı',
  SET: 'Set',
  SETI: 'Seti',
  KIT: 'Kit',
  KITI: 'Kiti',
  POMPA: 'Pompa',
  POMPASI: 'Pompası',
  SU: 'Su',
  DEBRIYAJ: 'Debriyaj',
  VOLANT: 'Volant',
  SANZUMAN: 'Şanzıman',
  DIREKSIYON: 'Direksiyon',
  KLIMA: 'Klima',
  KLIMALI: 'Klimalı',
  KLIMASIZ: 'Klimasız',
  SILINDIR: 'Silindir',
  MOTOR: 'Motor',
  SOGUTMA: 'Soğutma',
  YAG: 'Yağ',
  SUPAP: 'Supap',
  ZINCIR: 'Zincir',
  ZINCIRI: 'Zinciri',
  KAPAK: 'Kapak',
  KAPAGI: 'Kapağı',
  YATAK: 'Yatak',
  YATAGI: 'Yatağı',
  BURC: 'Burç',
  BURCU: 'Burcu',
  KECE: 'Keçe',
  KECESI: 'Keçesi',
  SACI: 'Sacı',
  BASKI: 'Baskı',
  DISK: 'Disk',
  DISKI: 'Diski',
  BALATA: 'Balata',
  BALATASI: 'Balatası',
  ROT: 'Rot',
  ROTU: 'Rotu',
  ROTIL: 'Rotil',
  ROTILI: 'Rotili',
  SALINCAK: 'Salıncak',
  SALINCAGI: 'Salıncağı',
  // Yön / konum
  ON: 'Ön',
  ARKA: 'Arka',
  SAG: 'Sağ',
  SOL: 'Sol',
  UST: 'Üst',
  ALT: 'Alt',
  IC: 'İç',
  ICI: 'İçi',
  DIS: 'Dış',
  ORTA: 'Orta',
  BUYUK: 'Büyük',
  KUCUK: 'Küçük',
  TIP: 'Tip',
  TIPI: 'Tipi',
  ADET: 'Adet',
  DIZEL: 'Dizel',
  DZL: 'Dizel',
  BENZIN: 'Benzin',
  BENZINLI: 'Benzinli',
  SERI: 'Seri',
  SERISI: 'Serisi',
  KASA: 'Kasa',
  VE: 've',
  ILE: 'ile',
  ICIN: 'için'
}

/** Tamamı büyük kalması gereken araç markası / etiket sözcükleri. */
const KEEP_UPPER = new Set([
  'ABA',
  'BMW',
  'DAF',
  'MAN',
  'VW',
  'GM',
  'PSA',
  'OEM',
  'MB',
  'HP',
  'PS',
  'KW',
  'ABS',
  'EGR',
  'TDI',
  'TDCI',
  'CRDI',
  'FSI',
  'TSI',
  'JTD',
  'HDI',
  'DCI',
  'CDI',
  'MPI',
  'GTI',
  'SRI',
  'CC',
  'MM',
  'DOHC',
  'SOHC',
  'III',
  'II',
  'IV',
  'VI',
  'VII',
  'VIII',
  'IX'
])

/** Kod gibi görünen token'lar (rakam içerir) — biçimini bozmadan bırakılır. */
function looksLikeCode(token: string): boolean {
  return /\d/.test(token)
}

/** "17X63X22" → "17x63x22" (ölçü), "1,4" → "1.4" (motor hacmi). */
function tidyCodeToken(token: string): string {
  let out = token
  if (/^\d+([.,]\d+)?([Xx]\d+([.,]\d+)?)+$/.test(out)) out = out.replace(/X/g, 'x')
  // Motor hacminde virgül yerine nokta: "1,4" → "1.4" ("1,4TDI" dahil)
  out = out.replace(/^(\d),(\d)/, '$1.$2')
  return out
}

/**
 * Sözlük anahtarı: büyük harf + diyakritik katlama ("Kayışı" ve "KAYISI" aynı
 * anahtara düşsün) + noktalama temizliği.
 */
function normalizeWordKey(token: string): string {
  return trUpper(token)
    .replace(/Ç/g, 'C')
    .replace(/Ğ/g, 'G')
    .replace(/İ/g, 'I')
    .replace(/Ö/g, 'O')
    .replace(/Ş/g, 'S')
    .replace(/Ü/g, 'U')
    .replace(/[^A-Z0-9]/g, '')
}

function fixWord(token: string): string {
  if (looksLikeCode(token)) return tidyCodeToken(token)

  // Noktalama (parantez, tire, eğik çizgi) korunarak parçalara ayrılır.
  return token
    .split(/([-/()[\].,])/)
    .map((piece) => {
      if (piece.length === 0 || /^[-/()[\].,]$/.test(piece)) return piece
      const key = normalizeWordKey(piece)
      const fixed = WORD_FIXES[key]
      if (fixed) return fixed
      if (KEEP_UPPER.has(key)) return piece.toUpperCase()
      // Tek/iki harfli model kodları (E90, G, H, X) büyük kalır.
      if (piece.length <= 2) return piece.toUpperCase()
      return foreignTitle(piece)
    })
    .join('')
}

export interface SeoNameInput {
  /** Vitrinde görünecek marka etiketi (ör. 'A.B.A.'). */
  brandLabel: string
  /** Tedarikçi/web kaynaklı ham ad. */
  rawName: string
  /** Ürünün kendi parça numarası — ham adın sonundaki tekrarını temizlemek için. */
  partNo?: string | null
  /** Başlık sonuna parça numarası eklenir (varsayılan: hayır). */
  includePartNo?: boolean
  /** Karakter sınırı; kelime sınırında kesilir (varsayılan 120). */
  maxLength?: number
}

/**
 * Ham adı SEO başlığına çevirir. Ham ad yalnızca "ABA 25100603" gibi bir
 * yer tutucuysa (marka + parça no, başka bilgi yok) `null` döner — böyle
 * ürünlerin adı webden gelen öneriyle doldurulmalı, uydurulmamalı.
 */
export function buildSeoProductName(input: SeoNameInput): string | null {
  const { brandLabel, rawName, partNo, includePartNo = false, maxLength = 120 } = input

  let body = rawName.replace(/\s+/g, ' ').trim()
  if (body.length === 0) return null

  // Baştaki marka tekrarını at ("ABA ALTERNATOR..." → "ALTERNATOR...").
  const brandKey = normalizeWordKey(brandLabel)
  const tokens = body.split(' ')
  while (tokens.length > 0 && normalizeWordKey(tokens[0]) === brandKey) tokens.shift()
  body = tokens.join(' ')

  // Kalan tek şey parça numarasıysa gerçek bir ad yok.
  const partKey = partNo ? normalizeWordKey(partNo) : null
  if (partKey && normalizeWordKey(body) === partKey) return null
  if (body.length === 0) return null

  // " - " ayırıcısını sadeleştir, tekrar eden boşlukları topla.
  body = body
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()

  const pretty = body
    .split(' ')
    .map(fixWord)
    .filter((t) => t.length > 0)
    .join(' ')

  const parts = [brandLabel.trim(), pretty]
  if (includePartNo && partNo) parts.push(partNo)
  let title = parts.join(' ').replace(/\s+/g, ' ').trim()

  if (title.length > maxLength) {
    const cut = title.slice(0, maxLength)
    const lastSpace = cut.lastIndexOf(' ')
    title = (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s\-/,(]+$/, '')
  }

  return title
}

/**
 * Parça tipini oluşturan sözcükler ("V Kayış Gergi Rulmanı"). Başlığı
 * araç / tip / motor bölümlerine ayırmak için çapa olarak kullanılır.
 */
const PART_TYPE_KEYS = new Set([
  'V',
  'KAYIS',
  'KAYISI',
  'KANALLI',
  'GERGI',
  'GERGISI',
  'RULMAN',
  'RULMANI',
  'RULMANLI',
  'TRIGER',
  'ALTERNATOR',
  'EKSANTRIK',
  'DISLI',
  'DISLISI',
  'KASNAK',
  'KASNAGI',
  'KUTUK',
  'KUTUGU',
  'KUTUKLU',
  'BILYA',
  'BILYASI',
  'BILYALI',
  'DEVIRDAIM',
  'DEVIRDAIMLI',
  'DEVIRDAIMSIZ',
  'POMPA',
  'POMPASI',
  'SU',
  'ZINCIR',
  'ZINCIRI',
  'SET',
  'SETI',
  'KIT',
  'KITI',
  'TAKIM',
  'TAKIMI',
  'KOMPLE',
  'AMORTISOR',
  'AMORTISORLU',
  'TITRESIM'
])

interface SplitTitle {
  /** Parça tipi öbeği ("Alternatör Gergi Rulmanı"). */
  type: string
  /** Tip öncesi tokenlar — araç markası/modeli. */
  vehicle: string[]
  /** Tip sonrası tokenlar — motor hacmi, yıl, ölçü vb. */
  extras: string[]
}

/**
 * Web başlığını «araç | parça tipi | motor/ek» olarak ayırır.
 *
 * Siteler başlığı "Alfa Romeo 166 Alternatör Gergi Rulmanı 2.5" düzeninde
 * kuruyor: parça tipi, sözlükteki tip sözcüklerinin kesintisiz en uzun dizisi;
 * öncesi araç, sonrası motor/ölçü bilgisi.
 */
function splitTitle(rawTitle: string): SplitTitle | null {
  const tokens = rawTitle.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (tokens.length === 0) return null

  let bestStart = -1
  let bestLen = 0
  let start = -1
  for (let i = 0; i <= tokens.length; i++) {
    const isType = i < tokens.length && PART_TYPE_KEYS.has(normalizeWordKey(tokens[i]))
    if (isType) {
      if (start < 0) start = i
    } else if (start >= 0) {
      if (i - start > bestLen) {
        bestLen = i - start
        bestStart = start
      }
      start = -1
    }
  }
  if (bestLen === 0) return null

  return {
    type: tokens.slice(bestStart, bestStart + bestLen).join(' '),
    vehicle: tokens.slice(0, bestStart),
    extras: tokens.slice(bestStart + bestLen)
  }
}

/**
 * Aynı ürün için farklı sitelerden gelen başlıkları TEK bir ada birleştirir.
 *
 * Neden: siteler çoğu kez parçayı tek bir araca göre adlandırıyor ("Brava
 * Triger Gergi Rulmanı", "Palio Triger Gergi Rulmanı"). Bunlardan birini seçmek
 * ürünün gerçekte uyduğu araçların çoğunu adın dışında bırakır — hem yanlış hem
 * de arama açısından dar. Bu yüzden parça tipi ortaktan alınır, araç ve motor
 * bilgileri birleştirilir:
 *
 *   ["Brava Triger Gergi Rulmanı 1.6 16V", "Palio Triger Gergi Rulmanı 1.6"]
 *     → "Triger Gergi Rulmanı Brava Palio 1.6 16V"
 *
 * Sonuç buildSeoProductName'e ham ad olarak verilir (marka ön eki + yazım
 * düzeltmesi orada yapılır).
 */
export function mergeWebTitles(rawTitles: string[]): string | null {
  const parts = rawTitles.map(splitTitle).filter((p): p is SplitTitle => p !== null)
  if (parts.length === 0) return null

  // Parça tipi: en sık geçen öbek; eşitlikte daha uzun (daha belirgin) olan.
  const typeCounts = new Map<string, number>()
  for (const p of parts) {
    const key = normalizeWordKey(p.type)
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1)
  }
  let bestKey = ''
  let bestCount = 0
  for (const [key, count] of typeCounts) {
    if (count > bestCount || (count === bestCount && key.length > bestKey.length)) {
      bestKey = key
      bestCount = count
    }
  }
  const type = parts.find((p) => normalizeWordKey(p.type) === bestKey)!.type

  // Araç ve motor tokenları: sırayı koruyarak tekilleştir.
  const dedupe = (lists: string[][]) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const list of lists) {
      for (const token of list) {
        const key = normalizeWordKey(token)
        if (key.length === 0 || seen.has(key)) continue
        seen.add(key)
        out.push(token)
      }
    }
    return out
  }

  const vehicles = dedupe(parts.map((p) => p.vehicle))
  const extras = dedupe(parts.map((p) => p.extras))

  return [type, ...vehicles, ...extras].join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Web başlıklarındaki satıcı stok kodu artıklarını atar
 * ("… Gergi Rulmanı SUS-BG0040-02" → "… Gergi Rulmanı").
 *
 * Yalnız rakam içeren tireli kodları hedefler; "C-MAX" gibi gerçek model
 * adları rakam taşımadığı için korunur.
 */
export function stripVendorCodes(rawName: string): string {
  return (
    rawName
      // Tireli satıcı kodları: SUS-BG0040-02, LTNS-359
      .replace(/\b[A-Za-z]{2,}-[A-Za-z0-9]*\d[A-Za-z0-9-]*\b/g, ' ')
      // Rakip marka stok kodları: ATB2128, KD45562, VKM26503
      .replace(/\b[A-Za-z]{2,4}\d{4,}[A-Za-z0-9]*\b/g, ' ')
      // OEM numaraları (sonek harfli olabilir): 7700870795, 130701564R
      .replace(/\b\d{6,}[A-Za-z]{0,2}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Ham ad yalnızca "<MARKA> <PARÇA NO>" yer tutucusu mu? */
export function isPlaceholderName(rawName: string, brandLabel: string, partNo: string): boolean {
  const stripped = normalizeWordKey(rawName)
  return (
    stripped === normalizeWordKey(`${brandLabel}${partNo}`) || stripped === normalizeWordKey(partNo)
  )
}
