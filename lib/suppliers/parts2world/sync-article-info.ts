import 'dotenv/config'
import { db } from '../../db'
import {
  appendSyncError,
  buildResumeKey,
  deleteDbCheckpoint,
  getParts2WorldBaseUrls,
  normalizeText,
  parseArgValue,
  parseBoolean,
  parseIntList,
  parsePositiveBigInt,
  parsePositiveInt,
  readDbCheckpoint,
  startSyncRun,
  updateSyncRun,
  withRetry,
  writeDbCheckpoint
} from './common'
import { buildPrioritizedQueue } from './article-info-sync-helpers'

type ArticleInfoCompatibilityRow = {
  brand: string
  article: string
}

type ArticleInfoApplicabilityRow = {
  modificationId: number
}

type ArticleInfoPayload = {
  compabilityParts?: ArticleInfoCompatibilityRow[]
  applicability?: ArticleInfoApplicabilityRow[]
}

type ArticleInfoResponse = {
  data?: ArticleInfoPayload
}

type Config = {
  partIds: bigint[]
  vehicleTypeIds: number[]
  seedCatalogRunId: bigint | null
  offset: number
  limit: number | null
  concurrency: number
  resume: boolean
  resumeKey: string | null
  resetResume: boolean
  dryRun: boolean
  shardIndex: number
  shardCount: number
}

type TargetPartRow = {
  id: bigint
  tecdoc_article_id: bigint | null
  article_link_id: bigint
  category_id: number
  p2w_last_seen_run_id: bigint | null
}

type ExplicitSelectionPartRow = TargetPartRow & {
  p2w_last_seen_at: Date | null
  p2w_last_seen_run_id: bigint | null
  p2w_article_info_synced_at: Date | null
}

type ResumePayload = {
  lastScope?: 'seed' | 'backlog'
  lastPartId: string
  processed: number
  updated: number
  failed: number
  skipped: number
}

const SCRIPT_NAME = 'sync-article-info'

function parseNonNegativeInt(value: string | null | undefined): number | null {
  if (value == null) return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const intValue = Math.trunc(num)
  return intValue >= 0 ? intValue : null
}

function buildConfig(): Config {
  const shardCount = Math.max(
    1,
    parsePositiveInt(parseArgValue('shard-count')) || 1
  )
  const shardIndex = parseNonNegativeInt(parseArgValue('shard-index')) || 0
  if (shardIndex >= shardCount) {
    throw new Error(
      `Invalid shard index: shard-index=${shardIndex} shard-count=${shardCount}`
    )
  }

  return {
    partIds: parseIntList(parseArgValue('part-id')).map((value) => BigInt(value)),
    vehicleTypeIds: parseIntList(parseArgValue('vehicle-type-id')),
    seedCatalogRunId: parsePositiveBigInt(parseArgValue('seed-catalog-run-id')),
    offset: Math.max(0, parsePositiveInt(parseArgValue('offset')) || 0),
    limit: parsePositiveInt(parseArgValue('limit')),
    concurrency: Math.min(parsePositiveInt(parseArgValue('concurrency')) || 4, 24),
    resume:
      parseArgValue('resume') == null
        ? true
        : parseBoolean(parseArgValue('resume')),
    resumeKey: normalizeText(parseArgValue('resume-key')),
    resetResume: parseBoolean(parseArgValue('reset-resume')),
    dryRun: parseBoolean(parseArgValue('dry-run')),
    shardCount,
    shardIndex
  }
}

function mapApiBase(baseUrl: string): string {
  return `${baseUrl}/api/v2/tecdoc`
}

async function fetchFromBases<T>(
  baseUrls: string[],
  endpointPath: string,
  contextLabel: string
): Promise<T> {
  const errors: string[] = []

  for (const baseUrl of baseUrls) {
    const url = `${mapApiBase(baseUrl)}${endpointPath}`

    try {
      const response = await withRetry(
        () =>
          fetch(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept: 'application/json'
            }
          }),
        2
      )

      if (!response.ok) {
        errors.push(`${url} => ${response.status}`)
        continue
      }

      return (await response.json()) as T
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${url} => ${message}`)
    }
  }

  throw new Error(`${contextLabel} failed. ${errors.slice(0, 5).join(' | ')}`)
}

function normalizeCrossRows(
  items: ArticleInfoCompatibilityRow[] | undefined
): Array<{ brand_name: string; article_number: string }> {
  const dedupe = new Map<string, { brand_name: string; article_number: string }>()

  for (const item of items || []) {
    const brandName = normalizeText(item?.brand)
    const articleNumber = normalizeText(item?.article)
    if (!brandName || !articleNumber) continue
    const key = `${brandName.toLocaleLowerCase('tr')}::${articleNumber.toLocaleLowerCase('tr')}`
    if (!dedupe.has(key)) {
      dedupe.set(key, { brand_name: brandName, article_number: articleNumber })
    }
  }

  return Array.from(dedupe.values())
}

function normalizeVehicleTypeIds(
  items: ArticleInfoApplicabilityRow[] | undefined,
  validVehicleTypeIds: Set<number>
): number[] {
  const dedupe = new Set<number>()
  for (const item of items || []) {
    const id = Number(item?.modificationId)
    if (!Number.isFinite(id)) continue
    const normalized = Math.trunc(id)
    if (normalized <= 0) continue
    if (!validVehicleTypeIds.has(normalized)) continue
    dedupe.add(normalized)
  }
  return Array.from(dedupe)
}

async function loadCandidateVehicleTypeIds(part: TargetPartRow): Promise<number[]> {
  const ids = new Set<number>()

  const directRows = await db.part_vehicle_types.findMany({
    where: { part_id: part.id },
    select: { vehicle_type_id: true }
  })
  for (const row of directRows) ids.add(row.vehicle_type_id)

  const categoryRows = await db.$queryRawUnsafe<Array<{ vehicle_types_id: number }>>(
    `
      SELECT vehicle_types_id
      FROM public.vehicle_types_categories
      WHERE category_id = $1
      ORDER BY vehicle_types_id ASC
      LIMIT 25
    `,
    part.category_id
  )
  for (const row of categoryRows) ids.add(row.vehicle_types_id)

  return Array.from(ids)
}

async function fetchArticleInfoWithFallback(input: {
  baseUrls: string[]
  part: TargetPartRow
  vehicleTypeId: number
}): Promise<ArticleInfoPayload | null> {
  const partId = input.part.id
  const tecdocId = input.part.tecdoc_article_id || partId
  const linkId = input.part.article_link_id

  const candidates: Array<{ articleId: bigint; articleLinkId: bigint }> = [
    { articleId: tecdocId, articleLinkId: linkId },
    { articleId: partId, articleLinkId: linkId },
    { articleId: tecdocId, articleLinkId: partId },
    { articleId: partId, articleLinkId: partId }
  ]

  const visited = new Set<string>()
  for (const candidate of candidates) {
    const key = `${candidate.articleId.toString()}:${candidate.articleLinkId.toString()}`
    if (visited.has(key)) continue
    visited.add(key)

    const payload = await fetchFromBases<ArticleInfoResponse>(
      input.baseUrls,
      `/article-info/${candidate.articleId.toString()}/${candidate.articleLinkId.toString()}/${input.vehicleTypeId}/`,
      `article-info(part=${partId.toString()})`
    )
    if (payload?.data) return payload.data
  }

  return null
}

async function resolveSeedCatalogRunId(config: Config): Promise<bigint | null> {
  if (config.seedCatalogRunId) return config.seedCatalogRunId

  const rows = await db.$queryRawUnsafe<Array<{ id: bigint }>>(
    `
      SELECT id
      FROM public.parts2world_sync_runs
      WHERE script_name = 'sync-catalog' AND status = 'completed'
      ORDER BY started_at DESC
      LIMIT 1
    `
  )

  return rows[0]?.id || null
}

async function loadExplicitPartQueue(
  config: Config,
  seedCatalogRunId: bigint | null
): Promise<TargetPartRow[]> {
  if (config.partIds.length === 0) return []

  const rows = await db.parts.findMany({
    where: {
      id: { in: config.partIds },
      p2w_last_seen_at: { not: null },
      p2w_last_seen_run_id: { not: null }
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      tecdoc_article_id: true,
      article_link_id: true,
      category_id: true,
      p2w_last_seen_run_id: true,
      p2w_last_seen_at: true,
      p2w_article_info_synced_at: true
    }
  })

  const eligibleRows = rows.filter((row) => {
    if (!row.p2w_last_seen_at) return false
    if (!row.p2w_last_seen_run_id) return false
    if (!row.p2w_article_info_synced_at) return true
    return row.p2w_article_info_synced_at < row.p2w_last_seen_at
  })

  const shardedRows = eligibleRows.filter(
    (row) => Number(row.id % BigInt(config.shardCount)) === config.shardIndex
  )

  const seedRows: TargetPartRow[] = []
  const backlogRows: TargetPartRow[] = []

  for (const row of shardedRows as ExplicitSelectionPartRow[]) {
    const target: TargetPartRow = {
      id: row.id,
      tecdoc_article_id: row.tecdoc_article_id,
      article_link_id: row.article_link_id,
      category_id: row.category_id,
      p2w_last_seen_run_id: row.p2w_last_seen_run_id
    }

    if (seedCatalogRunId && row.p2w_last_seen_run_id === seedCatalogRunId) {
      seedRows.push(target)
      continue
    }

    backlogRows.push(target)
  }

  return buildPrioritizedQueue(seedRows, backlogRows)
}

async function queryQueuedPartsByScope(input: {
  seedCatalogRunId: bigint | null
  scope: 'seed' | 'backlog'
  take: number | null
  shardCount: number
  shardIndex: number
}): Promise<TargetPartRow[]> {
  if (typeof input.take === 'number' && input.take <= 0) return []
  if (input.scope === 'seed' && !input.seedCatalogRunId) return []

  const conditions: string[] = [
    'p.p2w_last_seen_at IS NOT NULL',
    'p.p2w_last_seen_run_id IS NOT NULL',
    '(p.p2w_article_info_synced_at IS NULL OR p.p2w_article_info_synced_at < p.p2w_last_seen_at)'
  ]
  const params: Array<bigint | number> = []

  const shardCountRef = `$${params.push(BigInt(input.shardCount))}`
  const shardIndexRef = `$${params.push(BigInt(input.shardIndex))}`
  conditions.push(`(p.id % ${shardCountRef}::bigint) = ${shardIndexRef}::bigint`)

  if (input.seedCatalogRunId) {
    const seedRef = `$${params.push(input.seedCatalogRunId)}`
    if (input.scope === 'seed') {
      conditions.push(`p.p2w_last_seen_run_id = ${seedRef}`)
    } else {
      conditions.push(`p.p2w_last_seen_run_id IS DISTINCT FROM ${seedRef}`)
    }
  }

  const sql = `
    SELECT
      p.id,
      p.tecdoc_article_id,
      p.article_link_id,
      p.category_id,
      p.p2w_last_seen_run_id
    FROM public.parts p
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.id ASC
    ${typeof input.take === 'number' ? `LIMIT $${params.push(input.take)}` : ''}
  `

  return db.$queryRawUnsafe<TargetPartRow[]>(sql, ...params)
}

async function loadWindowedPartQueue(
  config: Config,
  seedCatalogRunId: bigint | null
): Promise<TargetPartRow[]> {
  if (config.limit == null) {
    const seedRows = await queryQueuedPartsByScope({
      seedCatalogRunId,
      scope: 'seed',
      take: null,
      shardCount: config.shardCount,
      shardIndex: config.shardIndex
    })

    const backlogRows = await queryQueuedPartsByScope({
      seedCatalogRunId,
      scope: 'backlog',
      take: null,
      shardCount: config.shardCount,
      shardIndex: config.shardIndex
    })

    const prioritizedRows = buildPrioritizedQueue(seedRows, backlogRows)
    return prioritizedRows.slice(config.offset)
  }

  const windowSize = Math.max(1, config.offset + config.limit)

  const seedRows = await queryQueuedPartsByScope({
    seedCatalogRunId,
    scope: 'seed',
    take: windowSize,
    shardCount: config.shardCount,
    shardIndex: config.shardIndex
  })

  const remaining = Math.max(0, windowSize - seedRows.length)
  const backlogRows = await queryQueuedPartsByScope({
    seedCatalogRunId,
    scope: 'backlog',
    take: remaining,
    shardCount: config.shardCount,
    shardIndex: config.shardIndex
  })

  const prioritizedRows = buildPrioritizedQueue(seedRows, backlogRows)

  return prioritizedRows.slice(config.offset, config.offset + config.limit)
}

async function loadQueuedParts(
  config: Config,
  seedCatalogRunId: bigint | null
): Promise<TargetPartRow[]> {
  if (config.partIds.length > 0) {
    return loadExplicitPartQueue(config, seedCatalogRunId)
  }

  return loadWindowedPartQueue(config, seedCatalogRunId)
}

function readResumeCounters(payload: ResumePayload | null): {
  processed: number
  updated: number
  failed: number
  skipped: number
} {
  return {
    processed: payload?.processed || 0,
    updated: payload?.updated || 0,
    failed: payload?.failed || 0,
    skipped: payload?.skipped || 0
  }
}

function resolvePartScope(
  part: Pick<TargetPartRow, 'p2w_last_seen_run_id'>,
  seedCatalogRunId: bigint | null
): 'seed' | 'backlog' {
  return seedCatalogRunId && part.p2w_last_seen_run_id === seedCatalogRunId
    ? 'seed'
    : 'backlog'
}

async function resolveResumeScope(input: {
  payload: ResumePayload | null
  seedCatalogRunId: bigint | null
}): Promise<'seed' | 'backlog' | null> {
  if (input.payload?.lastScope) return input.payload.lastScope

  const lastPartId = input.payload?.lastPartId
  if (!lastPartId) return null

  if (!input.seedCatalogRunId) return 'backlog'

  const row = await db.parts.findUnique({
    where: { id: BigInt(lastPartId) },
    select: { p2w_last_seen_run_id: true }
  })

  return row?.p2w_last_seen_run_id === input.seedCatalogRunId ? 'seed' : 'backlog'
}

function buildResumedQueue(input: {
  parts: TargetPartRow[]
  lastPartId: string | null
  lastScope: 'seed' | 'backlog' | null
  seedCatalogRunId: bigint | null
}): TargetPartRow[] {
  if (!input.lastPartId || !input.lastScope) return input.parts

  const lastId = BigInt(input.lastPartId)

  return input.parts.filter((part) => {
    const scope = resolvePartScope(part, input.seedCatalogRunId)

    if (input.lastScope === 'seed') {
      if (scope === 'seed') return part.id > lastId
      return true
    }

    return scope === 'backlog' && part.id > lastId
  })
}

async function main() {
  const startedAt = Date.now()
  const config = buildConfig()
  const baseUrls = getParts2WorldBaseUrls()
  const seedCatalogRunId = await resolveSeedCatalogRunId(config)

  const effectiveResumeKey =
    config.resumeKey ||
    buildResumeKey('article-info-v3', {
      partIds: config.partIds,
      vehicleTypeIds: config.vehicleTypeIds,
      seedCatalogRunId: seedCatalogRunId?.toString() || null,
      offset: config.offset,
      limit: config.limit,
      shardCount: config.shardCount,
      shardIndex: config.shardIndex
    })

  const runId = await startSyncRun({
    scriptName: SCRIPT_NAME,
    resumeKey: effectiveResumeKey,
    args: {
      ...config,
      partIds: config.partIds.map((id) => id.toString()),
      seedCatalogRunId: seedCatalogRunId?.toString() || null
    } as unknown as Record<string, unknown>
  })

  let processed = 0
  let updated = 0
  let failed = 0
  let skipped = 0

  try {
    if (config.resetResume) {
      await deleteDbCheckpoint(SCRIPT_NAME, effectiveResumeKey)
      console.log(`Checkpoint reset key=${effectiveResumeKey}`)
    }

    console.log(
      `Using seed catalog run: ${seedCatalogRunId ? seedCatalogRunId.toString() : 'none'}`
    )

    const parts = await loadQueuedParts(config, seedCatalogRunId)

    if (parts.length === 0) {
      console.log('No parts selected for article-info sync.')
      await updateSyncRun({
        runId,
        status: 'completed',
        counters: { processed, created: 0, updated, failed, skipped },
        finished: true
      })
      return
    }

    let queue = parts
    let totalProgressTarget = parts.length

    if (config.resume) {
      const checkpoint = await readDbCheckpoint<ResumePayload>(
        SCRIPT_NAME,
        effectiveResumeKey
      )

      const counters = readResumeCounters(checkpoint?.payload || null)
      processed = counters.processed
      updated = counters.updated
      failed = counters.failed
      skipped = counters.skipped

      const lastPartId = checkpoint?.payload?.lastPartId || null
      const lastScope = await resolveResumeScope({
        payload: checkpoint?.payload || null,
        seedCatalogRunId
      })

      queue = buildResumedQueue({
        parts,
        lastPartId,
        lastScope,
        seedCatalogRunId
      })
      totalProgressTarget = processed + failed + skipped + queue.length

      if (lastPartId) {
        console.log(
          `Resume loaded key=${effectiveResumeKey} lastScope=${lastScope || 'unknown'} lastPartId=${lastPartId} remaining=${queue.length}`
        )
      }
    }

    const vehicleTypeRows = await db.vehicle_types.findMany({
      select: { id: true }
    })
    const validVehicleTypeIds = new Set(vehicleTypeRows.map((row) => row.id))

    for (let index = 0; index < queue.length; index += 1) {
      const part = queue[index]
      const partScope = resolvePartScope(part, seedCatalogRunId)
      let advanced = false

      try {
        const candidateVehicleTypeIds =
          config.vehicleTypeIds.length > 0
            ? config.vehicleTypeIds
            : await loadCandidateVehicleTypeIds(part)

        if (candidateVehicleTypeIds.length === 0) {
          skipped += 1
          advanced = true
          await appendSyncError({
            runId,
            scriptName: SCRIPT_NAME,
            stage: 'resolve-vehicle-types',
            entityType: 'part',
            entityId: part.id.toString(),
            message: 'No candidate vehicle types found for part.',
            context: {
              partId: part.id.toString(),
              categoryId: part.category_id
            }
          })
        } else {
          let payload: ArticleInfoPayload | null = null
          for (const vehicleTypeId of candidateVehicleTypeIds) {
            if (!validVehicleTypeIds.has(vehicleTypeId)) continue
            try {
              payload = await fetchArticleInfoWithFallback({
                baseUrls,
                part,
                vehicleTypeId
              })
              if (payload) break
            } catch {
              continue
            }
          }

          if (!payload) {
            failed += 1
            advanced = true
            await appendSyncError({
              runId,
              scriptName: SCRIPT_NAME,
              stage: 'fetch-article-info',
              entityType: 'part',
              entityId: part.id.toString(),
              message: 'No article-info payload found after fallback sequence.',
              context: {
                partId: part.id.toString(),
                tecdocArticleId: part.tecdoc_article_id?.toString() || null,
                articleLinkId: part.article_link_id.toString()
              }
            })
          } else {
            const crossRows = normalizeCrossRows(payload.compabilityParts)
            const vehicleTypeIds = normalizeVehicleTypeIds(
              payload.applicability,
              validVehicleTypeIds
            )
            if (!config.dryRun) {
              await withRetry(
                () =>
                  db.$transaction(
                    async (tx) => {
                      if (crossRows.length > 0) {
                        await tx.part_cross_references.deleteMany({
                          where: { part_id: part.id }
                        })
                        await tx.part_cross_references.createMany({
                          data: crossRows.map((row) => ({
                            part_id: part.id,
                            brand_name: row.brand_name,
                            article_number: row.article_number
                          }))
                        })
                      }

                      if (vehicleTypeIds.length > 0) {
                        await tx.part_vehicle_types.createMany({
                          data: vehicleTypeIds.map((vehicleTypeId) => ({
                            part_id: part.id,
                            vehicle_type_id: vehicleTypeId
                          })),
                          skipDuplicates: true
                        })
                      }

                      await tx.$executeRawUnsafe(
                        `
                          UPDATE public.parts
                          SET
                            p2w_article_info_synced_at = CURRENT_TIMESTAMP,
                            p2w_article_info_run_id = $2
                          WHERE id = $1
                        `,
                        part.id,
                        runId
                      )
                    },
                    {
                      maxWait: 20000,
                      timeout: 90000
                    }
                  ),
                2
              )
            }

            processed += 1
            updated += 1
            advanced = true
          }
        }
      } catch (error) {
        failed += 1
        advanced = true
        const message = error instanceof Error ? error.message : String(error)
        await appendSyncError({
          runId,
          scriptName: SCRIPT_NAME,
          stage: 'process-part',
          entityType: 'part',
          entityId: part.id.toString(),
          message,
          context: {
            partId: part.id.toString(),
            tecdocArticleId: part.tecdoc_article_id?.toString() || null,
            articleLinkId: part.article_link_id.toString(),
            categoryId: part.category_id
          }
        })
      }

      if (!advanced) continue

      const checkpointPayload: ResumePayload = {
        lastScope: partScope,
        lastPartId: part.id.toString(),
        processed,
        updated,
        failed,
        skipped
      }

      try {
        if (config.resume) {
          await writeDbCheckpoint({
            scriptName: SCRIPT_NAME,
            resumeKey: effectiveResumeKey,
            runId,
            cursor: part.id.toString(),
            payload: checkpointPayload
          })
        }

        await updateSyncRun({
          runId,
          counters: {
            processed,
            created: 0,
            updated,
            failed,
            skipped
          },
          checkpointCursor: part.id.toString(),
          checkpointPayload
        })
      } catch (cpError) {
        const cpMsg = cpError instanceof Error ? cpError.message : String(cpError)
        console.warn(`Checkpoint/sync-run update failed (non-fatal): ${cpMsg}`)
      }

      const completed = processed + failed + skipped
      if (completed % 50 === 0) {
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
        console.log(
          `Progress ${completed}/${totalProgressTarget} updated=${updated} failed=${failed} skipped=${skipped} elapsed=${elapsedSec}s`
        )
      }
    }

    if (config.resume) {
      await deleteDbCheckpoint(SCRIPT_NAME, effectiveResumeKey)
    }

    await updateSyncRun({
      runId,
      status: 'completed',
      counters: {
        processed,
        created: 0,
        updated,
        failed,
        skipped
      },
      finished: true
    })

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(
      `Article-info sync done. parts=${parts.length} processed=${processed} updated=${updated} failed=${failed} skipped=${skipped} elapsed=${elapsedSec}s`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendSyncError({
      runId,
      scriptName: SCRIPT_NAME,
      stage: 'fatal',
      message
    })
    await updateSyncRun({
      runId,
      status: 'failed',
      counters: {
        processed,
        created: 0,
        updated,
        failed: failed + 1,
        skipped
      },
      finished: true
    })
    throw error
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`parts2world article-info sync failed: ${message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
