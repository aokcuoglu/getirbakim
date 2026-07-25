import 'server-only'
import { getMeiliAdminClient } from './meili-admin'
import { getProductsIndexName, isMeiliEnabled } from './meilisearch-client'
import { buildCatalogSearchDocumentsBatch } from './search-document-builder'

/**
 * Tek bir kanonik ürünün arama dokümanını tazeler (incremental upsert).
 *
 * Admin bir override kaydettiğinde (ör. isim override) mağaza sayfası anında
 * yeni adı gösterir ama Meili indeksi bir sonraki toplu reindex'e kadar eski
 * adı taşır. Bu yüzden kayıt sonrası tek doküman güncellenir.
 *
 * Ürün ACTIVE değilse / slug'ı yoksa doküman indeksten silinir. Meili kapalıysa
 * veya erişilemiyorsa sessizce geçilir — admin kaydı bu yüzden başarısız olmasın
 * (bir sonraki reindex zaten düzeltir).
 */
export async function syncProductSearchDocument(productId: bigint): Promise<void> {
  await syncProductSearchDocuments([productId])
}

/**
 * Toplu varyant (CSV içe aktarma gibi çok ürüne dokunan akışlar için).
 * Dokümanı üretilemeyen ürünler (ACTIVE değil / slug yok) indeksten silinir.
 * Meili kapalıysa ya da erişilemiyorsa sessizce geçilir — admin yazımı bu
 * yüzden başarısız olmasın.
 */
export async function syncProductSearchDocuments(productIds: bigint[]): Promise<void> {
  if (!isMeiliEnabled() || productIds.length === 0) return

  const index = getMeiliAdminClient().index(getProductsIndexName())
  for (let i = 0; i < productIds.length; i += 500) {
    const part = productIds.slice(i, i + 500)
    try {
      const docs = await buildCatalogSearchDocumentsBatch(part)
      const kept = new Set(docs.map((d) => String(d.id)))
      const dropped = part.map((id) => id.toString()).filter((id) => !kept.has(id))
      if (docs.length > 0) await index.addDocuments(docs)
      if (dropped.length > 0) await index.deleteDocuments(dropped)
    } catch (err) {
      console.warn('[meili] doküman güncellemesi başarısız:', part.length, 'ürün', err)
    }
  }
}
