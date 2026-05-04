import { NextRequest } from 'next/server'
import { handleSetaSyncRequest } from './handler'
import { runSetaSyncJob } from '@/lib/suppliers/sync-seta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return handleSetaSyncRequest(request, runSetaSyncJob)
}
