import { NextRequest, NextResponse } from 'next/server'
import { configureMeilisearchIndex } from '@/lib/search/setup-index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ success: false, message: 'CRON_SECRET not configured.' }, { status: 500 })
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })
  }

  try {
    await configureMeilisearchIndex()
    return NextResponse.json({ success: true, message: 'Meilisearch index configured.' })
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Setup failed.' },
      { status: 500 }
    )
  }
}