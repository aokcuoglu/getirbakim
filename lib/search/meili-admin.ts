import 'server-only'
import { MeiliSearch } from 'meilisearch'

let adminClient: MeiliSearch | null = null

export function getMeiliAdminClient(): MeiliSearch {
  if (!adminClient) {
    const host = process.env.MEILI_HOST || process.env.NEXT_PUBLIC_MEILI_HOST || 'http://localhost:7700'
    const apiKey = process.env.MEILI_MASTER_KEY || ''
    adminClient = new MeiliSearch({ host, apiKey })
  }
  return adminClient
}
