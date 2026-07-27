import 'server-only'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'

/**
 * Katalog zenginleştirme kapsaması: hangi ürünler public.parts'a bağlandı,
 * hangileri hâlâ boşta, ne kadarı admin onayı bekliyor.
 *
 * Kaynak: catalog.product_part_links. Zengin veri (resim/özellik/araç) katalogda
 * tutulmadığı için sayımlar public.part_* tablolarına EXISTS ile bakar.
 *
 * Sorgu biçimi kritik: ürün başına korelasyonlu EXISTS yazılırsa planlayıcı
 * 1,08M satırın her biri için ayrı index lookup çalıştırıyor (ölçüm: 16M buffer
 * hit, 11 sn). Bunun yerine link/OEM tarafı önce group by ile daraltılıp hash
 * join'e bırakılıyor — aynı sonuç, ~2 sn.
 *
 * Sonuç ayrıca önbelleklenir; bu yüzden yalnızca GET route handler'ından
 * çağrılmalı. Server action içinde Next data cache'i no-store'a zorlar ve
 * önbellek hiç tutmaz.
 */

/** revalidateTag hedefi — onay/ret sonrası sayımların bayat kalmaması için. */
export const ENRICHMENT_COVERAGE_TAG = 'admin-catalog-enrichment-coverage'

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
  const [brandRows, enrichRow, breakdown] = await Promise.all([
    // Toplamlar ve marka kırılımı TEK sorgu: ikisi de aynı iki CTE'yi (1,08M
    // ürün üzerinde link/OEM daraltması) kuruyordu, yani iş iki kez yapılıyordu.
    // `grouping sets` ile toplam satırı marka satırlarının yanında geliyor —
    // ~2 sn kazanç, ve havuzdan bir bağlantı daha az isteniyor. Sonuncusu asıl
    // mesele: dört sorgu aynı anda bağlantı isteyince, aynı istekteki auth
    // sorgusu havuzda sıraya giriyor ve connectionTimeoutMillis'e takılabiliyordu.
    db.$queryRaw<Record<string, string | bigint | null>[]>`
      with link_flags as (
        select product_id,
               bool_or(status = 'CONFIRMED') as has_confirmed,
               bool_or(status = 'CANDIDATE') as has_candidate
        from catalog.product_part_links
        group by product_id
      ), oem_products as (
        select distinct product_id from catalog.product_oems
      )
      select
        b.brand as brand,
        grouping(b.brand) as is_total,
        count(*) as active_products,
        count(*) filter (where l.has_confirmed) as confirmed_linked,
        count(*) filter (
          where not coalesce(l.has_confirmed, false) and coalesce(l.has_candidate, false)
        ) as candidate_only,
        count(*) filter (where l.product_id is null) as unlinked,
        count(*) filter (where o.product_id is not null) as with_oem
      from catalog.products p
      left join catalog.brands b on b.id = p.brand_id
      left join link_flags l on l.product_id = p.id
      left join oem_products o on o.product_id = p.id
      where p.status = 'ACTIVE'
      group by grouping sets ((b.brand), ())
      order by grouping(b.brand) desc, (count(*) - count(*) filter (where l.has_confirmed)) desc
      limit 26
    `,
    // part_* tarafında EXISTS'i link başına değil PARÇA başına çalıştırıyoruz:
    // aynı parçaya bağlı birden çok ürün varsa dev tabloları bir kez yokluyoruz.
    db.$queryRaw<Record<string, bigint>[]>`
      with confirmed_parts as (
        select distinct part_id from catalog.product_part_links where status = 'CONFIRMED'
      ), part_flags as (
        select part_id,
          exists (select 1 from part_images i where i.part_id = cp.part_id) as has_image,
          exists (select 1 from part_properties pp where pp.part_id = cp.part_id) as has_property,
          exists (select 1 from part_vehicle_types v where v.part_id = cp.part_id) as has_vehicle,
          exists (select 1 from part_eans e where e.part_id = cp.part_id) as has_ean
        from confirmed_parts cp
      )
      select
        count(distinct l.product_id) filter (where f.has_image) as with_images,
        count(distinct l.product_id) filter (where f.has_property) as with_properties,
        count(distinct l.product_id) filter (where f.has_vehicle) as with_vehicles,
        count(distinct l.product_id) filter (where f.has_ean) as with_eans
      from catalog.product_part_links l
      join part_flags f on f.part_id = l.part_id
      where l.status = 'CONFIRMED'
    `,
    db.$queryRaw<{ status: string; match_method: string; links: bigint; products: bigint }[]>`
      select status, match_method, count(*) as links, count(distinct product_id) as products
      from catalog.product_part_links
      group by 1, 2
      order by 3 desc
    `,
  ])

  // `is_total = 1` satırı grouping sets'in toplam satırı; kalanlar marka kırılımı.
  const t = brandRows.find((r) => num(r.is_total) === 1) ?? {}
  const e = enrichRow[0] ?? {}
  const brands = brandRows.filter((r) => num(r.is_total) === 0)

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
      brand: String(r.brand ?? '—'),
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
  [ENRICHMENT_COVERAGE_TAG],
  { revalidate: 300, tags: [ENRICHMENT_COVERAGE_TAG] }
)

/**
 * @param fresh Önbelleği atlar — "Yenile" düğmesi bunu kullanır, aksi hâlde
 *   düğme 5 dakika boyunca aynı sayıları geri verirdi.
 */
export async function getCatalogEnrichmentCoverage(
  options?: { fresh?: boolean }
): Promise<CatalogEnrichmentCoverage> {
  return options?.fresh
    ? loadCatalogEnrichmentCoverage()
    : getCachedCatalogEnrichmentCoverage()
}
