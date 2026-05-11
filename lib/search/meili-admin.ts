import 'server-only'
import { MeiliSearch } from 'meilisearch'
import { getMeiliHost } from './meilisearch-client'

export function getMeiliAdminClient(): MeiliSearch {
  const host = getMeiliHost()
  const apiKey = process.env.MEILI_MASTER_KEY || ''
  return new MeiliSearch({ host, apiKey })
}