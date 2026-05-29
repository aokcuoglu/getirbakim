import { NextRequest } from 'next/server'
import { handleBasbugCatalogSeedRequest } from './handler'
import { runBasbugCatalogSeedJob } from '@/lib/suppliers/sync-basbug'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return handleBasbugCatalogSeedRequest(request, runBasbugCatalogSeedJob)
}
