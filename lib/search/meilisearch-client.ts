import 'server-only'
import { MeiliSearch } from 'meilisearch'

export const PRODUCTS_INDEX = 'products'

let adminClient: MeiliSearch | null = null

export function isMeiliEnabled(): boolean {
  return process.env.MEILI_ENABLED === 'true'
}

export function getMeiliHost(): string {
  return process.env.MEILI_HOST || process.env.NEXT_PUBLIC_MEILI_HOST || 'http://127.0.0.1:7700'
}

export function getProductsIndexName(): string {
  return process.env.MEILI_INDEX_PRODUCTS || 'products'
}

export function getMeiliClient(): MeiliSearch {
  if (!adminClient) {
    const host = getMeiliHost()
    const apiKey = process.env.MEILI_MASTER_KEY || ''
    if (!apiKey && isMeiliEnabled()) {
      console.warn('[meili] MEILI_MASTER_KEY is not set but MEILI_ENABLED=true')
    }
    adminClient = new MeiliSearch({ host, apiKey })
  }
  return adminClient
}

export async function checkMeiliHealth(): Promise<{
  reachable: boolean
  status?: string
  error?: string
}> {
  try {
    const client = getMeiliClient()
    const health = await client.health()
    return { reachable: true, status: health.status }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { reachable: false, error: message }
  }
}