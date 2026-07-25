import { db } from '@/lib/db'
import {
  getPartEnrichment,
  STOREFRONT_LIMITS,
  type EnrichmentHasMore,
  type PartCode,
  type PartDocument,
  type PartImage,
  type PartProperty,
  type VehicleFitment
} from '@/lib/catalog/part-enrichment'
import { normalizeCode } from '@/lib/matching/code-normalization'
import {
  buildCatalogPrice,
  resolveCatalogAvailability,
  resolveCatalogName,
  catalogProductHref,
  type CatalogAvailability,
  type CatalogPriceView
} from '@/lib/catalog/store-view'

export type CatalogVehicleFit = VehicleFitment

export interface CatalogCategoryRef {
  id: number
  name: string
  nameTr: string | null
  urlKey: string | null
}

export interface CatalogProductDetailView {
  id: string
  slug: string
  partNo: string
  name: string
  brand: { id: number; name: string; logoUrl: string | null }
  category: CatalogCategoryRef | null
  /** Kök → yaprak kategori zinciri (public.part_categories.parent_id). */
  categoryPath: CatalogCategoryRef[]
  status: string
  primaryImageUrl: string | null
  images: PartImage[]
  price: CatalogPriceView
  availability: CatalogAvailability
  totalStockQty: number
  offerCount: number
  oems: PartCode[]
  crossReferences: PartCode[]
  documents: PartDocument[]
  eans: string[]
  properties: PartProperty[]
  vehicles: CatalogVehicleFit[]
  /** part_vehicle_types ham satır sayısı — tanılama amaçlı, gösterilmez. */
  vehicleCount: number
  /**
   * Bölüm limite dayandı mı. Ham TecDoc satır sayıları mükerrer olduğu için
   * "+N kayıt" yerine yalnızca "listede daha fazlası var" bilgisi taşınır.
   */
  hasMore: EnrichmentHasMore
  href: string
  updatedAt: string
}

const CATEGORY_PATH_MAX_DEPTH = 5

/**
 * Kategori kırılımını yaprak düğümden köke doğru yürür ve kök → yaprak
 * sırasında döner. Bozuk/döngüsel parent_id verisine karşı derinlik sınırlı.
 */
async function getCategoryPath(leafId: number): Promise<CatalogCategoryRef[]> {
  const path: CatalogCategoryRef[] = []
  const seen = new Set<number>()
  let currentId: number | null = leafId

  for (let depth = 0; depth < CATEGORY_PATH_MAX_DEPTH && currentId != null; depth++) {
    if (seen.has(currentId)) break
    seen.add(currentId)

    // `id`'yi ayrı bir sabite al: sorgu argümanı doğrudan `currentId` olursa
    // TS, satırın tipini kendi ataması üzerinden döngüsel çözmeye çalışır.
    const id: number = currentId
    const row: (CatalogCategoryRef & { parentId: number | null }) | null =
      await db.part_categories
        .findUnique({
          where: { id },
          select: { id: true, name: true, name_tr: true, url_key: true, parent_id: true }
        })
        .then((r) =>
          r
            ? {
                id: r.id,
                name: r.name,
                nameTr: r.name_tr,
                urlKey: r.url_key,
                parentId: r.parent_id
              }
            : null
        )
    if (!row) break

    path.unshift({
      id: row.id,
      name: row.name,
      nameTr: row.nameTr,
      urlKey: row.urlKey
    })
    currentId = row.parentId
  }

  return path
}

/**
 * Katalog tarafındaki tedarikçi kaynaklı OEM'leri TecDoc (part_oens)
 * kayıtlarıyla birleştirir. Aynı numara iki kaynakta da bulunabildiği için
 * marka + normalize kod üzerinden tekilleştirilir; TecDoc kaydı marka bilgisi
 * taşıdığı için önce gelir.
 */
function mergeOems(tecdoc: PartCode[], supplier: PartCode[]): PartCode[] {
  const out: PartCode[] = []
  const seen = new Set<string>()
  for (const row of [...tecdoc, ...supplier]) {
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

/**
 * Full storefront detail for one catalog product, resolved from the offer
 * rollup cache plus enrichment (OEM/EAN/fitment/properties/images). Returns
 * null for missing or non-ACTIVE products so the route can 404.
 */
export async function getCatalogProductBySlug(
  slug: string
): Promise<CatalogProductDetailView | null> {
  const product = await db.products.findUnique({
    where: { slug },
    include: {
      brand: { select: { id: true, brand: true, logo_url: true } },
      category: { select: { id: true, name: true, name_tr: true, url_key: true } },
      product_overrides: true,
      product_oems: {
        orderBy: { id: 'asc' },
        take: 200,
        select: { code: true, oem_brand: true }
      },
      product_eans: { take: 50, select: { code: true } }
    }
  })

  if (!product || product.status !== 'ACTIVE') return null

  // Resim/özellik/OE/çapraz referans/doküman/araç uyumluluğu katalogda
  // tutulmaz; onaylanmış product_part_links üzerinden public.part_*
  // tablolarından canlı okunur.
  const enrichment = await getPartEnrichment(product.id, STOREFRONT_LIMITS)

  const override = product.product_overrides
  const categoryOverrideId = override?.category_override_id ?? null
  const category = categoryOverrideId
    ? await db.part_categories.findUnique({
        where: { id: categoryOverrideId },
        select: { id: true, name: true, name_tr: true, url_key: true }
      })
    : product.category
  const categoryPath = category ? await getCategoryPath(category.id) : []

  const price = buildCatalogPrice(product.min_selling_price_try)
  const availability = resolveCatalogAvailability({
    hasPrice: price.exVat != null,
    totalStockQty: product.total_stock_qty
  })

  const images = enrichment.images
  const primaryImageUrl = product.primary_image_url ?? images[0]?.url ?? null

  const oems = mergeOems(
    enrichment.oems,
    product.product_oems.map((o) => ({ code: o.code, brand: o.oem_brand }))
  )
  const eans = [
    ...new Set([...product.product_eans.map((e) => e.code), ...enrichment.eans])
  ]

  return {
    id: product.id.toString(),
    slug: product.slug ?? '',
    partNo: product.part_no,
    name: resolveCatalogName(product.name, override?.name_override),
    brand: {
      id: product.brand.id,
      name: product.brand.brand,
      logoUrl: product.brand.logo_url
    },
    category: category
      ? {
          id: category.id,
          name: category.name,
          nameTr: category.name_tr,
          urlKey: category.url_key
        }
      : null,
    categoryPath,
    status: product.status,
    primaryImageUrl,
    images,
    price,
    availability,
    totalStockQty: product.total_stock_qty,
    offerCount: product.offer_count,
    oems,
    crossReferences: enrichment.crossReferences,
    documents: enrichment.documents,
    eans,
    properties: enrichment.properties,
    vehicles: enrichment.vehicles,
    vehicleCount: enrichment.vehicleCount,
    hasMore: enrichment.hasMore,
    href: catalogProductHref(product.slug ?? ''),
    updatedAt: product.updated_at.toISOString()
  }
}

export interface CatalogProductCardView {
  id: string
  slug: string
  name: string
  brandName: string
  brandLogo: string | null
  image: string | null
  price: CatalogPriceView
  availability: CatalogAvailability
  href: string
}

/**
 * Lightweight card projection for storefront listings (newest priced
 * products, brand/category grids). Priced-but-out-of-stock products are
 * included as SUPPLYABLE per the "tedarik edilebilir" display policy.
 */
export async function getCatalogProductsForStore(input?: {
  brandId?: number
  categoryId?: number
  take?: number
  skip?: number
}): Promise<CatalogProductCardView[]> {
  const take = Math.min(Math.max(input?.take ?? 24, 1), 60)
  const skip = Math.max(input?.skip ?? 0, 0)

  const rows = await db.products.findMany({
    where: {
      status: 'ACTIVE',
      min_selling_price_try: { not: null },
      ...(input?.brandId ? { brand_id: input.brandId } : {}),
      ...(input?.categoryId ? { category_id: input.categoryId } : {})
    },
    // in-stock first, then most recently updated
    orderBy: [{ in_stock: 'desc' }, { updated_at: 'desc' }],
    take,
    skip,
    select: {
      id: true,
      slug: true,
      name: true,
      primary_image_url: true,
      min_selling_price_try: true,
      total_stock_qty: true,
      brand: { select: { brand: true, logo_url: true } },
      product_overrides: { select: { name_override: true } }
    }
  })

  return rows.map((r) => {
    const price = buildCatalogPrice(r.min_selling_price_try)
    return {
      id: r.id.toString(),
      slug: r.slug ?? '',
      name: resolveCatalogName(r.name, r.product_overrides?.name_override),
      brandName: r.brand.brand,
      brandLogo: r.brand.logo_url,
      image: r.primary_image_url,
      price,
      availability: resolveCatalogAvailability({
        hasPrice: price.exVat != null,
        totalStockQty: r.total_stock_qty
      }),
      href: catalogProductHref(r.slug ?? '')
    }
  })
}