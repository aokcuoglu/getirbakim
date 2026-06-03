/**
 * Meilisearch Client
 *
 * Singleton Meilisearch client for client-side usage.
 * Uses public search key for read-only operations.
 */

import { MeiliSearch } from 'meilisearch'

const MEILISEARCH_HOST =
  process.env.NEXT_PUBLIC_MEILI_HOST || 'http://localhost:7700'
const MEILISEARCH_SEARCH_KEY = process.env.NEXT_PUBLIC_MEILI_SEARCH_KEY || ''

// Singleton instance
let meiliClient: MeiliSearch | null = null

export function getMeiliClient(): MeiliSearch {
  if (!meiliClient) {
    if (!MEILISEARCH_HOST) {
      console.warn('⚠️  MEILISEARCH_HOST is not set, using default localhost')
    }
    if (!MEILISEARCH_SEARCH_KEY) {
      console.warn('⚠️  MEILISEARCH_SEARCH_KEY is not set, requests may fail')
    }
    meiliClient = new MeiliSearch({
      host: MEILISEARCH_HOST,
      apiKey: MEILISEARCH_SEARCH_KEY
    })
  }
  return meiliClient
}

/**
 * Meilisearch returns this message when the hosted endpoint is unavailable
 * for the requested route (for example when search is effectively disabled).
 */
export function isMeiliNoRouteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no Route matched with those values')
}

export function isMeiliUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    isMeiliNoRouteError(error) ||
    message.includes('Request to') && message.includes('has failed') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('fetch failed')
  )
}

// Index names
export const PARTS_INDEX = 'parts'

// Default search configuration
export const DEFAULT_SEARCH_CONFIG = {
  limit: 24,
  attributesToHighlight: ['name', 'brandName'],
  facets: ['brandId', 'categoryId']
} as const
