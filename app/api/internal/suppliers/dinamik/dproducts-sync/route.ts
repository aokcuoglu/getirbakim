import { handleDproductsSyncRequest } from './handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  return handleDproductsSyncRequest(request as import('next/server').NextRequest)
}
