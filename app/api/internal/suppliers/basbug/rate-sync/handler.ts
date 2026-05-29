import { NextRequest, NextResponse } from 'next/server'

function unauthorizedResponse() {
  return NextResponse.json(
    { success: false, message: 'Unauthorized.' },
    { status: 401 }
  )
}

export async function handleBasbugRateSyncRequest(
  request: NextRequest,
  runSync: () => Promise<{
    status: string
    runId: number
    fetched: number
    upserted: number
  }>,
  secret = process.env.CRON_SECRET?.trim()
) {
  if (!secret) {
    return NextResponse.json(
      { success: false, message: 'CRON_SECRET is not configured.' },
      { status: 500 }
    )
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    return unauthorizedResponse()
  }

  try {
    const result = await runSync()

    return NextResponse.json({
      success: true,
      status: result.status,
      runId: result.runId,
      fetched: result.fetched,
      upserted: result.upserted
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Başbuğ rate sync failed.'
      },
      { status: 500 }
    )
  }
}
