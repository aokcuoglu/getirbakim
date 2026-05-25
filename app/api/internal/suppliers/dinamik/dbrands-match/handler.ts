import { NextRequest, NextResponse } from 'next/server'
import { seedDbrandsMatchWorkspace } from '@/lib/admin/dbrands-match-seed'

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function handleDbrandsMatchRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured.' },
      { status: 500 }
    )
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return unauthorizedResponse()
  }

  const apply = request.nextUrl.searchParams.get('apply') === 'true'
  const runAutoMatch = request.nextUrl.searchParams.get('runAutoMatch') !== 'false'

  try {
    const result = await seedDbrandsMatchWorkspace({
      dryRun: !apply,
      runAutoMatch
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
