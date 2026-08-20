import { NextRequest, NextResponse } from 'next/server'

type BasbugCatalogSeedRunner = (input: {
  triggerType: 'SCHEDULED'
  listeGruplari?: string[]
  limitGroups?: number
}) => Promise<{
  status: string
  // `runId`/`providerId` ZORUNLU DEĞİL: `runBasbugCatalogSeedJob` bu alanları
  // döndürmüyor (lib/suppliers/sync-basbug.ts `BasbugCatalogSeedResult`).
  // Yanıt gövdesi değişmiyor — `undefined` alan JSON'a zaten yazılmıyor.
  runId?: number
  providerId?: number
  groupCount: number
  totalCount: number
  successCount: number
  failedCount: number
}>

function unauthorizedResponse() {
  return NextResponse.json(
    { success: false, message: 'Unauthorized.' },
    { status: 401 }
  )
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.trunc(value)
}

export async function handleBasbugCatalogSeedRequest(
  request: NextRequest,
  runSeed: BasbugCatalogSeedRunner,
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

  const listeGruplariRaw = request.nextUrl.searchParams.get('listeGruplari')
  const listeGruplari = listeGruplariRaw
    ? listeGruplariRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined
  const limitGroups = parsePositiveInt(
    request.nextUrl.searchParams.get('limitGroups')
  )

  try {
    const result = await runSeed({
      triggerType: 'SCHEDULED',
      listeGruplari,
      limitGroups
    })

    return NextResponse.json({
      success: true,
      status: result.status,
      runId: result.runId,
      providerId: result.providerId,
      groupCount: result.groupCount,
      totalCount: result.totalCount,
      successCount: result.successCount,
      failedCount: result.failedCount
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Başbuğ catalog seed failed.'
      },
      { status: 500 }
    )
  }
}
