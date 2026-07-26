/**
 * OEM kaynak kaydı. Yeni bir kaynak eklemek = adapter yazıp buraya koymak;
 * sürücü script (scripts/scrape-product-oems.ts) değişmez.
 *
 * Sıra önemlidir: bir marka için ilk KAPSAYAN kaynak kullanılır. Resmi
 * üretici katalogları önce gelir; web araması en sonda, çünkü hem pahalıdır
 * hem de çıkarımsaldır — kataloğu olan bir markayı ona sormanın anlamı yok.
 */
import { createBilsteinSource } from './bilstein'
import type { LlmWebOptions, LlmWebSource } from './llm-web'
import { createRepxpertSource, type RepxpertTransport } from './repxpert'
import { createTecDocCatalogSource } from './tecdoc-catalog'
import type { OemSource } from './types'

export type { OemLookup, OemSource, SourcedOem } from './types'
export type { LlmWebSource, LlmWebUsage } from './llm-web'
export type { RepxpertTransport } from './repxpert'

export interface SourceRegistryOptions {
  /**
   * Web aramalı model kaynağını da kullan. Varsayılan KAPALI: ürün başına
   * ücretli bir model çağrısı demektir, sessizce açılmamalı.
   */
  llm?: LlmWebOptions | false
  /**
   * REPXPERT kaynağı. Varsayılan KAPALI: gerçek bir tarayıcı oturumu açmayı
   * gerektirir (bot koruması), bunu her koşuda yapmak gereksiz.
   *
   * Marka kapsamını çağıran belirler — harita veritabanından/dosyadan gelir
   * (bkz. repxpert-brands.ts), adapter'ın kendisi veriyi bilmez.
   */
  repxpert?: { transport: RepxpertTransport; brandIds: Record<string, number> } | false
}

export async function createOemSources(
  options: SourceRegistryOptions = {}
): Promise<OemSource[]> {
  const sources: OemSource[] = [createBilsteinSource(), createTecDocCatalogSource()]
  // Üreticinin KENDİ kataloğundan sonra gelir: aynı marka ikisinde de varsa
  // üreticinin yayını daha günceldir. REPXPERT'in değeri kapsamda — kendi
  // kataloğuna erişemediğimiz yüzlerce markayı o taşıyor.
  if (options.repxpert) sources.push(createRepxpertSource(options.repxpert))
  if (options.llm) {
    // Yüklemesi ertelenir: `@anthropic-ai/sdk` yalnız bu kaynağın bağımlılığı ve
    // prod imajına GİRMİYOR — Next standalone çıktısı yalnız uygulamanın import
    // ettiklerini izler, `scripts/` build'in parçası değil. Üstte statik import
    // olduğunda `--llm` kapalıyken bile scraper'ın tamamı
    // "Cannot find module '@anthropic-ai/sdk'" ile çöküyordu.
    const { createLlmWebSource } = await import('./llm-web')
    sources.push(createLlmWebSource(options.llm))
  }
  return sources
}

/** Katalogdaki markayı kapsayan ilk kaynak. */
export function sourceForBrand(sources: OemSource[], brand: string): OemSource | undefined {
  return sources.find((s) => s.supports(brand))
}
