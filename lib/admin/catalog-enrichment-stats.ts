import 'server-only'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'

/**
 * Katalog zenginleştirme kapsaması: hangi ürünler public.parts'a bağlandı,
 * hangileri hâlâ boşta, ne kadarı admin onayı bekliyor.
 *
 * Kaynak: catalog.product_part_links. Zengin veri (resim/özellik/araç) katalogda
 * tutulmadığı için sayımlar public.part_* tablolarına EXISTS ile bakar — bu
 * sorgu ~8sn sürer, o yüzden sonuç önbelleklenir.
 */

export interface EnrichmentTotals
  extends Record<
    'activeProducts' | 'confirmedLinked' | 'candidateOnly' | 'unlinked' | 'withOem',
    number
  > {
  withImages: number
  withProperties: number
  withVehicles: number
  withEans: number
}

export interface EnrichmentLinkBreakdown {
  status: string
  matchMethod: string
  links: number
  products: number
}

export interface EnrichmentBrandRow {
  brand: string
  activeProducts: number
  confirmedLinked: number
  candidateOnly: number
  withOem: number
}

export interface CatalogEnrichmentCoverage {
  totals: EnrichmentTotals
  linkBreakdown: EnrichmentLinkBreakdown[]
  /** En çok boşluğu olan markalar (bağlanmamış ürün sayısına göre). */
  topGapBrands: EnrichmentBrandRow[]
  generatedAt: string
}

const num = (v: unknown): number => Number(v ?? 0)

async function loadCatalogEnrichmentCoverage(): Promise<CatalogEnrichmentCoverage> {
  const [totalsRow, enrichRow, breakdown, brands] = await Promise.all([
    db.$queryRaw<Record<string, bigint>[]>`
      select
        count(*) filter (where p.status = 'ACTIVE') as active_products,
        count(*) filter (
          where p.status = 'ACTIVE'
            and exists (select 1 from catalog.product_part_links l
                        where l.product_id = p.id and l.status = 'CONFIRMED')
        ) as confirmed_linked,
        count(*) filter (
          where p.status = 'ACTIVE'
            and not exists (select 1 from catalog.product_part_links l
                            where l.product_id = p.id and l.status = 'CONFIRMED')
            and exists (select 1 from catalog.product_part_links l
                        where l.product_id = p.id and l.status = 'CANDIDATE')
        ) as candidate_only,
        count(*) filter (
          where p.status = 'ACTIVE'
            and not exists (select 1 from catalog.product_part_links l where l.product_id = p.id)
        ) as unlinked,
        count(*) filter (
          where p.status = 'ACTIVE'
            and exists (select 1 from catalog.product_oems o where o.product_id = p.id)
        ) as with_oem
      from catalog.products p
    `,
    db.$queryRaw<Record<string, bigint>[]>`
      select
        count(distinct l.product_id) filter (
          where exists (select 1 from part_images i where i.part_id = l.part_id)) as with_images,
        count(distinct l.product_id) filter (
          where exists (select 1 from part_properties pp where pp.part_id = l.part_id)) as with_properties,
        count(distinct l.product_id) filter (
          where exists (select 1 from part_vehicle_types v where v.part_id = l.part_id)) as with_vehicles,
        count(distinct l.product_id) filter (
          where exists (select 1 from part_eans e where e.part_id = l.part_id)) as with_eans
      from catalog.product_part_links l
      where l.status = 'CONFIRMED'
    `,
    db.$queryRaw<{ status: string; match_method: string; links: bigint; products: bigint }[]>`
      select status, match_method, count(*) as links, count(distinct product_id) as products
      from catalog.product_part_links
      group by 1, 2
      order by 3 desc
    `,
    db.$queryRaw<Record<string, string | bigint>[]>`
      select b.brand,
        count(*) as active_products,
        count(*) filter (where exists (select 1 from catalog.product_part_links l
                                       where l.product_id = p.id and l.status = 'CONFIRMED')) as confirmed_linked,
        count(*) filter (where not exists (select 1 from catalog.product_part_links l
                                           where l.product_id = p.id and l.status = 'CONFIRMED')
                           and exists (select 1 from catalog.product_part_links l
                                       where l.product_id = p.id and l.status = 'CANDIDATE')) as candidate_only,
        count(*) filter (where exists (select 1 from catalog.product_oems o
                                       where o.product_id = p.id)) as with_oem
      from catalog.products p
      join catalog.brands b on b.id = p.brand_id
      where p.status = 'ACTIVE'
      group by b.brand
      order by (count(*) - count(*) filter (where exists (
        select 1 from catalog.product_part_links l
        where l.product_id = p.id and l.status = 'CONFIRMED'))) desc
      limit 25
    `,
  ])

  const t = totalsRow[0] ?? {}
  const e = enrichRow[0] ?? {}

  return {
    totals: {
      activeProducts: num(t.active_products),
      confirmedLinked: num(t.confirmed_linked),
      candidateOnly: num(t.candidate_only),
      unlinked: num(t.unlinked),
      withOem: num(t.with_oem),
      withImages: num(e.with_images),
      withProperties: num(e.with_properties),
      withVehicles: num(e.with_vehicles),
      withEans: num(e.with_eans),
    },
    linkBreakdown: breakdown.map((r) => ({
      status: r.status,
      matchMethod: r.match_method,
      links: num(r.links),
      products: num(r.products),
    })),
    topGapBrands: brands.map((r) => ({
      brand: String(r.brand),
      activeProducts: num(r.active_products),
      confirmedLinked: num(r.confirmed_linked),
      candidateOnly: num(r.candidate_only),
      withOem: num(r.with_oem),
    })),
    generatedAt: new Date().toISOString(),
  }
}

const getCachedCatalogEnrichmentCoverage = unstable_cache(
  loadCatalogEnrichmentCoverage,
  ['admin-catalog-enrichment-coverage'],
  { revalidate: 300 }
)

export async function getCatalogEnrichmentCoverage(): Promise<CatalogEnrichmentCoverage> {
  return getCachedCatalogEnrichmentCoverage()
}
