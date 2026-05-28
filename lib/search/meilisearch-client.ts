import 'server-only'
import { MeiliSearch } from 'meilisearch'

export function isMeiliEnabled(): boolean {
  const host = process.env.MEILI_HOST?.trim()
  return !!host
}

export function getMeiliHost(): string {
  return process.env.MEILI_HOST?.trim() || 'http://localhost:7700'
}

export function getMeiliClient(): MeiliSearch {
  const host = getMeiliHost()
  const apiKey = process.env.MEILI_MASTER_KEY?.trim()
  return new MeiliSearch({ host, apiKey })
}

export async function checkMeiliHealth(): Promise<{ reachable: boolean; status: string; error?: string }> {
  try {
    const client = getMeiliClient()
    const health = await client.health()
    return { reachable: true, status: health.status ?? 'available' }
  } catch (error) {
    return {
      reachable: false,
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
