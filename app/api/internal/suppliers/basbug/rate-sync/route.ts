import { NextRequest } from 'next/server'
import { handleBasbugRateSyncRequest } from './handler'
import { runBasbugRateSyncJob } from '@/lib/suppliers/sync-basbug'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return handleBasbugRateSyncRequest(request, runBasbugRateSyncJob)
}
