/**
 * Meilisearch Client
 *
 * Re-exports server-side utilities from meilisearch-client.ts.
 * Client-side code should use NEXT_PUBLIC_MEILI_HOST and NEXT_PUBLIC_MEILI_SEARCH_KEY.
 * Server-side code should use MEILI_HOST and MEILI_MASTER_KEY via getMeiliClient().
 */

import { MeiliSearch } from 'meilisearch'
import { PRODUCTS_INDEX } from './search/meilisearch-client'

export { isMeiliEnabled, getMeiliHost, getProductsIndexName, checkMeiliHealth } from './search/meilisearch-client'

export { PRODUCTS_INDEX as PARTS_INDEX }

const MEILISEARCH_HOST =
  process.env.NEXT_PUBLIC_MEILI_HOST || 'http://localhost:7700'
const MEILISEARCH_SEARCH_KEY = process.env.NEXT_PUBLIC_MEILI_SEARCH_KEY || ''

let meiliClient: MeiliSearch | null = null

export function getMeiliClient(): MeiliSearch {
  if (!meiliClient) {
    const serverHost = typeof window === 'undefined' ? process.env.MEILI_HOST : undefined
    const serverKey = typeof window === 'undefined' ? process.env.MEILI_MASTER_KEY : undefined
    const host = serverHost || MEILISEARCH_HOST
    const apiKey = serverKey || MEILISEARCH_SEARCH_KEY

    meiliClient = new MeiliSearch({ host, apiKey })
  }
  return meiliClient
}

export function isMeiliNoRouteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no Route matched with those values')
}

export function isMeiliUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    isMeiliNoRouteError(error) ||
    (message.includes('Request to') && message.includes('has failed')) ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('fetch failed') ||
    message.includes('is not filterable') ||
    message.includes('is not sortable') ||
    message.includes('is not searchable') ||
    message.includes('Invalid facet distribution')
  )
}

export const DEFAULT_SEARCH_CONFIG = {
  limit: 24,
  attributesToHighlight: ['name', 'brandName'],
  facets: ['brand', 'categoryName']
} as const