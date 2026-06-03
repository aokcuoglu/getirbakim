import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export type VehicleProductCategory = {
  categoryId: number
  categoryName: string
  categoryNameTr: string | null
  urlKey: string | null
  productCount: number
  minPrice: string | null
}

export type VehicleProductListItem = {
  v0ProductId: string
  name: string
  brandName: string | null
  categoryId: number
  categoryName: string
  publicPartId: string
  price: string | null
  stockQty: number
  providerCode: string | null
  primaryImageUrl: string | null
}

export async function getVehicleProductCategories(
  vehicleTypeId: number
): Promise<VehicleProductCategory[]> {
  const rows = await db.$queryRaw<
    Array<{
      category_id: number
      category_name: string
      category_name_tr: string | null
      url_key: string | null
      product_count: bigint
      min_price: string | null
    }>
  >(Prisma.sql`
    WITH linked_products AS (
      SELECT DISTINCT
        vp.id AS v0_product_id,
        pc.id AS category_id,
        pc.name AS category_name,
        pc.name_tr AS category_name_tr,
        pc.url_key
      FROM public.part_vehicle_types pvt
      JOIN v0.product_public_part_links l
        ON l.part_id = pvt.part_id
        AND l.status = 'APPROVED'
      JOIN v0.products vp ON vp.id = l.v0_product_id AND vp.status = 'ACTIVE'
      JOIN public.parts p ON p.id = l.part_id
      JOIN public.part_categories pc ON pc.id = p.category_id
      WHERE pvt.vehicle_type_id = ${vehicleTypeId}
    ),
    priced AS (
      SELECT
        lp.*,
        offer.price
      FROM linked_products lp
      LEFT JOIN LATERAL (
        SELECT price::numeric AS price
        FROM (
          SELECT c.price::text AS price, COALESCE(c.stock_qty, 0)::int AS stock_qty
          FROM v0.product_sources s
          JOIN v0.dnmk_products d ON d.id = s.dnmk_products_id
          LEFT JOIN v0.dnmk_cost c ON c.dnmk_products_id = d.id
          WHERE s.v0_product_id = lp.v0_product_id
            AND s.source_type = 'DNMK'
            AND d.is_passive IS DISTINCT FROM TRUE
            AND COALESCE(c.price, 0) > 0
        ) offers
        WHERE stock_qty > 0
        ORDER BY price::numeric ASC
        LIMIT 1
      ) offer ON TRUE
    )
    SELECT
      category_id,
      category_name,
      category_name_tr,
      url_key,
      COUNT(DISTINCT v0_product_id)::bigint AS product_count,
      MIN(price)::text AS min_price
    FROM priced
    GROUP BY category_id, category_name, category_name_tr, url_key
    ORDER BY product_count DESC, category_name ASC
  `)

  return rows.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryNameTr: row.category_name_tr,
    urlKey: row.url_key,
    productCount: Number(row.product_count),
    minPrice: row.min_price
  }))
}

export async function getVehicleProductsForCategory(input: {
  vehicleTypeId: number
  categoryId: number
  limit?: number
  offset?: number
}): Promise<VehicleProductListItem[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 24, 96))
  const offset = Math.max(0, input.offset ?? 0)

  const rows = await db.$queryRaw<
    Array<{
      v0_product_id: bigint
      display_name: string
      brand_name: string | null
      category_id: number
      category_name: string
      public_part_id: bigint
      price: string | null
      stock_qty: number | null
      provider_code: string | null
      primary_image_url: string | null
    }>
  >(Prisma.sql`
    WITH vehicle_products AS (
      SELECT DISTINCT ON (vp.id)
        vp.id AS v0_product_id,
        vp.display_name,
        vp.brand_name,
        vp.primary_image_url,
        p.id AS public_part_id,
        pc.id AS category_id,
        pc.name AS category_name
      FROM public.part_vehicle_types pvt
      JOIN v0.product_public_part_links l
        ON l.part_id = pvt.part_id
        AND l.status = 'APPROVED'
      JOIN v0.products vp ON vp.id = l.v0_product_id AND vp.status = 'ACTIVE'
      JOIN public.parts p ON p.id = l.part_id
      JOIN public.part_categories pc ON pc.id = p.category_id
      WHERE pvt.vehicle_type_id = ${input.vehicleTypeId}
        AND pc.id = ${input.categoryId}
      ORDER BY vp.id, l.confidence DESC
    )
    SELECT
      vp.*,
      offer.provider_code,
      offer.price,
      offer.stock_qty
    FROM vehicle_products vp
    LEFT JOIN LATERAL (
      SELECT provider_code, price, stock_qty
      FROM (
        SELECT
          'DNMK'::text AS provider_code,
          c.price::text AS price,
          COALESCE(c.stock_qty, 0)::int AS stock_qty
        FROM v0.product_sources s
        JOIN v0.dnmk_products d ON d.id = s.dnmk_products_id
        LEFT JOIN v0.dnmk_cost c ON c.dnmk_products_id = d.id
        WHERE s.v0_product_id = vp.v0_product_id
          AND s.source_type = 'DNMK'
          AND d.is_passive IS DISTINCT FROM TRUE
          AND COALESCE(c.price, 0) > 0
      ) offers
      ORDER BY
        CASE WHEN stock_qty > 0 THEN 0 ELSE 1 END,
        price::numeric ASC NULLS LAST
      LIMIT 1
    ) offer ON TRUE
    ORDER BY
      CASE WHEN COALESCE(offer.stock_qty, 0) > 0 THEN 0 ELSE 1 END,
      offer.price::numeric ASC NULLS LAST,
      vp.display_name ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `)

  return rows.map((row) => ({
    v0ProductId: row.v0_product_id.toString(),
    name: row.display_name,
    brandName: row.brand_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    publicPartId: row.public_part_id.toString(),
    price: row.price,
    stockQty: row.stock_qty ?? 0,
    providerCode: row.provider_code,
    primaryImageUrl: row.primary_image_url
  }))
}
