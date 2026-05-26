import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import type { V0BrandMatchRow } from '@/lib/v0/types'

type DbrandsMatchQueryRow = {
  id: number
  dbrands_ids: bigint[] | null
  ptbrands_id: number | null
  brand_name: string
  pt_url_key: string | null
  logo_url: string | null
}

function mapRow(row: DbrandsMatchQueryRow): V0BrandMatchRow {
  const dbrandsIds = (row.dbrands_ids ?? []).map((id) => id.toString())

  return {
    matchId: row.id,
    dbrandsId: dbrandsIds[0] ?? null,
    dbrandsIds,
    ptbrandsId: row.ptbrands_id,
    brandName: row.brand_name,
    ptUrlKey: row.pt_url_key,
    logoUrl: row.logo_url
  }
}

const APPROVED_BRANDS_GROUPED = Prisma.sql`
  WITH approved AS (
    SELECT
      a.id,
      a.dbrands_id,
      a.ptbrands_id,
      a.normalized,
      a.logo_url,
      d.brand AS dinamik_brand,
      m.name AS ptbrand_name,
      m.url_key AS pt_url_key
    FROM v0.dbrands_match a
    LEFT JOIN v0.dbrands d ON d.id = a.dbrands_id
    LEFT JOIN v0.ptbrands m ON m.id = a.ptbrands_id
    WHERE a.mapping_status = 'APPROVED'
      AND BTRIM(COALESCE(a.normalized, d.brand, m.name, '')) <> ''
  ),
  with_key AS (
    SELECT
      *,
      COALESCE(
        NULLIF(BTRIM(normalized), ''),
        CASE WHEN ptbrands_id IS NOT NULL THEN 'pt:' || ptbrands_id::text END,
        CASE WHEN dbrands_id IS NOT NULL THEN 'db:' || dbrands_id::text END,
        'id:' || id::text
      ) AS group_key
    FROM approved
  ),
  grouped AS (
    SELECT
      MIN(id) AS id,
      ARRAY_AGG(DISTINCT dbrands_id) FILTER (WHERE dbrands_id IS NOT NULL) AS dbrands_ids,
      MIN(ptbrands_id) AS ptbrands_id,
      COALESCE(
        MAX(ptbrand_name) FILTER (WHERE ptbrand_name IS NOT NULL),
        MAX(NULLIF(BTRIM(normalized), '')),
        MIN(dinamik_brand) FILTER (WHERE dinamik_brand IS NOT NULL)
      ) AS brand_name,
      MAX(pt_url_key) AS pt_url_key,
      MAX(logo_url) FILTER (WHERE logo_url IS NOT NULL) AS logo_url
    FROM with_key
    GROUP BY group_key
  )
  SELECT
    g.id,
    g.dbrands_ids,
    g.ptbrands_id,
    g.brand_name,
    g.pt_url_key,
    g.logo_url
  FROM grouped g
`

async function fetchApprovedDbrandsMatch(limit?: number): Promise<V0BrandMatchRow[]> {
  const rows = await db.$queryRaw<DbrandsMatchQueryRow[]>(
    limit
      ? Prisma.sql`
          ${APPROVED_BRANDS_GROUPED}
          ORDER BY g.brand_name ASC
          LIMIT ${limit}
        `
      : Prisma.sql`
          ${APPROVED_BRANDS_GROUPED}
          ORDER BY g.brand_name ASC
        `
  )

  return rows.map(mapRow)
}

export async function getApprovedDbrandsMatch(limit?: number): Promise<V0BrandMatchRow[]> {
  return unstable_cache(
    () => fetchApprovedDbrandsMatch(limit),
    ['v0-home-dbrands-match-grouped', limit != null ? String(limit) : 'all'],
    { revalidate: 300 }
  )()
}

async function fetchDbrandsMatchById(matchId: number): Promise<V0BrandMatchRow | null> {
  const rows = await db.$queryRaw<DbrandsMatchQueryRow[]>(Prisma.sql`
    WITH approved AS (
      SELECT
        a.id,
        a.dbrands_id,
        a.ptbrands_id,
        a.normalized,
        a.logo_url,
        d.brand AS dinamik_brand,
        m.name AS ptbrand_name,
        m.url_key AS pt_url_key
      FROM v0.dbrands_match a
      LEFT JOIN v0.dbrands d ON d.id = a.dbrands_id
      LEFT JOIN v0.ptbrands m ON m.id = a.ptbrands_id
      WHERE a.mapping_status = 'APPROVED'
        AND BTRIM(COALESCE(a.normalized, d.brand, m.name, '')) <> ''
    ),
    with_key AS (
      SELECT
        *,
        COALESCE(
          NULLIF(BTRIM(normalized), ''),
          CASE WHEN ptbrands_id IS NOT NULL THEN 'pt:' || ptbrands_id::text END,
          CASE WHEN dbrands_id IS NOT NULL THEN 'db:' || dbrands_id::text END,
          'id:' || id::text
        ) AS group_key
      FROM approved
    ),
    target AS (
      SELECT group_key
      FROM with_key
      WHERE id = ${matchId}
      LIMIT 1
    ),
    grouped AS (
      SELECT
        MIN(id) AS id,
        ARRAY_AGG(DISTINCT dbrands_id) FILTER (WHERE dbrands_id IS NOT NULL) AS dbrands_ids,
        MIN(ptbrands_id) AS ptbrands_id,
        COALESCE(
          MAX(ptbrand_name) FILTER (WHERE ptbrand_name IS NOT NULL),
          MAX(NULLIF(BTRIM(normalized), '')),
          MIN(dinamik_brand) FILTER (WHERE dinamik_brand IS NOT NULL)
        ) AS brand_name,
        MAX(pt_url_key) AS pt_url_key,
        MAX(logo_url) FILTER (WHERE logo_url IS NOT NULL) AS logo_url
      FROM with_key w
      WHERE w.group_key = (SELECT group_key FROM target)
      GROUP BY w.group_key
    )
    SELECT
      g.id,
      g.dbrands_ids,
      g.ptbrands_id,
      g.brand_name,
      g.pt_url_key,
      g.logo_url
    FROM grouped g
    LIMIT 1
  `)

  const row = rows[0]
  return row ? mapRow(row) : null
}

export async function getDbrandsMatchById(matchId: number): Promise<V0BrandMatchRow | null> {
  return unstable_cache(
    () => fetchDbrandsMatchById(matchId),
    ['v0-dbrands-match-by-id-grouped', String(matchId)],
    { revalidate: 300 }
  )()
}
