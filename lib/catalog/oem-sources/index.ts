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

/**
 * Önceki kaynağın KAPSADIĞINI SÖYLEDİĞİ ama pratikte veremediği markalar —
 * REPXPERT açıksa bunlar ona yönlendirilir.
 *
 * SWAG: bilstein partsfinder SWAG'i gerçekten kapsıyor, ama marka yetkisini
 * isteğin geldiği IP'ye bağlıyor; bulunduğumuz ağdan 17 binlik SWAG kümesinin
 * yalnız birkaç yüzü dönüyor. Markayı bilstein'ın listesinden silmek yanlış
 * olurdu (katalog yanlış değil, erişimimiz kısıtlı) — bu yüzden kısıt kaynağın
 * kendisinde değil, yönlendirmede tutuluyor. Erişim düzelirse tek satır geri
 * alınır.
 */
const REPXPERT_FIRST = new Set(['SWAG'])

/**
 * Kaynağı, REPXPERT'in devraldığı markaları kapsamıyormuş gibi gösterir.
 * `lookup` dokunulmadan bırakılır: marka açıkça istenirse kaynak yine çalışır,
 * yalnız otomatik seçimde öne geçmez.
 */
function yieldingBrands(source: OemSource, taken: Set<string>): OemSource {
  if (source.brands().every((b) => !taken.has(b.toUpperCase()))) return source
  return {
    ...source,
    brands: () => source.brands().filter((b) => !taken.has(b.toUpperCase())),
    supports: (brand: string) =>
      !taken.has(brand.trim().toUpperCase()) && source.supports(brand)
  }
}

export async function createOemSources(
  options: SourceRegistryOptions = {}
): Promise<OemSource[]> {
  let sources: OemSource[] = [createBilsteinSource(), createTecDocCatalogSource()]
  // Üreticinin KENDİ kataloğundan sonra gelir: aynı marka ikisinde de varsa
  // üreticinin yayını daha günceldir. REPXPERT'in değeri kapsamda — kendi
  // kataloğuna erişemediğimiz yüzlerce markayı o taşıyor.
  if (options.repxpert) {
    const repxpert = createRepxpertSource(options.repxpert)
    // Devir yalnız REPXPERT o markayı gerçekten kapsıyorsa yapılır; aksi hâlde
    // marka hiçbir kaynağa düşmeden sessizce kaybolurdu.
    const taken = new Set([...REPXPERT_FIRST].filter((b) => repxpert.supports(b)))
    sources = sources.map((s) => yieldingBrands(s, taken))
    sources.push(repxpert)
  }
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
