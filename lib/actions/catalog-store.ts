import { db } from '@/lib/db'
import {
  buildCatalogPrice,
  resolveCatalogAvailability,
  resolveCatalogName,
  catalogProductHref,
  type CatalogAvailability,
  type CatalogPriceView
} from '@/lib/catalog/store-view'

export interface CatalogVehicleFit {
  id: number
  label: string
}

export interface CatalogProductDetailView {
  id: string
  slug: string
  partNo: string
  name: string
  brand: { id: number; name: string; logoUrl: string | null }
  category: { id: number; name: string } | null
  status: string
  primaryImageUrl: string | null
  images: Array<{ url: string; thumb: string | null }>
  price: CatalogPriceView
  availability: CatalogAvailability
  totalStockQty: number
  offerCount: number
  oems: Array<{ code: string; brand: string | null }>
  eans: string[]
  properties: Array<{ key: string; value: string }>
  vehicles: CatalogVehicleFit[]
  vehicleCount: number
  href: string
  updatedAt: string
}

function vehicleLabel(vt: {
  name: string
  fuel_type: string | null
  hp: number | null
  vmodels: { name: string; vbrands: { name: string } } | null
}): string {
  const make = vt.vmodels?.vbrands?.name?.trim()
  const model = vt.vmodels?.name?.trim()
  const parts = [make, model, vt.name?.trim()].filter(Boolean)
  const base = parts.join(' ')
  const extras = [vt.hp ? `${vt.hp} HP` : null, vt.fuel_type?.trim() || null]
    .filter(Boolean)
    .join(', ')
  return extras ? `${base} (${extras})` : base
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
      brand_list: { select: { id: true, brand: true, logo_url: true } },
      part_categories: { select: { id: true, name: true } },
      product_overrides: true,
      product_images: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: 12,
        select: { url: true, thumb: true }
      },
      product_oems: {
        orderBy: { id: 'asc' },
        take: 200,
        select: { code: true, oem_brand: true }
      },
      product_eans: { take: 50, select: { code: true } },
      product_properties: {
        orderBy: { key: 'asc' },
        take: 100,
        select: { key: true, value: true }
      },
      product_vehicle_types: {
        take: 80,
        include: {
          vtypes: {
            select: {
              id: true,
              name: true,
              fuel_type: true,
              hp: true,
              vmodels: { select: { name: true, vbrands: { select: { name: true } } } }
            }
          }
        }
      },
      _count: { select: { product_vehicle_types: true } }
    }
  })

  if (!product || product.status !== 'ACTIVE') return null

  const override = product.product_overrides
  const categoryOverrideId = override?.category_override_id ?? null
  const category = categoryOverrideId
    ? await db.part_categories.findUnique({
        where: { id: categoryOverrideId },
        select: { id: true, name: true }
      })
    : product.part_categories

  const price = buildCatalogPrice(product.min_selling_price_try)
  const availability = resolveCatalogAvailability({
    hasPrice: price.exVat != null,
    totalStockQty: product.total_stock_qty
  })

  const images = product.product_images.map((img) => ({
    url: img.url,
    thumb: img.thumb
  }))
  const primaryImageUrl = product.primary_image_url ?? images[0]?.url ?? null

  return {
    id: product.id.toString(),
    slug: product.slug ?? '',
    partNo: product.part_no,
    name: resolveCatalogName(product.name, override?.name_override),
    brand: {
      id: product.brand_list.id,
      name: product.brand_list.brand,
      logoUrl: product.brand_list.logo_url
    },
    category: category ? { id: category.id, name: category.name } : null,
    status: product.status,
    primaryImageUrl,
    images,
    price,
    availability,
    totalStockQty: product.total_stock_qty,
    offerCount: product.offer_count,
    oems: product.product_oems.map((o) => ({ code: o.code, brand: o.oem_brand })),
    eans: product.product_eans.map((e) => e.code),
    properties: product.product_properties.map((p) => ({ key: p.key, value: p.value })),
    vehicles: product.product_vehicle_types
      .filter((pvt) => pvt.vtypes)
      .map((pvt) => ({ id: pvt.vtypes!.id, label: vehicleLabel(pvt.vtypes!) }))
      .filter((v) => v.label.length > 0),
    vehicleCount: product._count.product_vehicle_types,
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
  brandListId?: number
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
      ...(input?.brandListId ? { brand_list_id: input.brandListId } : {}),
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
      brand_list: { select: { brand: true, logo_url: true } },
      product_overrides: { select: { name_override: true } }
    }
  })

  return rows.map((r) => {
    const price = buildCatalogPrice(r.min_selling_price_try)
    return {
      id: r.id.toString(),
      slug: r.slug ?? '',
      name: resolveCatalogName(r.name, r.product_overrides?.name_override),
      brandName: r.brand_list.brand,
      brandLogo: r.brand_list.logo_url,
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
