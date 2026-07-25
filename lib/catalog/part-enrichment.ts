/**
 * Katalog ürünlerinin zengin verisini (resim, özellik, OE/çapraz referans,
 * doküman, araç uyumluluğu, EAN) public.part_* tablolarından okur.
 *
 * Mimari karar: bu veri catalog.product_* aynalarına KOPYALANMAZ. Köprü
 * catalog.product_part_links üzerinden kurulur ve okuma canlı yapılır — tek
 * kaynak korunur ve part_vehicle_types'ın ~931M satırı çoğaltılmaz.
 *
 * Yalnız status='CONFIRMED' link'ler okunur; CANDIDATE olanlar admin onayı
 * bekler ve vitrine sızmaz.
 */
import { db } from '@/lib/db'
import { normalizeCode } from '@/lib/matching/code-normalization'

export interface PartImage {
  url: string
  thumb: string | null
}

export interface PartProperty {
  key: string
  value: string
}

export interface PartCode {
  brand: string | null
  code: string
}

export interface PartDocument {
  id: number
  name: string
  typeName: string
  fileType: string | null
  /** Mutlak http(s) adresi; scrape kalıntısı göreli yollar null'lanır. */
  url: string | null
}

export interface VehicleFitment {
  id: number
  brand: string | null
  model: string | null
  name: string
  /** "BMW 3 (E90) 320d (163 HP, Diesel)" — tek satırlık gösterim. */
  label: string
  hp: number | null
  kw: number | null
  cc: number | null
  fuelType: string | null
  yearFrom: string | null
  yearTo: string | null
}

/**
 * Bölüm başına "okunabilecek daha fazla satır var mı" bayrağı.
 *
 * DİKKAT — ham satır sayısı kullanıcıya gösterilmez. Scrape edilmiş TecDoc
 * verisi ağır mükerrer: örneğin tek bir parçanın 348 part_documents satırı
 * yalnızca 6 farklı dosyaya karşılık gelebiliyor. Bu yüzden listeler
 * tekilleştirildikten sonra uzunlukları gerçek sayı olarak kullanılır ve
 * limite dayandığımızda yalnızca "daha var" bilgisi verilir.
 */
export interface EnrichmentHasMore {
  images: boolean
  properties: boolean
  oems: boolean
  crossReferences: boolean
  documents: boolean
  vehicles: boolean
  eans: boolean
}

export interface PartEnrichment {
  images: PartImage[]
  properties: PartProperty[]
  oems: PartCode[]
  crossReferences: PartCode[]
  documents: PartDocument[]
  vehicles: VehicleFitment[]
  /** part_vehicle_types ham satır sayısı — admin tanılama panelleri kullanır. */
  vehicleCount: number
  eans: string[]
  hasMore: EnrichmentHasMore
}

const NO_MORE: EnrichmentHasMore = {
  images: false,
  properties: false,
  oems: false,
  crossReferences: false,
  documents: false,
  vehicles: false,
  eans: false,
}

export const EMPTY_ENRICHMENT: PartEnrichment = {
  images: [],
  properties: [],
  oems: [],
  crossReferences: [],
  documents: [],
  vehicles: [],
  vehicleCount: 0,
  eans: [],
  hasMore: NO_MORE,
}

export interface EnrichmentLimits {
  images?: number
  properties?: number
  oems?: number
  crossReferences?: number
  documents?: number
  vehicles?: number
  eans?: number
}

const DEFAULTS: Required<EnrichmentLimits> = {
  images: 12,
  properties: 100,
  oems: 60,
  crossReferences: 60,
  documents: 20,
  vehicles: 80,
  eans: 50,
}

/**
 * Vitrin ürün detayı — accordion bölümleri için geniş limitler. Tekilleştirme
 * uygulamada yapıldığı için limitler mükerrer satırları da soğuracak kadar
 * yüksek tutulur; satırlar küçük olduğundan maliyeti ihmal edilebilir.
 */
export const STOREFRONT_LIMITS: EnrichmentLimits = {
  images: 120,
  properties: 150,
  oems: 500,
  crossReferences: 400,
  documents: 400,
  vehicles: 400,
  eans: 60,
}

function vehicleLabel(v: {
  name: string
  fuelType: string | null
  hp: number | null
  brand: string | null
  model: string | null
}): string {
  const base = [v.brand?.trim(), v.model?.trim(), v.name?.trim()].filter(Boolean).join(' ')
  const extras = [v.hp ? `${v.hp} HP` : null, v.fuelType?.trim() || null]
    .filter(Boolean)
    .join(', ')
  return extras ? `${base} (${extras})` : base
}

/**
 * TecDoc doküman adresleri karışık: bir kısmı mutlak http(s), bir kısmı
 * scrape sırasında kalmış göreli `/tecdoc/...` yolu. Göreli olanlar bizde
 * servis edilmediği için link'lenmez.
 */
function absoluteDocUrl(raw: string | null): string | null {
  const url = raw?.trim()
  if (!url) return null
  return /^https?:\/\//i.test(url) ? url : null
}

/** Ürüne bağlı onaylanmış part id'leri. Boş dizi = köprü yok. */
export async function getConfirmedPartIds(productId: bigint): Promise<bigint[]> {
  const links = await db.product_part_links.findMany({
    where: { product_id: productId, status: 'CONFIRMED' },
    select: { part_id: true },
    orderBy: { confidence: 'desc' },
    take: 10,
  })
  return links.map((l) => l.part_id)
}

/**
 * Bağlı parçaların zengin verisini toplar. Aynı ürün birden fazla parçaya
 * bağlı olabildiği için her bölüm tekilleştirilir. Her liste limitten bir
 * fazla satır çekilir: fazlalık gelirse `hasMore` bayrağı kalkar, gösterilen
 * liste yine limit kadar kalır.
 */
export async function getPartEnrichment(
  productId: bigint,
  limits: EnrichmentLimits = {}
): Promise<PartEnrichment> {
  const partIds = await getConfirmedPartIds(productId)
  if (!partIds.length) return EMPTY_ENRICHMENT

  const take = { ...DEFAULTS, ...limits }
  const wherePart = { part_id: { in: partIds } }
  // Limit + 1: fazladan gelen satır "devamı var" demektir, ayrı count sorgusu
  // gerekmez (ham sayılar zaten mükerrer olduğu için gösterime uygun değil).
  const probe = (n: number) => n + 1

  const [images, properties, oens, crossRefs, documents, vehicleLinks, vehicleCount, eans] =
    await Promise.all([
      db.part_images.findMany({
        where: wherePart,
        select: { image: true, thumb: true },
        orderBy: { id: 'asc' },
        take: probe(take.images),
      }),
      db.part_properties.findMany({
        where: wherePart,
        select: { key: true, value: true },
        orderBy: { key: 'asc' },
        take: probe(take.properties),
      }),
      db.part_oens.findMany({
        where: wherePart,
        select: { brand: true, code: true },
        orderBy: [{ brand: 'asc' }, { code: 'asc' }],
        take: probe(take.oems),
      }),
      db.part_cross_references.findMany({
        where: wherePart,
        select: { brand_name: true, article_number: true },
        orderBy: [{ brand_name: 'asc' }, { article_number: 'asc' }],
        take: probe(take.crossReferences),
      }),
      db.part_documents.findMany({
        where: wherePart,
        select: {
          id: true,
          doc_file_name: true,
          doc_file_type_name: true,
          doc_type_name: true,
          doc_url: true,
        },
        orderBy: [{ doc_type_name: 'asc' }, { id: 'asc' }],
        take: probe(take.documents),
      }),
      // DİKKAT — part_vehicle_types ~931M satır, iki tuzağı var:
      //  1) İç içe `vehicle_type` select'i kullanma; Prisma LATERAL join üretir.
      //     Önce düz vehicle_type_id'leri al, detayı ayrı sorguda çek.
      //  2) orderBy'ı ATLAMA. Prisma varsayılan olarak `ORDER BY id ASC` ekler;
      //     LIMIT ile birleşince planlayıcı pkey'i id sırasıyla taramaya başlar
      //     ve nadir bir part_id ararken tabloyu baştan sona gezer (dakikalarca
      //     asılı kalır). Aşağıdaki sıralama uq(part_id, vehicle_type_id)
      //     indeksiyle birebir hizalı olduğu için LIMIT ucuz kalır.
      db.part_vehicle_types.findMany({
        where: wherePart,
        take: probe(take.vehicles),
        orderBy: [{ part_id: 'asc' }, { vehicle_type_id: 'asc' }],
        select: { vehicle_type_id: true },
      }),
      db.part_vehicle_types.count({ where: wherePart }),
      db.part_eans.findMany({
        where: wherePart,
        select: { code: true },
        orderBy: { id: 'asc' },
        take: probe(take.eans),
      }),
    ])

  const hasMore: EnrichmentHasMore = {
    images: images.length > take.images,
    properties: properties.length > take.properties,
    oems: oens.length > take.oems,
    crossReferences: crossRefs.length > take.crossReferences,
    documents: documents.length > take.documents,
    vehicles: vehicleLinks.length > take.vehicles,
    eans: eans.length > take.eans,
  }

  const seenImage = new Set<string>()
  const dedupedImages: PartImage[] = []
  for (const img of images.slice(0, take.images)) {
    if (!img.image || seenImage.has(img.image)) continue
    seenImage.add(img.image)
    dedupedImages.push({ url: img.image, thumb: img.thumb })
  }

  const seenKey = new Set<string>()
  const dedupedProperties: PartProperty[] = []
  for (const p of properties.slice(0, take.properties)) {
    if (seenKey.has(p.key)) continue
    seenKey.add(p.key)
    dedupedProperties.push({ key: p.key, value: p.value })
  }

  const dedupedOems = dedupeCodes(
    oens.slice(0, take.oems).map((o) => ({ brand: o.brand, code: o.code }))
  )
  const dedupedCrossRefs = dedupeCodes(
    crossRefs
      .slice(0, take.crossReferences)
      .map((x) => ({ brand: x.brand_name, code: x.article_number }))
  )

  const dedupedDocuments = dedupeDocuments(documents.slice(0, take.documents))

  const vehicles = await loadVehicles(
    vehicleLinks.slice(0, take.vehicles).map((v) => v.vehicle_type_id)
  )

  const seenEan = new Set<string>()
  const dedupedEans: string[] = []
  for (const e of eans.slice(0, take.eans)) {
    const code = e.code.trim()
    if (!code || seenEan.has(code)) continue
    seenEan.add(code)
    dedupedEans.push(code)
  }

  return {
    images: dedupedImages,
    properties: dedupedProperties,
    oems: dedupedOems,
    crossReferences: dedupedCrossRefs,
    documents: dedupedDocuments,
    vehicles,
    vehicleCount,
    eans: dedupedEans,
    hasMore,
  }
}

/**
 * Aynı doküman scrape sırasında her uygulanabilir araç için tekrar yazılmış
 * olabiliyor (bir parçanın 348 satırı → 6 dosya). Dosya adı üzerinden
 * tekilleştirir; aynı dosyanın adresli sürümü adressize tercih edilir.
 */
function dedupeDocuments(
  rows: Array<{
    id: number
    doc_file_name: string
    doc_file_type_name: string
    doc_type_name: string
    doc_url: string | null
  }>
): PartDocument[] {
  const byKey = new Map<string, PartDocument>()
  for (const d of rows) {
    const url = absoluteDocUrl(d.doc_url)
    const name = d.doc_file_name?.trim() || ''
    const key = (name || url || '').toUpperCase()
    if (!key) continue

    const existing = byKey.get(key)
    if (existing && !(existing.url == null && url != null)) continue

    byKey.set(key, {
      id: d.id,
      name,
      typeName: d.doc_type_name?.trim() || '',
      fileType: d.doc_file_type_name?.trim() || null,
      url,
    })
  }
  return [...byKey.values()]
}

/**
 * Aynı numara farklı yazımlarla (boşluk/tire) birden çok satırda durabilir;
 * marka + normalize kod üzerinden tekilleştirir, gösterim için ham yazımı korur.
 */
function dedupeCodes(rows: Array<{ brand: string | null; code: string }>): PartCode[] {
  const seen = new Set<string>()
  const out: PartCode[] = []
  for (const row of rows) {
    const code = row.code?.trim()
    if (!code) continue
    const brand = row.brand?.trim() || null
    const key = `${brand?.toUpperCase() ?? ''}|${normalizeCode(code)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ brand, code })
  }
  return out
}

/** vehicle_type_id listesini marka/model bilgisiyle zenginleştirir. */
async function loadVehicles(vehicleTypeIds: number[]): Promise<VehicleFitment[]> {
  const ids = [...new Set(vehicleTypeIds)]
  if (!ids.length) return []

  const rows = await db.vehicle_types.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      cc: true,
      fuel_type: true,
      hp: true,
      kwt: true,
      year_of_constr_from: true,
      year_of_constr_to: true,
      model: { select: { name: true, brand: { select: { name: true } } } },
    },
  })

  const vehicles: VehicleFitment[] = []
  for (const r of rows) {
    const brand = r.model?.brand?.name?.trim() || null
    const model = r.model?.name?.trim() || null
    const name = r.name?.trim() ?? ''
    const fuelType = r.fuel_type?.trim() || null
    const label = vehicleLabel({ name, fuelType, hp: r.hp, brand, model })
    if (!label) continue
    vehicles.push({
      id: r.id,
      brand,
      model,
      name,
      label,
      hp: r.hp,
      kw: r.kwt,
      cc: r.cc,
      fuelType,
      yearFrom: r.year_of_constr_from?.trim() || null,
      yearTo: r.year_of_constr_to?.trim() || null,
    })
  }

  vehicles.sort(
    (a, b) =>
      (a.brand ?? '').localeCompare(b.brand ?? '', 'tr') ||
      (a.model ?? '').localeCompare(b.model ?? '', 'tr') ||
      a.name.localeCompare(b.name, 'tr')
  )
  return vehicles
}
