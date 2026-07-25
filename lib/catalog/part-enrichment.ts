/**
 * Katalog ürünlerinin zengin verisini (resim, özellik, araç uyumluluğu, EAN)
 * public.part_* tablolarından okur.
 *
 * Mimari karar: bu veri catalog.product_* aynalarına KOPYALANMAZ. Köprü
 * catalog.product_part_links üzerinden kurulur ve okuma canlı yapılır — tek
 * kaynak korunur ve part_vehicle_types'ın ~931M satırı çoğaltılmaz.
 *
 * Yalnız status='CONFIRMED' link'ler okunur; CANDIDATE olanlar admin onayı
 * bekler ve vitrine sızmaz.
 */
import { db } from '@/lib/db'

export interface PartEnrichment {
  images: Array<{ url: string; thumb: string | null }>
  properties: Array<{ key: string; value: string }>
  vehicles: Array<{ id: number; label: string }>
  vehicleCount: number
  eans: string[]
}

export const EMPTY_ENRICHMENT: PartEnrichment = {
  images: [],
  properties: [],
  vehicles: [],
  vehicleCount: 0,
  eans: [],
}

export interface EnrichmentLimits {
  images?: number
  properties?: number
  vehicles?: number
  eans?: number
}

const DEFAULTS: Required<EnrichmentLimits> = {
  images: 12,
  properties: 100,
  vehicles: 80,
  eans: 50,
}

function vehicleLabel(vt: {
  name: string
  fuel_type: string | null
  hp: number | null
  model: { name: string; brand: { name: string } | null } | null
}): string {
  const base = [vt.model?.brand?.name?.trim(), vt.model?.name?.trim(), vt.name?.trim()]
    .filter(Boolean)
    .join(' ')
  const extras = [vt.hp ? `${vt.hp} HP` : null, vt.fuel_type?.trim() || null]
    .filter(Boolean)
    .join(', ')
  return extras ? `${base} (${extras})` : base
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
 * bağlı olabildiği için resim/özellik tekilleştirilir.
 */
export async function getPartEnrichment(
  productId: bigint,
  limits: EnrichmentLimits = {}
): Promise<PartEnrichment> {
  const partIds = await getConfirmedPartIds(productId)
  if (!partIds.length) return EMPTY_ENRICHMENT

  const take = { ...DEFAULTS, ...limits }
  const wherePart = { part_id: { in: partIds } }

  const [images, properties, vehicleLinks, vehicleCount, eans] = await Promise.all([
    db.part_images.findMany({
      where: wherePart,
      select: { image: true, thumb: true },
      orderBy: { id: 'asc' },
      take: take.images,
    }),
    db.part_properties.findMany({
      where: wherePart,
      select: { key: true, value: true },
      orderBy: { key: 'asc' },
      take: take.properties,
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
      take: take.vehicles,
      orderBy: [{ part_id: 'asc' }, { vehicle_type_id: 'asc' }],
      select: { vehicle_type_id: true },
    }),
    db.part_vehicle_types.count({ where: wherePart }),
    db.part_eans.findMany({ where: wherePart, select: { code: true }, take: take.eans }),
  ])

  const seenImage = new Set<string>()
  const dedupedImages: PartEnrichment['images'] = []
  for (const img of images) {
    if (!img.image || seenImage.has(img.image)) continue
    seenImage.add(img.image)
    dedupedImages.push({ url: img.image, thumb: img.thumb })
  }

  const seenKey = new Set<string>()
  const dedupedProperties: PartEnrichment['properties'] = []
  for (const p of properties) {
    if (seenKey.has(p.key)) continue
    seenKey.add(p.key)
    dedupedProperties.push({ key: p.key, value: p.value })
  }

  const vehicleTypeIds = [...new Set(vehicleLinks.map((v) => v.vehicle_type_id))]
  const vehicleTypes = vehicleTypeIds.length
    ? await db.vehicle_types.findMany({
        where: { id: { in: vehicleTypeIds } },
        select: {
          id: true,
          name: true,
          fuel_type: true,
          hp: true,
          model: { select: { name: true, brand: { select: { name: true } } } },
        },
      })
    : []

  const vehicles: PartEnrichment['vehicles'] = []
  for (const vt of vehicleTypes) {
    const label = vehicleLabel(vt)
    if (label.length > 0) vehicles.push({ id: vt.id, label })
  }

  return {
    images: dedupedImages,
    properties: dedupedProperties,
    vehicles,
    vehicleCount,
    eans: [...new Set(eans.map((e) => e.code))],
  }
}
