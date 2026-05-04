import { NextRequest, NextResponse } from 'next/server'

type SetaCatalogRemapRunnerInput = {
  triggerType: 'SCHEDULED'
  limitProducts?: number
  onlyQueued?: boolean
}

type SetaCatalogRemapRunner = (input: SetaCatalogRemapRunnerInput) => Promise<{
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

function parseBoolean(raw: string | null): boolean {
  if (!raw) return false
  const normalized = raw.trim().toLocaleLowerCase('en-US')
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export async function handleSetaCatalogRemapRequest(
  request: NextRequest,
  runRemap: SetaCatalogRemapRunner,
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

  const limitProducts = parsePositiveInt(
    request.nextUrl.searchParams.get('limitProducts')
  )
  const onlyQueued = parseBoolean(request.nextUrl.searchParams.get('onlyQueued'))

  try {
    const result = await runRemap({
      triggerType: 'SCHEDULED',
      limitProducts,
      onlyQueued
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
        message: error instanceof Error ? error.message : 'SETA OEM remap request failed.'
      },
      { status: 500 }
    )
  }
}
