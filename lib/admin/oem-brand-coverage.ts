import 'server-only'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'

/**
 * Marka bazında OEM kaynak kapsamı.
 *
 * Ayrım işin bölünmesini belirler: kapsanan markalar scraper'a bırakılır,
 * KAPSANMAYANLARIN OEM'i elle araştırılmalı. Sıralama OEM'siz ürün sayısına
 * göre — en çok emek isteyen marka en üstte.
 *
 * Kapsam sayımıyla aynı tuzak: OEM yokluğu ürün başına NOT EXISTS ile
 * sorulursa 1,08M satır tek tek yoklanıyor (~9 sn). Ön-toplanmış küme + hash
 * join ~1,7 sn. Sonuç önbelleklenir; yalnızca GET route handler'ından
 * çağrılmalı — server action içinde Next önbelleği no-store'a zorlar.
 */

/** revalidateTag hedefi — öneri onayı/reddi sonrası sayımlar tazelensin. */
export const OEM_BRAND_COVERAGE_TAG = 'admin-oem-brand-coverage'

export interface OemCoverageBrandRow {
  brandId: number
  brand: string
  /** Markayı kapsayan kaynak; null = kapsayan kaynak yok, elle araştırılmalı. */
  sourceSite: string | null
  /** Kapsam nereden biliniyor: 'archive' | 'search' | 'builtin'. */
  resolvedBy: string | null
  products: number
  /** OEM'i olmayan ürün sayısı — elle iş yükünün ölçüsü. */
  missingOem: number
  /** Bu markada web kaynağından gelmiş, bekleyen öneri sayısı. */
  pendingSuggestions: number
}

async function loadOemBrandCoverage(): Promise<OemCoverageBrandRow[]> {
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    with oem_products as (
      select distinct product_id
      from catalog.product_oems
      where source <> 'PART_NO'
    ), brand_totals as (
      select p.brand_id,
             count(*) as products,
             count(*) filter (where o.product_id is null) as missing_oem
      from catalog.products p
      left join oem_products o on o.product_id = p.id
      where p.status = 'ACTIVE'
      group by p.brand_id
    ), brand_pending as (
      select sp.brand_id, count(*) as pending_suggestions
      from catalog.product_ref_suggestions s
      join catalog.products sp on sp.id = s.product_id
      where s.status = 'PENDING'
      group by sp.brand_id
    )
    select b.id, b.brand, c.source_site, c.resolved_by,
           t.products, t.missing_oem,
           coalesce(pnd.pending_suggestions, 0) as pending_suggestions
    from brand_totals t
    join catalog.brands b on b.id = t.brand_id
    left join catalog.oem_brand_coverage c on c.brand_id = b.id
    left join brand_pending pnd on pnd.brand_id = b.id
    order by t.missing_oem desc, b.brand
  `

  return rows.map((r) => ({
    brandId: Number(r.id),
    brand: String(r.brand ?? ''),
    sourceSite: r.source_site ? String(r.source_site) : null,
    resolvedBy: r.resolved_by ? String(r.resolved_by) : null,
    products: Number(r.products ?? 0),
    missingOem: Number(r.missing_oem ?? 0),
    pendingSuggestions: Number(r.pending_suggestions ?? 0)
  }))
}

const getCachedOemBrandCoverage = unstable_cache(
  loadOemBrandCoverage,
  [OEM_BRAND_COVERAGE_TAG],
  { revalidate: 300, tags: [OEM_BRAND_COVERAGE_TAG] }
)

/** @param fresh Önbelleği atlar — panelin "Yenile" düğmesi bunu kullanır. */
export async function getOemBrandCoverageRows(
  options?: { fresh?: boolean }
): Promise<OemCoverageBrandRow[]> {
  return options?.fresh ? loadOemBrandCoverage() : getCachedOemBrandCoverage()
}
