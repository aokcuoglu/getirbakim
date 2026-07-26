/**
 * OEM kaynak kaydı. Yeni bir kaynak eklemek = adapter yazıp buraya koymak;
 * sürücü script (scripts/scrape-product-oems.ts) değişmez.
 *
 * Sıra önemlidir: bir marka için ilk KAPSAYAN kaynak kullanılır. Resmi
 * üretici katalogları önce gelir; web araması en sonda, çünkü hem pahalıdır
 * hem de çıkarımsaldır — kataloğu olan bir markayı ona sormanın anlamı yok.
 */
import { createBilsteinSource } from './bilstein'
import { createLlmWebSource, type LlmWebOptions, type LlmWebSource } from './llm-web'
import { createTecDocCatalogSource } from './tecdoc-catalog'
import type { OemSource } from './types'

export type { OemLookup, OemSource, SourcedOem } from './types'
export type { LlmWebSource, LlmWebUsage } from './llm-web'

export interface SourceRegistryOptions {
  /**
   * Web aramalı model kaynağını da kullan. Varsayılan KAPALI: ürün başına
   * ücretli bir model çağrısı demektir, sessizce açılmamalı.
   */
  llm?: LlmWebOptions | false
}

export function createOemSources(options: SourceRegistryOptions = {}): OemSource[] {
  const sources: OemSource[] = [createBilsteinSource(), createTecDocCatalogSource()]
  if (options.llm) sources.push(createLlmWebSource(options.llm))
  return sources
}

/** Katalogdaki markayı kapsayan ilk kaynak. */
export function sourceForBrand(sources: OemSource[], brand: string): OemSource | undefined {
  return sources.find((s) => s.supports(brand))
}
