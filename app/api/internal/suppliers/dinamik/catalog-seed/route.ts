import { NextRequest } from 'next/server'
import { handleDinamikCatalogSeedRequest } from './handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  return handleDinamikCatalogSeedRequest(request)
}
