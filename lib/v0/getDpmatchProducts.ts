import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import { dproductBrandNameExpr } from '@/lib/sql/dproduct-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr,
  dproductDetailsStockExpr
} from '@/lib/sql/dproduct-details'
import { dbrandsMatchLogoExpr } from '@/lib/v0/dbrandsMatchLogoSql'
import type { V0DpmatchProductRow } from '@/lib/v0/types'

const DEFAULT_LIMIT = 24

type DpmatchQueryRow = {
  id: number
  dproducts_id: bigint | null
  ptproducts_id: number | null
  mapping_status: string
  match_method: string | null
  normalized: string | null
  stock_code: string | null
  stock_name: string | null
  brand: string | null
  part_no: string | null
  barcode_1: string | null
  barcode_2: string | null
  barcode_3: string | null
  dinamik_price: string | null
  dinamik_stock_qty: number | null
  title: string | null
  model: string | null
  ref_no: string | null
  pt_price: string | null
  image_url: string | null
  url: string | null
  manufacturer_name: string | null
  brand_logo_url: string | null
}

function mapRow(row: DpmatchQueryRow): V0DpmatchProductRow {
  return {
    matchId: row.id,
    dproductsId: row.dproducts_id?.toString() ?? null,
    ptproductsId: row.ptproducts_id,
    mappingStatus: row.mapping_status,
    matchMethod: row.match_method,
    normalized: row.normalized,
    dinamikStockCode: row.stock_code,
    dinamikStockName: row.stock_name,
    dinamikBrand: row.brand,
    dinamikPartNo: row.part_no,
    dinamikBarcode1: row.barcode_1,
    dinamikBarcode2: row.barcode_2,
    dinamikBarcode3: row.barcode_3,
    dinamikPrice: row.dinamik_price,
    dinamikStockQty: row.dinamik_stock_qty,
    ptTitle: row.title,
    ptModel: row.model,
    ptRefNo: row.ref_no,
    ptPrice: row.pt_price,
    ptImageUrl: row.image_url,
    ptUrl: row.url,
    ptManufacturerName: row.manufacturer_name,
    brandLogoUrl: row.brand_logo_url
  }
}

async function fetchApprovedDpmatchProducts(limit = DEFAULT_LIMIT): Promise<V0DpmatchProductRow[]> {
  const rows = await db.$queryRaw<DpmatchQueryRow[]>(Prisma.sql`
    SELECT
      m.id,
      m.dproducts_id,
      m.ptproducts_id,
      m.mapping_status,
      m.match_method,
      m.normalized,
      d.stock_code,
      d.stock_name,
      ${dproductBrandNameExpr} AS brand,
      d.part_no,
      d.barcode_1,
      d.barcode_2,
      d.barcode_3,
      ${dproductDetailsPriceExpr}::text AS dinamik_price,
      ${dproductDetailsStockExpr} AS dinamik_stock_qty,
      p.title,
      p.model,
      p.ref_no,
      p.price::text AS pt_price,
      p.image_url,
      p.url,
      mfr.name AS manufacturer_name,
      ${dbrandsMatchLogoExpr} AS brand_logo_url
    FROM v0.dpmatch m
    INNER JOIN v0.dproducts d ON d.id = m.dproducts_id
    LEFT JOIN v0.dbrands db ON db.id = d.dbrands_id
    ${dproductDetailsJoin}
    LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
    LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
    WHERE m.mapping_status = 'APPROVED'
      AND d.is_passive IS DISTINCT FROM TRUE
    ORDER BY m.id DESC
    LIMIT ${limit}
  `)

  return rows.map(mapRow)
}

export async function getDpmatchProducts(limit = DEFAULT_LIMIT): Promise<V0DpmatchProductRow[]> {
  return unstable_cache(
    () => fetchApprovedDpmatchProducts(limit),
    ['v0-home-dpmatch-products', String(limit)],
    { revalidate: 300 }
  )()
}
