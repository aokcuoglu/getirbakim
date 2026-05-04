import { NextRequest, NextResponse } from 'next/server'

type ScheduledSyncRunner = (input: {
  triggerType: 'SCHEDULED'
}) => Promise<{
  status: string
  runId: number
  totalCount: number
  successCount: number
  failedCount: number
  mappingMissCount: number
}>

function unauthorizedResponse() {
  return NextResponse.json(
    {
      success: false,
      message: 'Unauthorized.'
    },
    { status: 401 }
  )
}

export async function handleDinamikScheduledSyncRequest(
  request: NextRequest,
  runScheduledSync: ScheduledSyncRunner,
  secret = process.env.CRON_SECRET?.trim()
) {
  if (!secret) {
    return NextResponse.json(
      {
        success: false,
        message: 'CRON_SECRET is not configured.'
      },
      { status: 500 }
    )
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    return unauthorizedResponse()
  }

  try {
    const result = await runScheduledSync({
      triggerType: 'SCHEDULED'
    })

    return NextResponse.json({
      success: true,
      status: result.status,
      runId: result.runId,
      totalCount: result.totalCount,
      successCount: result.successCount,
      failedCount: result.failedCount,
      mappingMissCount: result.mappingMissCount
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Dinamik scheduled sync failed.'
      },
      { status: 500 }
    )
  }
}
