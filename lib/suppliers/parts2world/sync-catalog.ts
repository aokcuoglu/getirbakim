import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { db } from '../../db'
import {
  appendSyncError,
  buildResumeKey,
  buildUrlCandidates,
  deleteDbCheckpoint,
  ensureStorageBucket,
  getParts2WorldAllowedHosts,
  getParts2WorldBaseUrls,
  normalizeText,
  normalizeTextList,
  parseArgValue,
  parseBoolean,
  parseIntList,
  parsePositiveBigInt,
  parsePositiveInt,
  readDbCheckpoint,
  runWithConcurrency,
  shouldUploadToSupabase,
  startSyncRun,
  updateSyncRun,
  uploadFromUrlCandidates,
  withRetry,
  writeDbCheckpoint
} from './common'

type VehicleCategoryRow = {
  id: number
  vehicle_types_id: number
  category_id: number
}

type ArticleImageItem = {
  image: string
  thumb: string
}

type ArticleOenItem = {
  brand: string
  code: string
}

type ArticleDocumentItem = {
  docFileName: string
  docFileTypeName: string
  docId: string
  docTypeId: number
  docTypeName: string
  docUrl?: string | null
}

type ArticleItem = {
  id: number
  name: string
  articleLinkId: number
  brand: string
  brandId: number
  price?: number | null
  inBasket?: boolean
  brandLogoUrl?: string
  partProperties?: Record<string, unknown>
  partInfo?: unknown[]
  partImages?: ArticleImageItem[]
  eanNumbers?: unknown[]
  oenNumbers?: ArticleOenItem[]
  documents?: ArticleDocumentItem[]
}

type ArticlesResponse = {
  data: ArticleItem[]
}

type SyncCatalogConfig = {
  vehicleTypeIds: number[]
  categoryIds: number[]
  offset: number
  limitMappings: number | null
  mappingBatchSize: number
  limitParts: number | null
  resume: boolean
  resumeKey: string | null
  resetResume: boolean
  partConcurrency: number
  mediaConcurrency: number
  txMaxWaitMs: number
  txTimeoutMs: number
  shardIndex: number
  shardCount: number
  dryRun: boolean
  skipMedia: boolean
}

type MediaContext = {
  baseUrls: string[]
  allowedHosts: string[]
  dryRun: boolean
  skipMedia: boolean
  imageCache: Map<string, string>
  documentCache: Map<string, string>
}

type ResumePayload = {
  mappingCursorId: number
  processedMappings: number
  processedParts: number
  updatedParts: number
  createdParts: number
  failedParts: number
  skippedParts: number
  dedupeMergeCount: number
  duplicateBlockCount: number
}

const SCRIPT_NAME = 'sync-catalog'

function parseNonNegativeInt(value: string | null | undefined): number | null {
  if (value == null) return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const intValue = Math.trunc(num)
  return intValue >= 0 ? intValue : null
}

function buildConfig(): SyncCatalogConfig {
  const shardCount = Math.max(
    1,
    parsePositiveInt(parseArgValue('shard-count')) || 1
  )
  const shardIndexRaw = parseNonNegativeInt(parseArgValue('shard-index')) || 0
  if (shardIndexRaw >= shardCount) {
    throw new Error(
      `Invalid shard index: shard-index=${shardIndexRaw} shard-count=${shardCount}`
    )
  }

  return {
    vehicleTypeIds: parseIntList(parseArgValue('vehicle-type-id')),
    categoryIds: parseIntList(parseArgValue('category-id')),
    offset: Math.max(0, parsePositiveInt(parseArgValue('offset')) || 0),
    limitMappings: parsePositiveInt(parseArgValue('limit-mappings')),
    mappingBatchSize: Math.min(
      Math.max(parsePositiveInt(parseArgValue('mapping-batch-size')) || 1000, 50),
      10000
    ),
    limitParts: parsePositiveInt(parseArgValue('limit-parts')),
    resume:
      parseArgValue('resume') == null
        ? true
        : parseBoolean(parseArgValue('resume')),
    resumeKey: normalizeText(parseArgValue('resume-key')),
    resetResume: parseBoolean(parseArgValue('reset-resume')),
    partConcurrency: Math.min(
      parsePositiveInt(parseArgValue('part-concurrency')) || 4,
      24
    ),
    mediaConcurrency: Math.min(
      parsePositiveInt(parseArgValue('media-concurrency')) || 8,
      24
    ),
    txMaxWaitMs: Math.min(
      Math.max(parsePositiveInt(parseArgValue('tx-max-wait-ms')) || 30000, 1000),
      120000
    ),
    txTimeoutMs: Math.min(
      Math.max(parsePositiveInt(parseArgValue('tx-timeout-ms')) || 120000, 5000),
      600000
    ),
    shardIndex: shardIndexRaw,
    shardCount,
    dryRun: parseBoolean(parseArgValue('dry-run')),
    skipMedia: parseBoolean(parseArgValue('skip-media'))
  }
}

function mapApiBase(baseUrl: string): string {
  return `${baseUrl}/api/v2/tecdoc`
}

function toDecimal(value: unknown): Prisma.Decimal | null {
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return new Prisma.Decimal(num)
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

async function fetchArticles(
  baseUrls: string[],
  vehicleTypeId: number,
  categoryId: number
): Promise<ArticleItem[]> {
  const payload = await fetchFromBases<ArticlesResponse>(
    baseUrls,
    `/articles/${vehicleTypeId}/${categoryId}/`,
    `articles(${vehicleTypeId},${categoryId})`
  )
  return Array.isArray(payload?.data) ? payload.data : []
}

async function fetchVehicleCategoryBatch(input: {
  vehicleTypeIds: number[]
  categoryIds: number[]
  shardIndex: number
  shardCount: number
  cursorId: number | null
  offset: number
  limit: number
}): Promise<VehicleCategoryRow[]> {
  const clauses: string[] = []
  const params: Array<number | number[]> = []
  let paramIndex = 1

  if (input.vehicleTypeIds.length > 0) {
    clauses.push(`vehicle_types_id = ANY($${paramIndex}::int[])`)
    params.push(input.vehicleTypeIds)
    paramIndex += 1
  }

  if (input.categoryIds.length > 0) {
    clauses.push(`category_id = ANY($${paramIndex}::int[])`)
    params.push(input.categoryIds)
    paramIndex += 1
  }

  if (input.shardCount > 1) {
    clauses.push(`MOD(vehicle_types_id, $${paramIndex}) = $${paramIndex + 1}`)
    params.push(input.shardCount, input.shardIndex)
    paramIndex += 2
  }

  if (input.cursorId != null) {
    clauses.push(`id > $${paramIndex}`)
    params.push(input.cursorId)
    paramIndex += 1
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const limitParam = `$${paramIndex}`
  params.push(input.limit)
  paramIndex += 1

  const offsetSql =
    input.cursorId == null && input.offset > 0 ? `OFFSET $${paramIndex}` : ''
  if (offsetSql) {
    params.push(input.offset)
  }

  return withRetry(
    () =>
      db.$queryRawUnsafe<VehicleCategoryRow[]>(
        `
          SELECT id, vehicle_types_id, category_id
          FROM public.vehicle_types_categories
          ${whereSql}
          ORDER BY id ASC
          LIMIT ${limitParam}
          ${offsetSql}
        `,
        ...params
      ),
    4
  )
}

function normalizePropertyRows(
  source: Record<string, unknown> | undefined
): Array<{ key: string; value: string }> {
  if (!source || typeof source !== 'object') return []
  const map = new Map<string, { key: string; value: string }>()
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeText(rawKey)
    const value = normalizeText(rawValue)
    if (!key || !value) continue
    map.set(key.toLocaleLowerCase('tr'), { key, value })
  }
  return Array.from(map.values())
}

function normalizeOenRows(
  items: ArticleOenItem[] | undefined
): Array<{ brand: string; code: string }> {
  const seen = new Set<string>()
  const rows: Array<{ brand: string; code: string }> = []
  for (const item of items || []) {
    const brand = normalizeText(item?.brand)
    const code = normalizeText(item?.code)
    if (!brand || !code) continue
    const dedupe = `${brand.toLocaleLowerCase('tr')}::${code.toLocaleLowerCase('tr')}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    rows.push({ brand, code })
  }
  return rows
}

async function resolveMediaUrl(input: {
  rawUrl?: string | null
  docId?: string | null
  fallbackFileName?: string | null
  bucket: 'part-images' | 'part-documents'
  storagePrefix: string
  cacheKey: string
  context: MediaContext
}): Promise<string | null> {
  const candidates = buildUrlCandidates({
    rawUrl: input.rawUrl,
    docId: input.docId,
    baseUrls: input.context.baseUrls
  })
  if (candidates.length === 0) return null
  if (candidates.some((candidate) => candidate.includes('/storage/v1/object/public/')))
    return candidates[0]

  const shouldUpload = shouldUploadToSupabase(
    candidates,
    input.context.allowedHosts
  )
  if (!shouldUpload || input.context.dryRun || input.context.skipMedia) {
    return candidates[0]
  }

  const cache =
    input.bucket === 'part-images'
      ? input.context.imageCache
      : input.context.documentCache

  const uploaded = await uploadFromUrlCandidates({
    bucket: input.bucket,
    storagePrefix: input.storagePrefix,
    urlCandidates: candidates,
    cacheKey: input.cacheKey,
    fallbackFileName: input.fallbackFileName,
    cache
  })
  return uploaded || candidates[0]
}

async function normalizeImageRows(
  article: ArticleItem,
  mediaContext: MediaContext,
  mediaConcurrency: number
): Promise<Array<{ image: string; thumb: string }>> {
  const sourceItems = Array.isArray(article.partImages) ? article.partImages : []
  const rows: Array<{ image: string; thumb: string }> = []
  await runWithConcurrency(sourceItems, mediaConcurrency, async (item, index) => {
    const image = await resolveMediaUrl({
      rawUrl: item.image,
      fallbackFileName: `image-${article.articleLinkId}-${index + 1}.jpg`,
      bucket: 'part-images',
      storagePrefix: 'tecdoc/images',
      cacheKey: `image:${normalizeText(item.image) || ''}`,
      context: mediaContext
    })
    if (!image) return
    const thumb =
      (await resolveMediaUrl({
        rawUrl: item.thumb,
        fallbackFileName: `thumb-${article.articleLinkId}-${index + 1}.jpg`,
        bucket: 'part-images',
        storagePrefix: 'tecdoc/thumbs',
        cacheKey: `thumb:${normalizeText(item.thumb) || ''}`,
        context: mediaContext
      })) || image

    rows.push({ image, thumb })
  })
  return rows
}

async function normalizeDocumentRows(
  article: ArticleItem,
  mediaContext: MediaContext,
  mediaConcurrency: number
): Promise<
  Array<{
    doc_file_name: string
    doc_file_type_name: string
    doc_id: string
    doc_type_id: number
    doc_type_name: string
    doc_url: string | null
  }>
> {
  const sourceItems = Array.isArray(article.documents) ? article.documents : []
  const rows: Array<{
    doc_file_name: string
    doc_file_type_name: string
    doc_id: string
    doc_type_id: number
    doc_type_name: string
    doc_url: string | null
  }> = []

  await runWithConcurrency(sourceItems, mediaConcurrency, async (item, index) => {
    const docId = normalizeText(item.docId) || `${article.articleLinkId}-${index + 1}`
    const docFileName = normalizeText(item.docFileName) || `document-${docId}`
    const docTypeName = normalizeText(item.docTypeName) || 'Unknown'
    const docFileTypeName = normalizeText(item.docFileTypeName) || 'Unknown'

    const docUrl = await resolveMediaUrl({
      rawUrl: item.docUrl,
      docId,
      fallbackFileName: docFileName,
      bucket: 'part-documents',
      storagePrefix: 'tecdoc/documents',
      cacheKey: `doc:${docId}:${normalizeText(item.docUrl) || ''}`,
      context: mediaContext
    })

    rows.push({
      doc_file_name: docFileName,
      doc_file_type_name: docFileTypeName,
      doc_id: docId,
      doc_type_id: Number.isFinite(item.docTypeId) ? item.docTypeId : 0,
      doc_type_name: docTypeName,
      doc_url: docUrl
    })
  })

  const unique = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const key = `${row.doc_id}::${row.doc_url || ''}::${row.doc_file_name}`
    if (!unique.has(key)) unique.set(key, row)
  }
  return Array.from(unique.values())
}

async function resolveBrandId(
  tx: Prisma.TransactionClient,
  article: ArticleItem,
  mediaContext: MediaContext
): Promise<number> {
  const brandName = normalizeText(article.brand) || `Brand ${article.brandId}`
  const brandId =
    Number.isFinite(article.brandId) && article.brandId > 0
      ? Math.trunc(article.brandId)
      : null
  const logoCandidates = buildUrlCandidates({
    rawUrl: article.brandLogoUrl,
    baseUrls: mediaContext.baseUrls
  })
  const logoUrl = logoCandidates[0] || null

  if (brandId != null) {
    await tx.part_brands.upsert({
      where: { id: brandId },
      update: { name: brandName, logo_url: logoUrl },
      create: { id: brandId, name: brandName, logo_url: logoUrl }
    })
    return brandId
  }

  const existing = await tx.part_brands.findFirst({
    where: { name: { equals: brandName, mode: 'insensitive' } },
    select: { id: true }
  })
  if (existing) return existing.id
  throw new Error(`brand id missing for articleLinkId=${article.articleLinkId}`)
}

function chooseBetterArticle(current: ArticleItem, incoming: ArticleItem): ArticleItem {
  const score = (item: ArticleItem) => {
    const images = Array.isArray(item.partImages) ? item.partImages.length : 0
    const documents = Array.isArray(item.documents) ? item.documents.length : 0
    const info = Array.isArray(item.partInfo) ? item.partInfo.length : 0
    const oens = Array.isArray(item.oenNumbers) ? item.oenNumbers.length : 0
    const eans = Array.isArray(item.eanNumbers) ? item.eanNumbers.length : 0
    return images * 10 + documents * 5 + info * 2 + oens + eans
  }

  const incomingScore = score(incoming)
  const currentScore = score(current)
  if (incomingScore !== currentScore) {
    return incomingScore > currentScore ? incoming : current
  }

  return incoming.articleLinkId > current.articleLinkId ? incoming : current
}

function normalizeDedupeName(name: string): string {
  return name
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('tr')
}

async function upsertPartRecord(input: {
  article: ArticleItem
  categoryId: number
  vehicleTypeId: number
  brandId: number
  imageRows: Array<{ image: string; thumb: string }>
  documentRows: Array<{
    doc_file_name: string
    doc_file_type_name: string
    doc_id: string
    doc_type_id: number
    doc_type_name: string
    doc_url: string | null
  }>
  runId: bigint
  dryRun: boolean
  txMaxWaitMs: number
  txTimeoutMs: number
}): Promise<{
  created: boolean
  partId: bigint
  skipped: boolean
  dedupeMerged: boolean
  duplicateBlocked: boolean
}> {
  const tecdocArticleId = parsePositiveBigInt(input.article.id)
  const articleLinkId = parsePositiveBigInt(input.article.articleLinkId)
  if (!tecdocArticleId || !articleLinkId) {
    throw new Error('invalid article identifiers')
  }

  const eans = normalizeTextList(
    Array.isArray(input.article.eanNumbers) ? input.article.eanNumbers : []
  )
  const infos = normalizeTextList(
    Array.isArray(input.article.partInfo) ? input.article.partInfo : []
  )
  const oens = normalizeOenRows(input.article.oenNumbers)
  const properties = normalizePropertyRows(input.article.partProperties)
  const name = normalizeText(input.article.name) || `Article ${tecdocArticleId.toString()}`
  const dedupeName = normalizeDedupeName(name)
  const price = toDecimal(input.article.price)
  const inBasket = Boolean(input.article.inBasket)

  if (input.dryRun) {
    return {
      created: false,
      partId: tecdocArticleId,
      skipped: false,
      dedupeMerged: false,
      duplicateBlocked: false
    }
  }

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`${tecdocArticleId.toString()}|${input.brandId}|${input.categoryId}|${dedupeName}`},
            0
          )
        )
      `)

      const existingByCanonicalKey = await tx.$queryRaw<
        Array<{ id: bigint; article_link_id: bigint }>
      >(Prisma.sql`
        SELECT p.id, p.article_link_id
        FROM parts p
        WHERE p.tecdoc_article_id = ${tecdocArticleId}
          AND p.brand_id = ${input.brandId}
          AND p.category_id = ${input.categoryId}
          AND lower(regexp_replace(TRIM(BOTH FROM replace(p.name, chr(160), ' ')), '\\s+', ' ', 'g')) = ${dedupeName}
        ORDER BY p.updated_at DESC, p.id DESC
        LIMIT 1
      `)

      const existingByLink = await tx.parts.findFirst({
        where: { article_link_id: articleLinkId },
        select: { id: true, article_link_id: true }
      })
      const existingByScopedTecdoc = await tx.parts.findFirst({
        where: {
          tecdoc_article_id: tecdocArticleId,
          brand_id: input.brandId,
          category_id: input.categoryId
        },
        select: { id: true, article_link_id: true }
      })

      let targetPartId: bigint | null = null
      let created = false
      let dedupeMerged = false
      let duplicateBlocked = false

      if (existingByCanonicalKey[0]) {
        targetPartId = existingByCanonicalKey[0].id
      }
      if (!targetPartId && existingByLink) {
        targetPartId = existingByLink.id
      }
      if (!targetPartId && existingByScopedTecdoc) {
        targetPartId = existingByScopedTecdoc.id
      }

      if (
        targetPartId &&
        (!existingByLink || existingByLink.id !== targetPartId)
      ) {
        dedupeMerged = true
      }

      if (!targetPartId) {
        const existingByLegacySignature = await tx.parts.findMany({
          where: {
            name: { equals: name, mode: 'insensitive' },
            brand_id: input.brandId,
            category_id: input.categoryId
          },
          select: { id: true },
          orderBy: { updated_at: 'desc' },
          take: 2
        })
        if (existingByLegacySignature.length === 1) {
          targetPartId = existingByLegacySignature[0].id
        }
      }

        if (!targetPartId) {
        const idInUse = await tx.parts.findUnique({
          where: { id: tecdocArticleId },
          select: { id: true }
        })

        if (!idInUse) {
          targetPartId = tecdocArticleId
          created = true
        } else {
          const articleLinkIdInUse = await tx.parts.findUnique({
            where: { id: articleLinkId },
            select: { id: true }
          })

          if (!articleLinkIdInUse) {
            targetPartId = articleLinkId
            created = true
          } else {
            duplicateBlocked = true
            return {
              created: false,
              partId: tecdocArticleId,
              skipped: true,
              dedupeMerged: false,
              duplicateBlocked
            }
          }
        }

        await tx.parts.create({
          data: {
            id: targetPartId,
            tecdoc_article_id: tecdocArticleId,
            article_link_id: articleLinkId,
            name,
            price,
            in_basket: inBasket,
            brand_id: input.brandId,
            category_id: input.categoryId
          }
        })
      } else {
        const updateData = {
          tecdoc_article_id: tecdocArticleId,
          article_link_id: articleLinkId,
          name,
          price,
          in_basket: inBasket,
          brand_id: input.brandId,
          category_id: input.categoryId,
          updated_at: new Date()
        }

        const conflictingByStrictSignature = await tx.parts.findFirst({
          where: {
            id: { not: targetPartId },
            name: { equals: name, mode: 'insensitive' },
            brand_id: input.brandId,
            category_id: input.categoryId,
            article_link_id: articleLinkId
          },
          select: { id: true }
        })
        if (conflictingByStrictSignature) {
          targetPartId = conflictingByStrictSignature.id
          dedupeMerged = true
        }

        await tx.parts.update({
          where: { id: targetPartId },
          data: updateData
        })
      }

      await tx.$executeRawUnsafe(
        `
          UPDATE public.parts
          SET
            p2w_last_seen_at = CURRENT_TIMESTAMP,
            p2w_last_seen_run_id = $2,
            p2w_sync_version = 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        targetPartId,
        input.runId
      )

      await tx.part_vehicle_types.createMany({
        data: [
          {
            part_id: targetPartId,
            vehicle_type_id: input.vehicleTypeId
          }
        ],
        skipDuplicates: true
      })

      if (input.documentRows.length > 0) {
        await tx.part_documents.deleteMany({ where: { part_id: targetPartId } })
        await tx.part_documents.createMany({
          data: input.documentRows.map((row) => ({
            part_id: targetPartId,
            doc_file_name: row.doc_file_name,
            doc_file_type_name: row.doc_file_type_name,
            doc_id: row.doc_id,
            doc_type_id: row.doc_type_id,
            doc_type_name: row.doc_type_name,
            doc_url: row.doc_url
          }))
        })
      }

      if (input.imageRows.length > 0) {
        await tx.part_images.deleteMany({ where: { part_id: targetPartId } })
        await tx.part_images.createMany({
          data: input.imageRows.map((row) => ({
            part_id: targetPartId,
            image: row.image,
            thumb: row.thumb
          }))
        })
      }

      if (eans.length > 0) {
        await tx.part_eans.deleteMany({ where: { part_id: targetPartId } })
        await tx.part_eans.createMany({
          data: eans.map((code) => ({ part_id: targetPartId, code })),
          skipDuplicates: true
        })
      }

      if (infos.length > 0) {
        await tx.part_infos.deleteMany({ where: { part_id: targetPartId } })
        await tx.part_infos.createMany({
          data: infos.map((content) => ({ part_id: targetPartId, content }))
        })
      }

      if (oens.length > 0) {
        await tx.part_oens.deleteMany({ where: { part_id: targetPartId } })
        await tx.part_oens.createMany({
          data: oens.map((row) => ({
            part_id: targetPartId,
            brand: row.brand,
            code: row.code
          })),
          skipDuplicates: true
        })
      }

      if (properties.length > 0) {
        await tx.part_properties.deleteMany({ where: { part_id: targetPartId } })
        await tx.part_properties.createMany({
          data: properties.map((row) => ({
            part_id: targetPartId,
            key: row.key,
            value: row.value
          }))
        })
      }

      return {
        created,
        partId: targetPartId,
        skipped: false,
        dedupeMerged,
        duplicateBlocked
      }
    },
    {
      maxWait: input.txMaxWaitMs,
      timeout: input.txTimeoutMs
    }
  )
}

async function main() {
  const startedAt = Date.now()
  const config = buildConfig()
  const baseUrls = getParts2WorldBaseUrls()
  const allowedHosts = getParts2WorldAllowedHosts()
  const effectiveResumeKey =
    config.resumeKey ||
    buildResumeKey('catalog-v2', {
      vehicleTypeIds: config.vehicleTypeIds,
      categoryIds: config.categoryIds,
      offset: config.offset,
      limitMappings: config.limitMappings,
      limitParts: config.limitParts,
      shardIndex: config.shardIndex,
      shardCount: config.shardCount
    })

  const runId = await startSyncRun({
    scriptName: SCRIPT_NAME,
    resumeKey: effectiveResumeKey,
    args: config as unknown as Record<string, unknown>
  })

  let processedMappings = 0
  let processedParts = 0
  let updatedParts = 0
  let createdParts = 0
  let failedParts = 0
  let skippedParts = 0
  let dedupeMergeCount = 0
  let duplicateBlockCount = 0

  try {
    if (config.resetResume) {
      await deleteDbCheckpoint(SCRIPT_NAME, effectiveResumeKey)
      console.log(`Checkpoint reset key=${effectiveResumeKey}`)
    }

    if (!config.dryRun && !config.skipMedia) {
      await ensureStorageBucket('part-images', true)
      await ensureStorageBucket('part-documents', true)
    }

    let nextCursorId: number | null = null
    let pendingOffset = config.offset
    let remainingMappings = config.limitMappings
    if (config.resume) {
      const checkpoint = await readDbCheckpoint<ResumePayload>(
        SCRIPT_NAME,
        effectiveResumeKey
      )
      if (checkpoint?.payload?.mappingCursorId) {
        nextCursorId = checkpoint.payload.mappingCursorId
        pendingOffset = 0
        processedMappings = checkpoint.payload.processedMappings || 0
        processedParts = checkpoint.payload.processedParts || 0
        updatedParts = checkpoint.payload.updatedParts || 0
        createdParts = checkpoint.payload.createdParts || 0
        failedParts = checkpoint.payload.failedParts || 0
        skippedParts = checkpoint.payload.skippedParts || 0
        dedupeMergeCount = checkpoint.payload.dedupeMergeCount || 0
        duplicateBlockCount = checkpoint.payload.duplicateBlockCount || 0
        if (config.limitMappings != null) {
          remainingMappings = Math.max(
            config.limitMappings - processedMappings,
            0
          )
        }
        console.log(
          `Resume loaded key=${effectiveResumeKey} mappingCursorId=${nextCursorId}`
        )
      }
    }

    const mediaContext: MediaContext = {
      baseUrls,
      allowedHosts,
      dryRun: config.dryRun,
      skipMedia: config.skipMedia,
      imageCache: new Map<string, string>(),
      documentCache: new Map<string, string>()
    }

    let foundAnyMapping = false
    let stopRequested = false
    let firstMappingAfterResume = nextCursorId != null

    while (!stopRequested) {
      const batchLimit =
        remainingMappings != null
          ? Math.min(config.mappingBatchSize, remainingMappings)
          : config.mappingBatchSize

      if (batchLimit <= 0) {
        break
      }

      const mappingRows = await fetchVehicleCategoryBatch({
        vehicleTypeIds: config.vehicleTypeIds,
        categoryIds: config.categoryIds,
        shardIndex: config.shardIndex,
        shardCount: config.shardCount,
        cursorId: nextCursorId,
        offset: pendingOffset,
        limit: batchLimit
      })

      pendingOffset = 0

      if (mappingRows.length === 0) {
        break
      }

      foundAnyMapping = true

      for (const mapping of mappingRows) {
        nextCursorId = mapping.id
        processedMappings += 1

        if (firstMappingAfterResume || processedMappings <= 3 || processedMappings % 20 === 0) {
          const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
          console.log(
            `Processing mapping=${mapping.id} vehicleType=${mapping.vehicle_types_id} category=${mapping.category_id} mappings=${processedMappings}${config.limitMappings ? `/${config.limitMappings}` : ''} elapsed=${elapsedSec}s`
          )
        }

        let articles: ArticleItem[] = []
        try {
          articles = await fetchArticles(
            baseUrls,
            mapping.vehicle_types_id,
            mapping.category_id
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          try {
            await appendSyncError({
              runId,
              scriptName: SCRIPT_NAME,
              stage: 'fetch-articles',
              entityType: 'vehicle_types_categories',
              entityId: String(mapping.id),
              requestUrl: `${mapApiBase(baseUrls[0])}/articles/${mapping.vehicle_types_id}/${mapping.category_id}/`,
              message,
              context: mapping
            })
          } catch {
            // ignore logging failure
          }
        }

        const uniqueArticles = new Map<string, ArticleItem>()
        for (const article of articles) {
          const tecdocArticleId = parsePositiveBigInt(article.id)
          if (!tecdocArticleId) continue
          const key = tecdocArticleId.toString()
          const existing = uniqueArticles.get(key)
          uniqueArticles.set(
            key,
            existing ? chooseBetterArticle(existing, article) : article
          )
        }

        const queue = Array.from(uniqueArticles.values())
        const currentQueue =
          config.limitParts && processedParts < config.limitParts
            ? queue.slice(0, config.limitParts - processedParts)
            : queue

        if (firstMappingAfterResume || processedMappings <= 3 || processedMappings % 20 === 0) {
          console.log(
            `Fetched articles mapping=${mapping.id} uniqueArticles=${currentQueue.length}`
          )
          firstMappingAfterResume = false
        }

        await runWithConcurrency(currentQueue, config.partConcurrency, async (article) => {
          try {
            const imageRows = await normalizeImageRows(
              article,
              mediaContext,
              config.mediaConcurrency
            )
            const documentRows = await normalizeDocumentRows(
              article,
              mediaContext,
              config.mediaConcurrency
            )

            const brandId = await db.$transaction(
              (tx) => resolveBrandId(tx, article, mediaContext),
              {
                maxWait: config.txMaxWaitMs,
                timeout: config.txTimeoutMs
              }
            )

            const result = await upsertPartRecord({
              article,
              categoryId: mapping.category_id,
              vehicleTypeId: mapping.vehicle_types_id,
              brandId,
              imageRows,
              documentRows,
              runId,
              dryRun: config.dryRun,
              txMaxWaitMs: config.txMaxWaitMs,
              txTimeoutMs: config.txTimeoutMs
            })

            processedParts += 1
            if (result.skipped) {
              skippedParts += 1
            } else if (result.created) {
              createdParts += 1
            } else {
              updatedParts += 1
            }
            if (result.dedupeMerged) {
              dedupeMergeCount += 1
            }
            if (result.duplicateBlocked) {
              duplicateBlockCount += 1
            }
          } catch (error) {
            failedParts += 1
            const message = error instanceof Error ? error.message : String(error)
            try {
              await appendSyncError({
                runId,
                scriptName: SCRIPT_NAME,
                stage: 'upsert-part',
                entityType: 'article',
                entityId: String(article.id),
                requestUrl: `${mapApiBase(baseUrls[0])}/articles/${mapping.vehicle_types_id}/${mapping.category_id}/`,
                message,
                context: {
                  vehicleTypeId: mapping.vehicle_types_id,
                  categoryId: mapping.category_id,
                  articleId: article.id,
                  articleLinkId: article.articleLinkId
                }
              })
            } catch {
              // ignore logging failure
            }
          }
        })

        const checkpointPayload: ResumePayload = {
          mappingCursorId: mapping.id,
          processedMappings,
          processedParts,
          updatedParts,
          createdParts,
          failedParts,
          skippedParts,
          dedupeMergeCount,
          duplicateBlockCount
        }

        if (config.resume) {
          await writeDbCheckpoint({
            scriptName: SCRIPT_NAME,
            resumeKey: effectiveResumeKey,
            runId,
            cursor: String(mapping.id),
            payload: checkpointPayload
          })
        }

        await updateSyncRun({
          runId,
          counters: {
            processed: processedParts,
            created: createdParts,
            updated: updatedParts,
            failed: failedParts,
            skipped: skippedParts
          },
          checkpointCursor: String(mapping.id),
          checkpointPayload
        })

        if (processedMappings % 20 === 0) {
          const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
          console.log(
            `Progress mappings=${processedMappings}${config.limitMappings ? `/${config.limitMappings}` : ''} parts=${processedParts} created=${createdParts} updated=${updatedParts} failed=${failedParts} skipped=${skippedParts} dedupeMerged=${dedupeMergeCount} duplicateBlocked=${duplicateBlockCount} elapsed=${elapsedSec}s`
          )
        }

        if (remainingMappings != null) {
          remainingMappings = Math.max(remainingMappings - 1, 0)
          if (remainingMappings === 0) {
            stopRequested = true
          }
        }

        if (config.limitParts && processedParts >= config.limitParts) {
          console.log(`limit-parts reached (${config.limitParts}), stopping run.`)
          stopRequested = true
        }

        if (stopRequested) {
          break
        }
      }
    }

    if (!foundAnyMapping) {
      console.log('No vehicle_type/category mappings selected.')
      await updateSyncRun({
        runId,
        status: 'completed',
        counters: { processed: 0, created: 0, updated: 0, failed: 0, skipped: 0 },
        finished: true
      })
      return
    }

    if (config.resume) {
      await deleteDbCheckpoint(SCRIPT_NAME, effectiveResumeKey)
    }

    await updateSyncRun({
      runId,
      status: 'completed',
      counters: {
        processed: processedParts,
        created: createdParts,
        updated: updatedParts,
        failed: failedParts,
        skipped: skippedParts
      },
      finished: true
    })

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(
      `Catalog sync done. mappings=${processedMappings} parts=${processedParts} created=${createdParts} updated=${updatedParts} failed=${failedParts} skipped=${skippedParts} dedupeMerged=${dedupeMergeCount} duplicateBlocked=${duplicateBlockCount} elapsed=${elapsedSec}s`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await appendSyncError({
        runId,
        scriptName: SCRIPT_NAME,
        stage: 'fatal',
        message
      })
    } catch {
      // ignore logging failure
    }
    try {
      await updateSyncRun({
        runId,
        status: 'failed',
        counters: {
          processed: processedParts,
          created: createdParts,
          updated: updatedParts,
          failed: failedParts + 1,
          skipped: skippedParts
        },
        finished: true
      })
    } catch {
      // ignore status update failure
    }
    throw error
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`parts2world catalog sync failed: ${message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
