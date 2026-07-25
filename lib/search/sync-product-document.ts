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
  if (!isMeiliEnabled()) return
  try {
    const docs = await buildCatalogSearchDocumentsBatch([productId])
    const index = getMeiliAdminClient().index(getProductsIndexName())
    if (docs.length > 0) {
      await index.addDocuments(docs)
    } else {
      await index.deleteDocument(productId.toString())
    }
  } catch (err) {
    console.warn('[meili] tek ürün doküman güncellemesi başarısız:', productId.toString(), err)
  }
}
