/**
 * Bekleyen catalog.product_ref_suggestions satırlarını inceler ve uygular:
 *   kind='NAME' → catalog.product_overrides.name_override
 *   kind='OEM'  → catalog.product_oems (source='WEB')
 *
 * Varsayılan kaynak rpa-claude (Google AI Modu kuyruğu). Admin ekranı tek
 * çağrıda 300 satır sınırlı; kuyruk onlarca bin satır.
 *
 * NAME kapıları: dolu override'a dokunma; jenerik SEO dolgusunu reddet;
 * yer tutucu adda onayla; açıklayıcı adda parça tipi / konum / araç çelişmesin.
 *
 * OEM kapıları: kod ≥5 + rakam, ürünün kendi part_no'su değil; MANUAL'e
 * dokunma (on conflict do nothing); açıklayıcı addaki araç markası ile
 * oem_brand çelişiyorsa reddet. source='WEB' — elle girilen MANUAL ayrı kalır.
 *
 * Kullanım:
 *   bun scripts/approve-ref-suggestions.ts                 # dry-run
 *   bun scripts/approve-ref-suggestions.ts --apply
 *   bun scripts/approve-ref-suggestions.ts --apply --kind=OEM
 *   bun scripts/approve-ref-suggestions.ts --apply --kind=NAME
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma } from '@prisma/client'
import { db } from '../lib/db'
import { isPlaceholderName } from '../lib/catalog/seo-name'
import { inferVehicleMakers, sameMakerFamily } from '../lib/catalog/vehicle-makers'
import { normalizeOem } from '../lib/matching/code-normalization'
import { loadOemBrandVocabulary } from '../lib/catalog/ref-suggestions'
import { createBrandResolver } from '../lib/catalog/oem-sources/oem-brand-vocab'

const args = process.argv.slice(2)
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const APPLY = args.includes('--apply')
const LIMIT = flag('limit') ? Number(flag('limit')) : null
const BATCH = Number(flag('batch') ?? 500)
const OEM_BATCH = Number(flag('oem-batch') ?? 2000)
const KIND = (flag('kind') ?? 'ALL').toUpperCase()
const SOURCE = flag('source') ?? 'rpa-claude'
const ACTOR = 'bulk-approve-ref'
const OEM_SOURCE = 'WEB'

const MAKER_ALIASES: Record<string, string> = {
  VW: 'VOLKSWAGEN',
  MERCEDES: 'MERCEDES-BENZ',
  MB: 'MERCEDES-BENZ',
  GM: 'CHEVROLET',
  'GENERAL MOTORS': 'CHEVROLET',
  CHEVY: 'CHEVROLET'
}

function canonMaker(raw: string): string {
  const u = raw.trim().toUpperCase()
  return MAKER_ALIASES[u] ?? u
}

interface Row {
  id: bigint
  product_id: bigint
  value: string
  confidence: string
  brand: string
  part_no: string
  current_name: string
  has_override: boolean
}

interface OemRow {
  id: bigint
  product_id: bigint
  value: string
  value_norm: string
  oem_brand: string
  confidence: string
  brand: string
  part_no: string
  part_no_norm: string
  current_name: string
}

type Decision =
  | 'APPROVE_PLACEHOLDER'
  | 'APPROVE_SAME_TYPE'
  | 'REJECT_GENERIC'
  | 'REJECT_TYPE_MISMATCH'
  | 'REJECT_VEHICLE'
  | 'REJECT_POSITION'
  | 'REJECT_DOWNSPEC'
  | 'SKIP_HAS_OVERRIDE'
  | 'LEAVE_PENDING'

type OemDecision = 'APPROVE' | 'REJECT_INVALID' | 'REJECT_VEHICLE'

const GENERIC_RE =
  /e-?ticaret\s*seo|seo\s*başl[iı]ğ|yedek\s*par[çc]a\s+ve\s+aksesuar|aksesuar\s+modelleri|üniversal\s+endüstriyel|çeşitleri|fiyatlar[ıi]?\b|sat[ıi]n\s*al/i

const STOP = new Set([
  'ON',
  'ARKA',
  'SAG',
  'SOL',
  'UST',
  'ALT',
  'IC',
  'ICI',
  'DIS',
  'ORTA',
  'UYUMLU',
  'MODELLERI',
  'MODEL',
  'MODELI',
  'MODELLER',
  'URUNLERI',
  'URUN',
  'YEDEK',
  'PARCA',
  'AKSESUAR',
  'MALZEME',
  'METAL',
  'PLASTIK',
  'CELIK',
  'KAUCUK',
  'ALUMINYUM',
  'SERAMIK',
  'KOMPLE',
  'TAKIM',
  'TAKIMI',
  'SET',
  'SETI',
  'KIT',
  'KITI',
  'TIP',
  'TIPI',
  'ADET',
  'VE',
  'ILE',
  'ICIN',
  'SERI',
  'SERISI',
  'GRUBU',
  'SISTEMI',
  'SISTEM',
  'OTOMOTIV',
  'ENDUSTRIYEL',
  'UNIVERSAL',
  'UNIV',
  'CESITLERI',
  'FIYATLAR',
  'SATIN',
  'AL',
  'BUYANYPART',
  'TICARET',
  'SEO',
  'BASLIGI',
  'MOTOR',
  'MOTORU',
  'MOTORLARI',
  'BENZIN',
  'BENZINLI',
  'DIZEL',
  'DZL',
  'HIBRIT',
  'MM',
  'CM',
  'INCH',
  'OEM',
  'ORJINAL',
  'ORIJINAL',
  'ITHAL',
  'IMPORT',
  'OE',
  'KALITE',
  'YUKSEK',
  'YENI'
])

const POSITION = new Set(['ON', 'ARKA', 'SAG', 'SOL', 'UST', 'ALT', 'IC', 'DIS'])
const POSITION_PAIRS: [string, string][] = [
  ['ON', 'ARKA'],
  ['SAG', 'SOL'],
  ['UST', 'ALT'],
  ['IC', 'DIS']
]
const SENSE_PAIRS: [string, string][] = [
  ['EMME', 'EGZOZ'],
  ['INTAKE', 'EXHAUST'],
  ['RADYATOR', 'KALORIFER']
]

const EXTRA_MAKERS = [
  'KARSAN',
  'BMC',
  'OTOKAR',
  'TEMSA',
  'MAGIRUS',
  'SETRA',
  'NEOPLAN',
  'SOLARIS',
  'FATIH'
]

const STEM_ALIASES: Record<string, string> = {
  SUBAP: 'SUPAP',
  SUBAB: 'SUPAP',
  SUPAP: 'SUPAP',
  SUBABI: 'SUPAP',
  SUPABI: 'SUPAP',
  EMME: 'EMME',
  EGZOZ: 'EGZOZ',
  EXHAUST: 'EGZOZ',
  INTAKE: 'EMME',
  CONTA: 'CONTA',
  CONTASI: 'CONTA',
  GASKET: 'CONTA',
  KECE: 'KECE',
  KECESI: 'KECE',
  SEAL: 'KECE',
  KAYIS: 'KAYIS',
  KAYISI: 'KAYIS',
  BELT: 'KAYIS',
  DISK: 'DISK',
  DISKI: 'DISK',
  DISC: 'DISK',
  BALATA: 'BALATA',
  BALATASI: 'BALATA',
  PAD: 'BALATA',
  KALIPER: 'KALIPER',
  KALIPERI: 'KALIPER',
  CALIPER: 'KALIPER',
  HORTUM: 'HORTUM',
  HORTUMU: 'HORTUM',
  HOSE: 'HORTUM',
  POMPA: 'POMPA',
  POMPASI: 'POMPA',
  PUMP: 'POMPA',
  DEVIRDAIM: 'DEVIRDAIM',
  RULMAN: 'RULMAN',
  RULMANI: 'RULMAN',
  BEARING: 'RULMAN',
  GERGI: 'GERGI',
  GERGISI: 'GERGI',
  FILTER: 'FILTRE',
  FILTRE: 'FILTRE',
  FILTRESI: 'FILTRE',
  BOBIN: 'BOBIN',
  BOBINI: 'BOBIN',
  SENSOR: 'SENSOR',
  CAMURLUK: 'CAMURLUK',
  TAMPON: 'TAMPON',
  FAR: 'FAR',
  LAMBA: 'LAMBA',
  SINYAL: 'SINYAL',
  KONTAK: 'KONTAK',
  TERMIG: 'KONTAK',
  TERMIGI: 'KONTAK',
  AKS: 'AKS',
  KAPLIN: 'AKS'
}

function fold(s: string): string {
  return s
    .replace(/i/g, 'İ')
    .replace(/ı/g, 'I')
    .toUpperCase()
    .replace(/Ç/g, 'C')
    .replace(/Ğ/g, 'G')
    .replace(/İ/g, 'I')
    .replace(/Ö/g, 'O')
    .replace(/Ş/g, 'S')
    .replace(/Ü/g, 'U')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return fold(s).split(/\s+/).filter(Boolean)
}

function stem(t: string): string {
  if (STEM_ALIASES[t]) return STEM_ALIASES[t]
  const stripped = t.replace(/(LARI|LERI|LAR|LER|SINI|SUNU|SI|I|U|UN|LI|LU)$/g, '')
  if (stripped.length >= 4) return STEM_ALIASES[stripped] ?? stripped
  return STEM_ALIASES[t] ?? t
}

function contentStems(toks: string[], brand: string, partNo: string): Set<string> {
  const brandToks = new Set(tokens(brand))
  const pn = fold(partNo).replace(/\s+/g, '')
  const out = new Set<string>()
  for (const raw of toks) {
    if (raw.length < 3) continue
    if (STOP.has(raw) || POSITION.has(raw)) continue
    if (brandToks.has(raw)) continue
    if (pn && (raw === pn || (raw.length >= 5 && pn.includes(raw)))) continue
    if (/^\d+$/.test(raw)) continue
    if (/^\d+[A-Z]{0,3}$/.test(raw) && raw.length <= 5) continue
    out.add(stem(raw))
  }
  return out
}

function positionsOf(toks: string[]): Set<string> {
  return new Set(toks.filter((t) => POSITION.has(t)))
}

function exclusive(side: Set<string>, x: string, y: string): 'x' | 'y' | null {
  const hasX = side.has(x)
  const hasY = side.has(y)
  if (hasX && !hasY) return 'x'
  if (hasY && !hasX) return 'y'
  return null
}

function positionConflict(a: Set<string>, b: Set<string>): boolean {
  for (const [x, y] of POSITION_PAIRS) {
    const ea = exclusive(a, x, y)
    const eb = exclusive(b, x, y)
    if (ea && eb && ea !== eb) return true
  }
  return false
}

function isDowngrade(
  current: string,
  suggested: string,
  curStems: Set<string>,
  sugStems: Set<string>
): boolean {
  const c = current.trim().length
  const s = suggested.trim().length
  if (s < 35 && c > 50) return true
  if (s + 15 < c && sugStems.size + 2 < curStems.size) return true
  return false
}

function senseConflict(a: Set<string>, b: Set<string>): boolean {
  for (const [x, y] of SENSE_PAIRS) {
    const ea = exclusive(a, x, y)
    const eb = exclusive(b, x, y)
    if (ea && eb && ea !== eb) return true
  }
  return false
}

function isPlaceholderLike(name: string, brand: string, partNo: string): boolean {
  if (isPlaceholderName(name, brand, partNo)) return true
  const folded = fold(name).replace(/\s+/g, '')
  const b = fold(brand).replace(/\s+/g, '')
  const pn = fold(partNo).replace(/\s+/g, '')
  let rest = folded
  if (pn) rest = rest.replace(pn, '')
  if (rest.length === 0) return true
  if (rest.length >= 2 && (b.startsWith(rest) || rest.startsWith(b) || rest.endsWith(b))) return true
  if (rest.length <= 8 && !/\d/.test(rest)) return true
  return false
}

function hasAlienSku(suggested: string, partNo: string): boolean {
  const pn = fold(partNo).replace(/\s+/g, '')
  const m = pn.match(/^([A-Z]{2,8})(\d{3,})/)
  if (!m) return false
  const prefix = m[1]
  for (const t of tokens(suggested)) {
    if (t === pn || (pn && (t.includes(pn) || pn.includes(t)))) continue
    if (t.startsWith(prefix) && /\d{3,}/.test(t) && t !== pn) return true
  }
  return false
}

function stemsOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) {
    if (b.has(x)) return true
    for (const y of b) {
      if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return true
    }
  }
  return false
}

function makersOf(text: string): string[] {
  const out = new Set(inferVehicleMakers(text))
  const upper = text.toUpperCase()
  for (const maker of EXTRA_MAKERS) {
    if (new RegExp(`(?<![0-9A-ZÇĞİÖŞÜ])${maker}(?![0-9A-ZÇĞİÖŞÜ])`).test(upper)) out.add(maker)
  }
  return [...out]
}

function makersConflict(current: string, suggested: string): boolean {
  const a = makersOf(current)
  const b = makersOf(suggested)
  if (a.length === 0 || b.length === 0) return false
  return !a.some((m) => b.some((n) => m === n || sameMakerFamily(m, n)))
}

function suggestedLosesVehicle(current: string, suggested: string): boolean {
  const a = makersOf(current)
  const b = makersOf(suggested)
  return a.length > 0 && b.length === 0
}

function classifyOem(row: OemRow): OemDecision {
  const codeNorm = normalizeOem(row.value_norm) ?? normalizeOem(row.value) ?? ''
  const partNorm = row.part_no_norm || normalizeOem(row.part_no) || ''
  if (codeNorm.length < 5 || !/\d/.test(codeNorm)) return 'REJECT_INVALID'
  if (
    partNorm &&
    (codeNorm === partNorm || codeNorm.startsWith(partNorm) || partNorm.startsWith(codeNorm))
  ) {
    return 'REJECT_INVALID'
  }
  const oemBrand = (row.oem_brand ?? '').trim()
  if (oemBrand) {
    const makers = makersOf(row.current_name)
    if (makers.length > 0) {
      const brand = canonMaker(oemBrand)
      const hit = makers.some((m) => {
        const cm = canonMaker(m)
        return cm === brand || sameMakerFamily(cm, brand)
      })
      if (!hit) return 'REJECT_VEHICLE'
    }
  }
  return 'APPROVE'
}

function classify(row: Row): Decision {
  if (row.has_override) return 'SKIP_HAS_OVERRIDE'
  const title = row.value.trim()
  if (title.length < 8) return 'REJECT_GENERIC'
  if (GENERIC_RE.test(title)) return 'REJECT_GENERIC'
  if (/\t/.test(title) || hasAlienSku(title, row.part_no)) return 'REJECT_GENERIC'

  const sugToks = tokens(title)
  const curToks = tokens(row.current_name)
  const sugStems = contentStems(sugToks, row.brand, row.part_no)
  const curStems = contentStems(curToks, row.brand, row.part_no)

  if (sugStems.size === 0) return 'REJECT_GENERIC'

  const placeholder =
    isPlaceholderLike(row.current_name, row.brand, row.part_no) || curStems.size === 0

  if (placeholder) return 'APPROVE_PLACEHOLDER'

  if (positionConflict(positionsOf(curToks), positionsOf(sugToks))) return 'REJECT_POSITION'
  if (senseConflict(curStems, sugStems)) return 'REJECT_TYPE_MISMATCH'
  if (makersConflict(row.current_name, title)) return 'REJECT_VEHICLE'
  if (suggestedLosesVehicle(row.current_name, title)) return 'REJECT_VEHICLE'
  if (isDowngrade(row.current_name, title, curStems, sugStems)) return 'REJECT_DOWNSPEC'

  if (curStems.size > 0 && sugStems.size > 0) {
    return stemsOverlap(curStems, sugStems) ? 'APPROVE_SAME_TYPE' : 'REJECT_TYPE_MISMATCH'
  }

  return 'LEAVE_PENDING'
}

function sample(rows: Row[], n = 6): string {
  const pick = rows.length <= n ? rows : [...rows].sort(() => Math.random() - 0.5).slice(0, n)
  return pick
    .map(
      (r) =>
        `    ${r.brand} ${r.part_no} [${r.confidence}]\n` +
        `      now: ${r.current_name.slice(0, 110)}\n` +
        `      sug: ${r.value.slice(0, 110)}`
    )
    .join('\n')
}

function sampleOem(rows: OemRow[], n = 6): string {
  const pick = rows.length <= n ? rows : [...rows].sort(() => Math.random() - 0.5).slice(0, n)
  return pick
    .map(
      (r) =>
        `    ${r.brand} ${r.part_no} [${r.confidence}] ${r.current_name.slice(0, 70)}\n` +
        `      → ${r.oem_brand || '(marka yok)'} ${r.value}`
    )
    .join('\n')
}

async function runNames(): Promise<void> {
  const rows = await db.$queryRaw<Row[]>`
    select s.id, s.product_id, s.value, s.confidence,
           b.brand, p.part_no, p.name as current_name,
           (nullif(btrim(o.name_override), '') is not null) as has_override
    from catalog.product_ref_suggestions s
    join catalog.products p on p.id = s.product_id
    join catalog.brands b on b.id = p.brand_id
    left join catalog.product_overrides o on o.product_id = s.product_id
    where s.kind = 'NAME' and s.status = 'PENDING'
      and s.source_site = ${SOURCE}
    order by s.id
    ${LIMIT ? Prisma.sql`limit ${LIMIT}` : Prisma.empty}
  `

  const buckets = new Map<Decision, Row[]>()
  for (const r of rows) {
    const d = classify(r)
    const list = buckets.get(d) ?? []
    list.push(r)
    buckets.set(d, list)
  }

  const approveRaw = [
    ...(buckets.get('APPROVE_PLACEHOLDER') ?? []),
    ...(buckets.get('APPROVE_SAME_TYPE') ?? [])
  ]
  const seenProduct = new Set<string>()
  const approve: Row[] = []
  for (const r of approveRaw) {
    const key = r.product_id.toString()
    if (seenProduct.has(key)) continue
    seenProduct.add(key)
    approve.push(r)
  }
  const reject = [
    ...(buckets.get('REJECT_GENERIC') ?? []),
    ...(buckets.get('REJECT_TYPE_MISMATCH') ?? []),
    ...(buckets.get('REJECT_VEHICLE') ?? []),
    ...(buckets.get('REJECT_POSITION') ?? []),
    ...(buckets.get('REJECT_DOWNSPEC') ?? [])
  ]

  console.log(
    `${rows.length.toLocaleString('tr-TR')} PENDING NAME önerisi` +
      (APPLY ? '' : ' [DRY-RUN]') +
      (LIMIT ? ` · limit ${LIMIT}` : '')
  )
  const order: Decision[] = [
    'APPROVE_PLACEHOLDER',
    'APPROVE_SAME_TYPE',
    'REJECT_GENERIC',
    'REJECT_TYPE_MISMATCH',
    'REJECT_VEHICLE',
    'REJECT_POSITION',
    'REJECT_DOWNSPEC',
    'SKIP_HAS_OVERRIDE',
    'LEAVE_PENDING'
  ]
  for (const key of order) {
    const list = buckets.get(key) ?? []
    if (list.length === 0) continue
    console.log(`\n${key}: ${list.length.toLocaleString('tr-TR')}`)
    console.log(sample(list))
  }

  if (!APPLY) {
    console.log(
      `\nNAME onaylanacak ${approve.length.toLocaleString('tr-TR')} · reddedilecek ${reject.length.toLocaleString('tr-TR')} · bekleyen ${(buckets.get('LEAVE_PENDING') ?? []).length.toLocaleString('tr-TR')}`
    )
    return
  }

  let applied = 0
  let markedApplied = 0
  for (let i = 0; i < approve.length; i += BATCH) {
    const chunk = approve.slice(i, i + BATCH)
    const values = chunk.map((r) => Prisma.sql`(${r.product_id}, ${r.value.trim()}, ${ACTOR})`)
    applied += await db.$executeRaw`
      insert into catalog.product_overrides (product_id, name_override, updated_by)
      values ${Prisma.join(values)}
      on conflict (product_id) do update
        set name_override = excluded.name_override,
            updated_by = excluded.updated_by,
            updated_at = current_timestamp
      where catalog.product_overrides.name_override is null
         or btrim(catalog.product_overrides.name_override) = ''
    `
    markedApplied += await db.$executeRaw`
      update catalog.product_ref_suggestions
      set status = 'APPLIED', applied_at = current_timestamp,
          reviewed_at = current_timestamp, reviewed_by = ${ACTOR}
      where id in (${Prisma.join(chunk.map((r) => r.id))})
        and status = 'PENDING'
    `
    process.stdout.write(
      `\r  name ${Math.min(i + BATCH, approve.length).toLocaleString('tr-TR')}/${approve.length.toLocaleString('tr-TR')}`
    )
  }
  if (approve.length > 0) process.stdout.write('\n')

  let markedRejected = 0
  for (let i = 0; i < reject.length; i += BATCH) {
    const chunk = reject.slice(i, i + BATCH)
    markedRejected += await db.$executeRaw`
      update catalog.product_ref_suggestions
      set status = 'REJECTED', reviewed_at = current_timestamp, reviewed_by = ${ACTOR}
      where id in (${Prisma.join(chunk.map((r) => r.id))})
        and status = 'PENDING'
    `
  }

  console.log(`
──────────────────────────────────────────────
name_override yazılan : ${applied.toLocaleString('tr-TR')}
NAME APPLIED          : ${markedApplied.toLocaleString('tr-TR')}
NAME REJECTED         : ${markedRejected.toLocaleString('tr-TR')}
──────────────────────────────────────────────`)
}

async function runOems(): Promise<void> {
  const resolveBrand = createBrandResolver(await loadOemBrandVocabulary())
  const rows = await db.$queryRaw<OemRow[]>`
    select s.id, s.product_id, s.value, s.value_norm, s.oem_brand, s.confidence,
           b.brand, p.part_no, p.part_no_norm, p.name as current_name
    from catalog.product_ref_suggestions s
    join catalog.products p on p.id = s.product_id
    join catalog.brands b on b.id = p.brand_id
    where s.kind = 'OEM' and s.status = 'PENDING'
      and s.source_site = ${SOURCE}
    order by s.id
    ${LIMIT ? Prisma.sql`limit ${LIMIT}` : Prisma.empty}
  `

  const buckets = new Map<OemDecision, OemRow[]>()
  for (const r of rows) {
    const d = classifyOem(r)
    const list = buckets.get(d) ?? []
    list.push(r)
    buckets.set(d, list)
  }

  const approveRaw = buckets.get('APPROVE') ?? []
  const reject = [
    ...(buckets.get('REJECT_INVALID') ?? []),
    ...(buckets.get('REJECT_VEHICLE') ?? [])
  ]

  const seen = new Set<string>()
  const approve: OemRow[] = []
  const dupIds: bigint[] = []
  for (const r of approveRaw) {
    const codeNorm = normalizeOem(r.value_norm) ?? normalizeOem(r.value) ?? r.value_norm
    const oemBrand = resolveBrand(r.oem_brand ?? '')
    const key = `${r.product_id}|${codeNorm}|${oemBrand}`
    if (seen.has(key)) {
      dupIds.push(r.id)
      continue
    }
    seen.add(key)
    approve.push({ ...r, value_norm: codeNorm, oem_brand: oemBrand })
  }

  console.log(
    `\n${rows.length.toLocaleString('tr-TR')} PENDING OEM önerisi (source=${SOURCE})` +
      (APPLY ? '' : ' [DRY-RUN]') +
      (LIMIT ? ` · limit ${LIMIT}` : '')
  )
  for (const key of ['APPROVE', 'REJECT_VEHICLE', 'REJECT_INVALID'] as OemDecision[]) {
    const list = buckets.get(key) ?? []
    if (list.length === 0) continue
    console.log(`\nOEM ${key}: ${list.length.toLocaleString('tr-TR')}`)
    console.log(sampleOem(list))
  }

  if (!APPLY) {
    console.log(
      `\nOEM yazılacak ${approve.length.toLocaleString('tr-TR')} · reddedilecek ${reject.length.toLocaleString('tr-TR')}` +
        (dupIds.length > 0 ? ` · tekrar ${dupIds.length.toLocaleString('tr-TR')}` : '')
    )
    return
  }

  let inserted = 0
  let markedApplied = 0
  for (let i = 0; i < approve.length; i += OEM_BATCH) {
    const chunk = approve.slice(i, i + OEM_BATCH)
    const values = chunk.map(
      (r) =>
        Prisma.sql`(${r.product_id}, ${r.value}, ${r.value_norm}, ${r.oem_brand}, ${OEM_SOURCE})`
    )
    inserted += await db.$executeRaw(Prisma.sql`
      insert into catalog.product_oems (product_id, code, code_norm, oem_brand, source)
      values ${Prisma.join(values)}
      on conflict (product_id, code_norm, oem_brand) do nothing
    `)
    markedApplied += await db.$executeRaw`
      update catalog.product_ref_suggestions
      set status = 'APPLIED', applied_at = current_timestamp,
          reviewed_at = current_timestamp, reviewed_by = ${ACTOR}
      where id in (${Prisma.join(chunk.map((r) => r.id))})
        and status = 'PENDING'
    `
    process.stdout.write(
      `\r  oem  ${Math.min(i + OEM_BATCH, approve.length).toLocaleString('tr-TR')}/${approve.length.toLocaleString('tr-TR')}`
    )
  }
  if (approve.length > 0) process.stdout.write('\n')

  for (let i = 0; i < dupIds.length; i += OEM_BATCH) {
    const part = dupIds.slice(i, i + OEM_BATCH)
    markedApplied += await db.$executeRaw`
      update catalog.product_ref_suggestions
      set status = 'APPLIED', applied_at = current_timestamp,
          reviewed_at = current_timestamp, reviewed_by = ${ACTOR}
      where id in (${Prisma.join(part)})
        and status = 'PENDING'
    `
  }

  let markedRejected = 0
  for (let i = 0; i < reject.length; i += OEM_BATCH) {
    const chunk = reject.slice(i, i + OEM_BATCH)
    markedRejected += await db.$executeRaw`
      update catalog.product_ref_suggestions
      set status = 'REJECTED', reviewed_at = current_timestamp, reviewed_by = ${ACTOR}
      where id in (${Prisma.join(chunk.map((r) => r.id))})
        and status = 'PENDING'
    `
  }

  console.log(`
──────────────────────────────────────────────
product_oems eklenen  : ${inserted.toLocaleString('tr-TR')}  (source='${OEM_SOURCE}')
OEM APPLIED           : ${markedApplied.toLocaleString('tr-TR')}
OEM REJECTED          : ${markedRejected.toLocaleString('tr-TR')}
MANUAL satırlarına dokunulmaz (on conflict do nothing)
──────────────────────────────────────────────`)
}

async function main(): Promise<void> {
  const runName = KIND === 'ALL' || KIND === 'NAME'
  const runOem = KIND === 'ALL' || KIND === 'OEM'
  if (!runName && !runOem) {
    console.error('--kind=NAME|OEM|ALL olmalı')
    process.exit(1)
  }
  console.log(`kaynak=${SOURCE} · kind=${KIND}` + (APPLY ? ' · APPLY' : ' · DRY-RUN'))
  if (runName) await runNames()
  if (runOem) await runOems()
  if (!APPLY) console.log('\nYazmak için --apply ver.')
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await db.$disconnect()
  process.exit(1)
})
