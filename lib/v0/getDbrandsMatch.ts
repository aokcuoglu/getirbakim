import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import {
  V0_APPROVED_BRANDS_CACHE_TAG,
  V0_APPROVED_BRANDS_REVALIDATE
} from '@/lib/v0/brandCache'
import { toBrandSlug } from '@/lib/v0/brandSlug'
import type { V0BrandMatchRow } from '@/lib/v0/types'

const approvedBrandsCacheOptions = {
  revalidate: V0_APPROVED_BRANDS_REVALIDATE,
  tags: [V0_APPROVED_BRANDS_CACHE_TAG]
}

type DbrandsMatchQueryRow = {
  id: number
  dbrands_ids: bigint[] | null
  ptdrk_brands_id: number | null
  brand_name: string
  pt_url_key: string | null
  logo_url: string | null
}

function mapRow(row: DbrandsMatchQueryRow): V0BrandMatchRow {
  const dnbrdIds = (row.dbrands_ids ?? []).map((id) => id.toString())

  return {
    matchId: row.id,
    dnbrdId: dnbrdIds[0] ?? null,
    dnbrdIds,
    ptbrdId: row.ptdrk_brands_id,
    brandName: row.brand_name,
    ptUrlKey: row.pt_url_key,
    logoUrl: row.logo_url,
    slug: toBrandSlug(row.pt_url_key, row.brand_name)
  }
}

const APPROVED_BRANDS_GROUPED = Prisma.sql`
  WITH approved AS (
    SELECT
      m.id,
      m.dnmk_brands_id,
      m.ptdrk_brands_id,
      cb.normalized_brand,
      cb.logo_url,
      d.brand AS dinamik_brand,
      pt.name AS ptbrand_name,
      pt.url_key AS pt_url_key
    FROM v0.dnmk_ptdrk_brand_mappings m
    JOIN v0.dnmk_ptdrk_brands cb ON cb.id = m.dnmk_ptdrk_brands_id
    LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
    LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
    WHERE m.mapping_status = 'APPROVED'
      AND BTRIM(COALESCE(cb.normalized_brand, d.brand, pt.name, '')) <> ''
  ),
  with_key AS (
    SELECT
      *,
      COALESCE(
        NULLIF(BTRIM(normalized_brand), ''),
        CASE WHEN ptdrk_brands_id IS NOT NULL THEN 'pt:' || ptdrk_brands_id::text END,
        CASE WHEN dnmk_brands_id IS NOT NULL THEN 'db:' || dnmk_brands_id::text END,
        'id:' || id::text
      ) AS group_key
    FROM approved
  ),
  grouped AS (
    SELECT
      MIN(id) AS id,
      ARRAY_AGG(DISTINCT dnmk_brands_id) FILTER (WHERE dnmk_brands_id IS NOT NULL) AS dbrands_ids,
      MIN(ptdrk_brands_id) AS ptdrk_brands_id,
      COALESCE(
        MAX(ptbrand_name) FILTER (WHERE ptbrand_name IS NOT NULL),
        MAX(NULLIF(BTRIM(normalized_brand), '')),
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
    g.ptdrk_brands_id,
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
    ['v0-home-dnbrd-match-grouped', limit != null ? String(limit) : 'all'],
    approvedBrandsCacheOptions
  )()
}

async function fetchDbrandsMatchById(matchId: number): Promise<V0BrandMatchRow | null> {
  const rows = await db.$queryRaw<DbrandsMatchQueryRow[]>(Prisma.sql`
    WITH approved AS (
      SELECT
        m.id,
        m.dnmk_brands_id,
        m.ptdrk_brands_id,
        cb.normalized_brand,
        cb.logo_url,
        d.brand AS dinamik_brand,
        pt.name AS ptbrand_name,
        pt.url_key AS pt_url_key
      FROM v0.dnmk_ptdrk_brand_mappings m
      JOIN v0.dnmk_ptdrk_brands cb ON cb.id = m.dnmk_ptdrk_brands_id
      LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
      LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
      WHERE m.mapping_status = 'APPROVED'
        AND BTRIM(COALESCE(cb.normalized_brand, d.brand, pt.name, '')) <> ''
    ),
    with_key AS (
      SELECT
        *,
        COALESCE(
          NULLIF(BTRIM(normalized_brand), ''),
          CASE WHEN ptdrk_brands_id IS NOT NULL THEN 'pt:' || ptdrk_brands_id::text END,
          CASE WHEN dnmk_brands_id IS NOT NULL THEN 'db:' || dnmk_brands_id::text END,
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
        ARRAY_AGG(DISTINCT dnmk_brands_id) FILTER (WHERE dnmk_brands_id IS NOT NULL) AS dbrands_ids,
        MIN(ptdrk_brands_id) AS ptdrk_brands_id,
        COALESCE(
          MAX(ptbrand_name) FILTER (WHERE ptbrand_name IS NOT NULL),
          MAX(NULLIF(BTRIM(normalized_brand), '')),
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
      g.ptdrk_brands_id,
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
    ['v0-dnbrd-match-by-id-grouped', String(matchId)],
    approvedBrandsCacheOptions
  )()
}

async function fetchDbrandsMatchBySlug(slug: string): Promise<V0BrandMatchRow | null> {
  const normalizedSlug = slug.trim().toLowerCase()
  if (!normalizedSlug) return null

  const brands = await fetchApprovedDbrandsMatch()
  return brands.find((brand) => brand.slug === normalizedSlug) ?? null
}

export async function getDbrandsMatchBySlug(slug: string): Promise<V0BrandMatchRow | null> {
  return unstable_cache(
    () => fetchDbrandsMatchBySlug(slug),
    ['v0-dnbrd-match-by-slug', slug.trim().toLowerCase()],
    approvedBrandsCacheOptions
  )()
}
