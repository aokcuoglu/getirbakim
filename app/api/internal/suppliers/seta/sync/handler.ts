import { NextRequest, NextResponse } from 'next/server'

type SetaSyncRunnerInput = {
  triggerType: 'SCHEDULED'
  mode?: 'full' | 'delta'
  brand?: string
  limitProducts?: number
}

type SetaSyncRunner = (input: SetaSyncRunnerInput) => Promise<{
  status: string
  runId: number
  brandCount: number
  totalCount: number
  successCount: number
  failedCount: number
  errorCount: number
  mappingMissCount: number
  approvedMappingCount: number
  offerCount: number
  policyUpdatedCount: number
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

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.trunc(value)
}

function parseMode(raw: string | null): 'full' | 'delta' | undefined {
  if (!raw) return undefined
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'full' || normalized === 'delta') return normalized
  return undefined
}

export async function handleSetaSyncRequest(
  request: NextRequest,
  runSync: SetaSyncRunner,
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

  const mode = parseMode(request.nextUrl.searchParams.get('mode'))
  const brand = request.nextUrl.searchParams.get('brand')?.trim() || undefined
  const limitProducts = parsePositiveInt(request.nextUrl.searchParams.get('limitProducts'))

  try {
    const result = await runSync({
      triggerType: 'SCHEDULED',
      mode,
      brand,
      limitProducts
    })

    return NextResponse.json({
      success: true,
      status: result.status,
      runId: result.runId,
      brandCount: result.brandCount,
      totalCount: result.totalCount,
      successCount: result.successCount,
      failedCount: result.failedCount,
      errorCount: result.errorCount,
      mappingMissCount: result.mappingMissCount,
      approvedMappingCount: result.approvedMappingCount,
      offerCount: result.offerCount,
      policyUpdatedCount: result.policyUpdatedCount
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'SETA sync request failed.'
      },
      { status: 500 }
    )
  }
}
