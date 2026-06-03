import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import {
  decimalToString,
  resolvePublicPriceAndPurchasability
} from '@/lib/pricing/public-pricing'
import type {
  PartHero,
  PartMetadata,
  PartTabsData
} from '@/lib/actions/getPartById'

type V0ProductBaseRow = {
  id: bigint
  display_name: string
  brand_name: string | null
  primary_image_url: string | null
}

type BestOfferRow = {
  provider_code: string
  supplier_sku: string | null
  supplier_name: string | null
  price: string | null
  stock_qty: number | null
}

type PublicPartRow = {
  id: bigint
  name: string
  brand_id: number
  brand_name: string
  brand_logo_url: string | null
  category_id: number
  category_name: string
  category_url_key: string | null
}

type ImageRow = {
  image: string | null
  thumb: string | null
}

type PropertyRow = {
  key: string
  value: string
}

type InfoRow = {
  content: string
}

type OenRow = {
  brand: string
  code: string
}

type EanRow = {
  code: string
}

type CrossReferenceRow = {
  brand_name: string
  article_number: string
}

type VehicleRow = {
  id: number
  brand_name: string
  model_name: string
  vehicle_name: string
  type_name: string
  year_from: string | null
  year_to: string | null
}

export type V0ProductDetailBundle = {
  hero: PartHero
  metadata: PartMetadata
  tabs: PartTabsData
  publicPartId: string | null
  providerCode: string | null
}

function parsePrice(value: string | null | undefined): Prisma.Decimal | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  try {
    return new Prisma.Decimal(parsed)
  } catch {
    return null
  }
}

function toSafeNumber(value: bigint): number {
  const num = Number(value)
  return Number.isSafeInteger(num) ? num : Number(value.toString())
}

async function fetchV0ProductBase(v0ProductId: number): Promise<V0ProductBaseRow | null> {
  const rows = await db.$queryRaw<V0ProductBaseRow[]>(Prisma.sql`
    SELECT id, display_name, brand_name, primary_image_url
    FROM v0.products
    WHERE id = ${BigInt(v0ProductId)}
      AND status = 'ACTIVE'
    LIMIT 1
  `)
  return rows[0] ?? null
}

async function fetchBestOffer(v0ProductId: number): Promise<BestOfferRow | null> {
  const rows = await db.$queryRaw<BestOfferRow[]>(Prisma.sql`
    WITH offers AS (
      SELECT
        'DNMK'::text AS provider_code,
        d.stock_code AS supplier_sku,
        d.stock_name AS supplier_name,
        c.price::text AS price,
        COALESCE(c.stock_qty, 0)::int AS stock_qty
      FROM v0.product_sources s
      JOIN v0.dnmk_products d ON d.id = s.dnmk_products_id
      LEFT JOIN v0.dnmk_cost c ON c.dnmk_products_id = d.id
      WHERE s.v0_product_id = ${BigInt(v0ProductId)}
        AND s.source_type = 'DNMK'
        AND d.is_passive IS DISTINCT FROM TRUE
        AND COALESCE(c.price, 0) > 0

      UNION ALL

      SELECT
        'BSBG'::text AS provider_code,
        b.malzeme_no AS supplier_sku,
        b.aciklama AS supplier_name,
        COALESCE(latest.fiyat_tl, b.liste_fiyati)::text AS price,
        0::int AS stock_qty
      FROM v0.product_sources s
      JOIN v0.bsbg_products b ON b.id = s.bsbg_products_id
      LEFT JOIN LATERAL (
        SELECT fiyat_tl, liste_fiyati
        FROM v0.bsbg_cost c
        WHERE c.bsbg_products_id = b.id
        ORDER BY c.captured_at DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE s.v0_product_id = ${BigInt(v0ProductId)}
        AND s.source_type = 'BSBG'
        AND b.is_passive IS DISTINCT FROM TRUE
        AND COALESCE(latest.fiyat_tl, b.liste_fiyati, 0) > 0
    )
    SELECT provider_code, supplier_sku, supplier_name, price, stock_qty
    FROM offers
    ORDER BY
      CASE WHEN stock_qty > 0 THEN 0 ELSE 1 END,
      price::numeric ASC NULLS LAST,
      provider_code ASC
    LIMIT 1
  `)
  return rows[0] ?? null
}

async function fetchApprovedPublicPart(v0ProductId: number): Promise<PublicPartRow | null> {
  const rows = await db.$queryRaw<PublicPartRow[]>(Prisma.sql`
    SELECT
      p.id,
      p.name,
      pb.id AS brand_id,
      pb.name AS brand_name,
      pb.logo_url AS brand_logo_url,
      pc.id AS category_id,
      pc.name AS category_name,
      pc.url_key AS category_url_key
    FROM v0.product_public_part_links l
    JOIN public.parts p ON p.id = l.part_id
    JOIN public.part_brands pb ON pb.id = p.brand_id
    JOIN public.part_categories pc ON pc.id = p.category_id
    WHERE l.v0_product_id = ${BigInt(v0ProductId)}
      AND l.status = 'APPROVED'
    ORDER BY l.confidence DESC, l.id ASC
    LIMIT 1
  `)
  return rows[0] ?? null
}

async function fetchPublicPartEnrichment(partId: bigint) {
  const [images, properties, infos, oens, eans, crossReferences, vehicles] =
    await Promise.all([
      db.$queryRaw<ImageRow[]>(Prisma.sql`
        SELECT image, thumb
        FROM public.part_images
        WHERE part_id = ${partId}
        ORDER BY id ASC
        LIMIT 8
      `),
      db.$queryRaw<PropertyRow[]>(Prisma.sql`
        SELECT key, value
        FROM public.part_properties
        WHERE part_id = ${partId}
        ORDER BY key ASC
        LIMIT 80
      `),
      db.$queryRaw<InfoRow[]>(Prisma.sql`
        SELECT content
        FROM public.part_infos
        WHERE part_id = ${partId}
        ORDER BY id ASC
        LIMIT 40
      `),
      db.$queryRaw<OenRow[]>(Prisma.sql`
        SELECT brand, code
        FROM public.part_oens
        WHERE part_id = ${partId}
        ORDER BY brand ASC, code ASC
        LIMIT 120
      `),
      db.$queryRaw<EanRow[]>(Prisma.sql`
        SELECT code
        FROM public.part_eans
        WHERE part_id = ${partId}
        ORDER BY code ASC
        LIMIT 80
      `),
      db.$queryRaw<CrossReferenceRow[]>(Prisma.sql`
        SELECT brand_name, article_number
        FROM public.part_cross_references
        WHERE part_id = ${partId}
        ORDER BY brand_name ASC, article_number ASC
        LIMIT 160
      `),
      db.$queryRaw<VehicleRow[]>(Prisma.sql`
        SELECT
          vt.id,
          vb.name AS brand_name,
          vm.name AS model_name,
          vt.name AS vehicle_name,
          COALESCE(vtd.type_name, vt.name) AS type_name,
          COALESCE(vtd.year_of_constr_from, vt.year_of_constr_from) AS year_from,
          COALESCE(vtd.year_of_constr_to, vt.year_of_constr_to) AS year_to
        FROM public.part_vehicle_types pvt
        JOIN v0.vtypes vt ON vt.id = pvt.vehicle_type_id
        JOIN v0.vmodels vm ON vm.id = vt.model_id
        JOIN v0.vbrands vb ON vb.id = vm.brand_id
        LEFT JOIN v0.vtype_details vtd ON vtd.vehicle_type_id = vt.id
        WHERE pvt.part_id = ${partId}
        ORDER BY vb.name ASC, vm.name ASC, vt.name ASC
        LIMIT 300
      `)
    ])

  return { images, properties, infos, oens, eans, crossReferences, vehicles }
}

export async function fetchV0ProductDetailBundle(
  v0ProductId: number
): Promise<V0ProductDetailBundle | null> {
  const product = await fetchV0ProductBase(v0ProductId)
  if (!product) return null

  const [offer, publicPart] = await Promise.all([
    fetchBestOffer(v0ProductId),
    fetchApprovedPublicPart(v0ProductId)
  ])

  const enrichment = publicPart
    ? await fetchPublicPartEnrichment(publicPart.id)
    : {
        images: [] as ImageRow[],
        properties: [] as PropertyRow[],
        infos: [] as InfoRow[],
        oens: [] as OenRow[],
        eans: [] as EanRow[],
        crossReferences: [] as CrossReferenceRow[],
        vehicles: [] as VehicleRow[]
      }

  const pricing = resolvePublicPriceAndPurchasability({
    realPriceExVat: parsePrice(offer?.price),
    stockQty: offer?.stock_qty ?? 0
  })

  const id = toSafeNumber(product.id)
  const brandName = publicPart?.brand_name || product.brand_name || 'Unknown'
  const categoryName = publicPart?.category_name || 'Auto Parts'
  const images =
    product.primary_image_url && product.primary_image_url.trim()
      ? [
          {
            image: product.primary_image_url,
            thumb: product.primary_image_url
          },
          ...enrichment.images
        ]
      : enrichment.images

  const hero: PartHero = {
    id,
    name: offer?.supplier_name?.trim() || product.display_name,
    articleNumber: offer?.supplier_sku ?? null,
    price: decimalToString(pricing.resolvedPriceExVat),
    stockQty: pricing.stockQty,
    priceSource: pricing.priceSource,
    isPlaceholderPrice: pricing.isPlaceholderPrice,
    isPurchasable: pricing.isPurchasable,
    brand: {
      id: publicPart?.brand_id ?? 0,
      name: brandName,
      logoUrl: publicPart?.brand_logo_url ?? null
    },
    category: {
      id: publicPart?.category_id ?? 0,
      name: categoryName,
      urlKey: publicPart?.category_url_key ?? ''
    },
    images,
    properties: enrichment.properties,
    eans: enrichment.eans.map((ean) => ean.code)
  }

  const metadata: PartMetadata = {
    id,
    name: hero.name,
    brandName,
    categoryName,
    imageUrl: hero.images[0]?.image ?? null,
    eans: hero.eans
  }

  const tabs: PartTabsData = {
    properties: enrichment.properties,
    infos: enrichment.infos.map((info) => info.content),
    oens: enrichment.oens.map((oen) => ({
      brand: oen.brand,
      code: oen.code
    })),
    crossReferences: enrichment.crossReferences.map((ref) => ({
      brandName: ref.brand_name,
      articleNumber: ref.article_number
    })),
    compatibleVehicles: enrichment.vehicles.map((vehicle) => ({
      id: vehicle.id,
      brandName: vehicle.brand_name,
      modelName: vehicle.model_name,
      vehicleName: vehicle.vehicle_name,
      typeName: vehicle.type_name,
      yearFrom: vehicle.year_from,
      yearTo: vehicle.year_to
    }))
  }

  return {
    hero,
    metadata,
    tabs,
    publicPartId: publicPart?.id.toString() ?? null,
    providerCode: offer?.provider_code ?? null
  }
}

export function getV0ProductDetailBundle(
  v0ProductId: number
): Promise<V0ProductDetailBundle | null> {
  return unstable_cache(
    () => fetchV0ProductDetailBundle(v0ProductId),
    ['v0-product-detail', String(v0ProductId)],
    { revalidate: 300 }
  )()
}
