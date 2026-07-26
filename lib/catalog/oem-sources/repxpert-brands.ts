/**
 * Katalog markası → TecDoc marka id'si haritası (REPXPERT ürün kodu için).
 *
 * Ana kaynak yerel TecDoc arşivi: `public.part_brands.id` TecDoc tedarikçi
 * numarasının kendisidir ve sitenin ürün kodundaki değerle birebir tutar —
 * FEBI 101, VALEO 21, DELPHI 89, KAWE 286, LPR 197 örnekleri sitenin ürettiği
 * kodlardan doğrulandı. Arşiv 140 marka içerdiği için katalogdaki 633 markanın
 * yalnız bir bölümünü kapsar.
 *
 * Arşivde olmayan markalar `.data/repxpert/brand-ids.json` dosyasından gelir:
 * bunlar sitenin arama ucundan öğrenilip (ya da elle) eklenir. Dosya ARŞİVİ
 * EZER — arşiv donmuş bir kesittir, elle doğrulanmış değer ondan üstündür.
 */
import { readFile } from 'node:fs/promises'
import { db } from '../../db'

export const BRAND_ID_OVERRIDES_PATH = '.data/repxpert/brand-ids.json'

export interface BrandIdMap {
  brandIds: Record<string, number>
  fromArchive: number
  fromOverrides: number
}

/** Marka adlarını karşılaştırmak için: harf/rakam dışı her şey atılır. */
function key(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function loadOverrides(path: string): Promise<Record<string, number>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [brand, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
        out[brand.trim().toUpperCase()] = id
      }
    }
    return out
  } catch {
    // Dosya yoksa sorun değil: arşivle başlanır.
    return {}
  }
}

export async function loadRepxpertBrandIds(
  overridesPath = BRAND_ID_OVERRIDES_PATH
): Promise<BrandIdMap> {
  // Yalnız ürünü olan katalog markaları — kapsamadığımız markayı kaynağa
  // bildirmenin anlamı yok, `--all` boşuna hedef üretirdi.
  const rows = await db.$queryRaw<{ brand: string; tecdoc_id: number }[]>`
    select b.brand, pb.id as tecdoc_id
    from catalog.brands b
    join public.part_brands pb
      on upper(regexp_replace(pb.name, '[^A-Za-z0-9]', '', 'g'))
       = upper(regexp_replace(b.brand, '[^A-Za-z0-9]', '', 'g'))
    where exists (select 1 from catalog.products p where p.brand_id = b.id)
  `

  const brandIds: Record<string, number> = {}
  for (const row of rows) brandIds[row.brand.trim().toUpperCase()] = row.tecdoc_id
  const fromArchive = Object.keys(brandIds).length

  const overrides = await loadOverrides(overridesPath)
  for (const [brand, id] of Object.entries(overrides)) brandIds[brand] = id

  return {
    brandIds,
    fromArchive,
    fromOverrides: Object.keys(overrides).filter((b) => key(b).length > 0).length
  }
}
