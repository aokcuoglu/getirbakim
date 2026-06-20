import { NextRequest } from 'next/server'
import { autoMatchDpprdProducts } from '@/lib/admin/dpprd-auto-match'
import { errorResponse, successResponse } from '@/lib/api/route-utils'

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const apply = searchParams.get('apply') !== 'false'

    const stats = await autoMatchDpprdProducts({
      apply,
      onProgress: (msg) => console.log('[auto-match]', msg)
    })

    return successResponse(stats)
  } catch (error) {
    console.error('[auto-match] Error:', error)
    return errorResponse({
      status: 500,
      code: 'AUTO_MATCH_FAILED',
      message: error instanceof Error ? error.message : 'Auto-match failed.'
    })
  }
}
