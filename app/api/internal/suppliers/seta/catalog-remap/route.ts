import { NextRequest } from 'next/server'
import { handleSetaCatalogRemapRequest } from './handler'
import { runSetaCatalogOemRemapJob } from '@/lib/suppliers/sync-seta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return handleSetaCatalogRemapRequest(request, runSetaCatalogOemRemapJob)
}
