import { handleDbrandsReconcileRequest } from './handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: Request) {
  return handleDbrandsReconcileRequest(request as import('next/server').NextRequest)
}
