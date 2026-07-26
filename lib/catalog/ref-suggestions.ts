/**
 * catalog.product_ref_suggestions inceleme kuyruğuna yazma.
 *
 * Hem web taramasından (scripts/harvest-brand-refs.ts + ingest) hem kaynak
 * bazlı OEM kazımasından (scripts/scrape-product-oems.ts) kullanılır: iki yol
 * da aynı kuyruğa, aynı benzersizlik sözleşmesiyle yazmalı ki admin ekranındaki
 * onay akışı tek bir yerden yürüsün.
 */
import { Prisma } from '@prisma/client'
import { db } from '../db'

export const SUGGESTION_KIND_OEM = 'OEM'
export const SUGGESTION_KIND_NAME = 'NAME'

export interface SuggestionRow {
  productId: bigint
  kind: string
  value: string
  valueNorm: string
  /** product_oems ile aynı sözleşme: '' = bilinmiyor (null DEĞİL). */
  oemBrand: string
  confidence: string
  sourceSite: string
  sourceUrl: string | null
  evidence: string | null
}

/**
 * Önerileri yazar, hâlihazırda açık olan aynı öneriyi tekrar açmaz.
 * Döndürülen sayı GERÇEKTEN eklenen satır sayısıdır (çakışanlar sayılmaz).
 */
export async function insertSuggestions(rows: SuggestionRow[], chunkSize = 500): Promise<number> {
  if (rows.length === 0) return 0
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const values = rows.slice(i, i + chunkSize).map(
      (r) => Prisma.sql`(${r.productId}, ${r.kind}, ${r.value}, ${r.valueNorm}, ${r.oemBrand},
        ${r.confidence}, ${r.sourceSite}, ${r.sourceUrl}, ${r.evidence})`
    )
    inserted += await db.$executeRaw(Prisma.sql`
      insert into catalog.product_ref_suggestions
        (product_id, kind, value, value_norm, oem_brand, confidence, source_site, source_url, evidence)
      values ${Prisma.join(values)}
      on conflict (product_id, kind, value_norm, oem_brand) do nothing
    `)
  }
  return inserted
}

/** catalog.product_oems'de kullanılan araç markası sözlüğü. */
export async function loadOemBrandVocabulary(): Promise<string[]> {
  const rows = await db.$queryRaw<{ oem_brand: string }[]>`
    select distinct oem_brand from catalog.product_oems where oem_brand <> ''
  `
  return rows.map((r) => r.oem_brand)
}
