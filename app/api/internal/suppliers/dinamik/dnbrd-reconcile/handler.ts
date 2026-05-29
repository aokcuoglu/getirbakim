import { NextRequest, NextResponse } from 'next/server'
import { reconcileDbrands } from '@/lib/admin/dnbrd-reconcile'

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function handleDbrandsReconcileRequest(request: NextRequest) {
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

  const params = request.nextUrl.searchParams
  const apply = params.get('apply') === 'true'
  const syncFromApi = params.get('syncFromApi') !== 'false'

  try {
    const result = await reconcileDbrands({
      dryRun: !apply,
      syncFromApi
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
