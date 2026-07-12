import { NextRequest, NextResponse } from 'next/server'
import { enrichFromParts } from '@/lib/catalog/enrich-from-parts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Enrich catalog products from public.parts (OEM candidate links,
 * auto-approval, fitment/image/property/category copy). Slower cadence
 * than /api/internal/catalog/sync — weekly or on demand.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { success: false, message: 'CRON_SECRET is not configured.' },
      { status: 500 }
    )
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: 'Unauthorized.' },
      { status: 401 }
    )
  }

  try {
    const result = await enrichFromParts()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Catalog enrichment failed.'
      },
      { status: 500 }
    )
  }
}
