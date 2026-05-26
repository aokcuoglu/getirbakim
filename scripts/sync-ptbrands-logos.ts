/**
 * Scrape manufacturer logos from parcatedarik.com/manufacturer/all
 * and update v0.ptbrands.logo_url (matched by url_key, then name).
 *
 * Usage:
 *   bun scripts/sync-ptbrands-logos.ts              # dry run (default)
 *   APPLY=true bun scripts/sync-ptbrands-logos.ts   # write to DB
 *
 * Optional:
 *   SKIP_MIGRATION=true  Skip ADD COLUMN migration (column already exists)
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

const BASE_URL = 'https://parcatedarik.com'
const MANUFACTURERS_URL = `${BASE_URL}/manufacturer/all`
const DRY_RUN = process.env.APPLY !== 'true'
const SKIP_MIGRATION = process.env.SKIP_MIGRATION === 'true'

const MANUFACTURER_ITEM_RE =
  /class=manufacturer-item[\s\S]*?<h2\s+class=title><a\s+href=\/?([^"\s>]+)[^>]*>[\s\S]*?<\/a><\/h2>[\s\S]*?data-lazyloadsrc=([^\s>]+)/gi

type ScrapedBrand = {
  urlKey: string
  logoUrl: string
}

type PtBrandRow = {
  id: number
  name: string
  url_key: string | null
  logo_url: string | null
}

function normalizeUrlKey(href: string): string {
  return href.replace(/^\/+/, '').trim().toLowerCase()
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('tr-TR')
}

function parseManufacturers(html: string): ScrapedBrand[] {
  const brands: ScrapedBrand[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(MANUFACTURER_ITEM_RE)) {
    const urlKey = normalizeUrlKey(match[1])
    const logoUrl = match[2].trim()
    if (!urlKey || !logoUrl || seen.has(urlKey)) continue
    seen.add(urlKey)
    brands.push({ urlKey, logoUrl })
  }

  return brands
}

async function applyMigration() {
  if (SKIP_MIGRATION) {
    console.log('[sync-ptbrands-logos] Skipping migration (SKIP_MIGRATION=true)')
    return
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const migrationPath = join(
    scriptDir,
    '../prisma/migrations/20260526140000_ptbrands_logo_url/migration.sql'
  )
  const sql = readFileSync(migrationPath, 'utf8')
  await db.$executeRawUnsafe(sql)
  console.log('[sync-ptbrands-logos] Applied migration:', migrationPath)
}

async function fetchManufacturerPage(): Promise<string> {
  const response = await fetch(MANUFACTURERS_URL, {
    headers: {
      'User-Agent': 'getirbakimv2-sync-ptbrands-logos/1.0',
      Accept: 'text/html'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${MANUFACTURERS_URL}: HTTP ${response.status}`)
  }

  return response.text()
}

async function main() {
  console.log(`[sync-ptbrands-logos] Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`)

  await applyMigration()

  const html = await fetchManufacturerPage()
  const scraped = parseManufacturers(html)
  console.log(`[sync-ptbrands-logos] Scraped ${scraped.length} brands with logos from site`)

  if (scraped.length === 0) {
    throw new Error('No brands parsed from manufacturer page — HTML structure may have changed')
  }

  const ptbrands = await db.$queryRaw<PtBrandRow[]>(Prisma.sql`
    SELECT id, name, url_key, logo_url
    FROM v0.ptbrands
    ORDER BY id
  `)

  const byUrlKey = new Map<string, PtBrandRow>()
  const byName = new Map<string, PtBrandRow[]>()

  for (const row of ptbrands) {
    if (row.url_key) {
      byUrlKey.set(normalizeUrlKey(row.url_key), row)
    }
    const nameKey = normalizeName(row.name)
    const existing = byName.get(nameKey) ?? []
    existing.push(row)
    byName.set(nameKey, existing)
  }

  const scrapedByUrlKey = new Map(scraped.map((b) => [b.urlKey, b]))
  const matchedPtBrandIds = new Set<number>()
  const updates: Array<{ id: number; name: string; urlKey: string; logoUrl: string }> = []
  const unmatchedScraped: ScrapedBrand[] = []

  for (const brand of scraped) {
    const row = byUrlKey.get(brand.urlKey)
    if (!row) {
      unmatchedScraped.push(brand)
      continue
    }

    matchedPtBrandIds.add(row.id)
    if (row.logo_url === brand.logoUrl) continue

    updates.push({
      id: row.id,
      name: row.name,
      urlKey: brand.urlKey,
      logoUrl: brand.logoUrl
    })
  }

  const ptbrandsWithoutLogo = ptbrands.filter((row) => !matchedPtBrandIds.has(row.id))

  console.log(`[sync-ptbrands-logos] ptbrands in DB: ${ptbrands.length}`)
  console.log(`[sync-ptbrands-logos] Matched by url_key: ${matchedPtBrandIds.size}`)
  console.log(`[sync-ptbrands-logos] Updates needed: ${updates.length}`)
  console.log(`[sync-ptbrands-logos] Unmatched scraped brands: ${unmatchedScraped.length}`)
  console.log(`[sync-ptbrands-logos] ptbrands without scraped logo: ${ptbrandsWithoutLogo.length}`)

  if (unmatchedScraped.length > 0) {
    console.log('\nUnmatched scraped brands (first 20):')
    for (const brand of unmatchedScraped.slice(0, 20)) {
      console.log(`  - ${brand.urlKey} -> ${brand.logoUrl}`)
    }
    if (unmatchedScraped.length > 20) {
      console.log(`  ... and ${unmatchedScraped.length - 20} more`)
    }
  }

  if (ptbrandsWithoutLogo.length > 0 && ptbrandsWithoutLogo.length <= 20) {
    console.log('\nptbrands without scraped logo:')
    for (const row of ptbrandsWithoutLogo) {
      console.log(`  - id=${row.id} name=${row.name} url_key=${row.url_key ?? 'null'}`)
    }
  } else if (ptbrandsWithoutLogo.length > 20) {
    console.log('\nptbrands without scraped logo (first 20):')
    for (const row of ptbrandsWithoutLogo.slice(0, 20)) {
      console.log(`  - id=${row.id} name=${row.name} url_key=${row.url_key ?? 'null'}`)
    }
    console.log(`  ... and ${ptbrandsWithoutLogo.length - 20} more`)
  }

  if (updates.length === 0) {
    console.log('[sync-ptbrands-logos] Nothing to update.')
    return
  }

  if (DRY_RUN) {
    console.log('\nSample updates (first 10):')
    for (const update of updates.slice(0, 10)) {
      console.log(`  - id=${update.id} ${update.name} (${update.urlKey}) -> ${update.logoUrl}`)
    }
    console.log('\nRe-run with APPLY=true to persist changes.')
    return
  }

  const BATCH_SIZE = 50
  let applied = 0

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE)
    const values = Prisma.join(
      batch.map(
        (update) => Prisma.sql`(${update.id}, ${update.logoUrl})`
      )
    )

    await db.$executeRaw(Prisma.sql`
      UPDATE v0.ptbrands AS p
      SET logo_url = v.logo_url, updated_at = NOW()
      FROM (VALUES ${values}) AS v(id, logo_url)
      WHERE p.id = v.id::int
    `)

    applied += batch.length
  }

  console.log(`[sync-ptbrands-logos] Updated ${applied} ptbrands rows`)
}

main()
  .catch((err) => {
    console.error('[sync-ptbrands-logos] Failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
