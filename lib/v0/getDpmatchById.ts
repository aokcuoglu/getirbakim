import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import { dproductBrandNameExpr } from '@/lib/sql/dnprd-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr,
  dproductDetailsStockExpr
} from '@/lib/sql/dnprd-details'
import { dnbrdMatchLogoExpr } from '@/lib/v0/dnbrdMatchLogoSql'
import type { V0DpmatchProductRow } from '@/lib/v0/types'

type DpmatchQueryRow = {
  id: number
  dnmk_products_id: bigint | null
  ptdrk_products_id: number | null
  mapping_status: string
  match_method: string | null
  normalized_name: string | null
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
    dnprdId: row.dnmk_products_id?.toString() ?? null,
    ptprdId: row.ptdrk_products_id,
    mappingStatus: row.mapping_status,
    matchMethod: row.match_method,
    normalized_name: row.normalized_name,
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

async function fetchDpmatchById(matchId: number): Promise<V0DpmatchProductRow | null> {
  const rows = await db.$queryRaw<DpmatchQueryRow[]>(Prisma.sql`
    SELECT
      m.id,
      m.dnmk_products_id,
      m.ptdrk_products_id,
      m.mapping_status,
      m.match_method,
      m.normalized_name,
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
      p.product_model AS model,
      p.ref_no,
      p.price_list::text AS pt_price,
      COALESCE(d.image_url, o.raw->>'resimUrl') AS image_url,
      p.url,
      mfr.name AS manufacturer_name,
      ${dnbrdMatchLogoExpr} AS brand_logo_url
    FROM v0.dnmk_ptdrk_products m
    INNER JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
    LEFT JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id
    ${dproductDetailsJoin}
    LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
    LEFT JOIN v0.ptdrk_brands mfr ON mfr.id = p.ptdrk_brands_id
    WHERE m.id = ${matchId}
      AND m.mapping_status = 'APPROVED'
      AND d.is_passive IS DISTINCT FROM TRUE
    LIMIT 1
  `)

  const row = rows[0]
  return row ? mapRow(row) : null
}

export async function getDpmatchById(matchId: number): Promise<V0DpmatchProductRow | null> {
  return unstable_cache(
    () => fetchDpmatchById(matchId),
    ['v0-dpprd-by-id', String(matchId)],
    { revalidate: 300 }
  )()
}
