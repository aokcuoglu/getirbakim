import { NextRequest } from 'next/server'
import { handleDinamikScheduledSyncRequest } from './handler'
import { runDinamikSyncJob } from '@/lib/suppliers/sync-dinamik'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return handleDinamikScheduledSyncRequest(request, runDinamikSyncJob)
}
