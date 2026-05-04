import { NextRequest } from 'next/server'
import { handleSetaCatalogSeedRequest } from './handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  return handleSetaCatalogSeedRequest(request)
}
