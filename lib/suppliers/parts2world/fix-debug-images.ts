import 'dotenv/config'
import { db } from '../../db'
import {
  buildUrlCandidates,
  ensureStorageBucket,
  getParts2WorldAllowedHosts,
  getParts2WorldBaseUrls,
  normalizeText,
  parseArgValue,
  parseBoolean,
  parsePositiveInt,
  runWithConcurrency,
  shouldUploadToSupabase,
  uploadFromUrlCandidates,
  withRetry
} from './common'

// ---------------------------------------------------------------------------
// Types (mirrored from sync-catalog.ts — they are not exported)
// ---------------------------------------------------------------------------

type ArticleImageItem = {
  image: string
  thumb: string
}

type ArticleItem = {
  id: number
  name: string
  articleLinkId: number
  brand: string
  brandId: number
  partImages?: ArticleImageItem[]
}

type ArticlesResponse = {
  data: ArticleItem[]
}

// Row coming from our DB query
type DebugImageRow = {
  id: number
  image: string | null
  thumb: string | null
  part_id: bigint
  category_id: number
  article_link_id: bigint
  tecdoc_article_id: bigint | null
  part_name: string
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type FixConfig = {
  dryRun: boolean
  limit: number | null
  concurrency: number
  mediaConcurrency: number
}

function buildConfig(): FixConfig {
  return {
    dryRun: parseBoolean(parseArgValue('dry-run')),
    limit: parsePositiveInt(parseArgValue('limit')),
    concurrency: Math.min(
      parsePositiveInt(parseArgValue('concurrency')) || 16,
      64
    ),
    mediaConcurrency: Math.min(
      parsePositiveInt(parseArgValue('media-concurrency')) || 32,
      128
    )
  }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

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
        async () => {
          const res = await fetch(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept: 'application/json'
            }
          })
          if (!res.ok && [429, 502, 503, 504].includes(res.status)) {
            // Throwing with "temporarily unavailable" so isRetryableError catches it
            throw new Error(`temporarily unavailable (${res.status})`)
          }
          return res
        },
        5 // Increase retries for API endpoints
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

/**
 * Fetch articles using vehicle_type_id + category_id.
 * Endpoint: /api/v2/tecdoc/articles/{vehicleTypeId}/{categoryId}/
 */
async function fetchArticles(
  baseUrls: string[],
  vehicleTypeId: number,
  categoryId: number
): Promise<ArticleItem[]> {
  const payload = await fetchFromBases<ArticlesResponse>(
    baseUrls,
    `/articles/${vehicleTypeId}/${categoryId}/`,
    `articles(vt=${vehicleTypeId},cat=${categoryId})`
  )

  return Array.isArray(payload?.data) ? payload.data : []
}

// ---------------------------------------------------------------------------
// Media helpers (reuse the same uploading pipeline as sync-catalog)
// ---------------------------------------------------------------------------

type MediaContext = {
  baseUrls: string[]
  allowedHosts: string[]
  imageCache: Map<string, string>
}

async function resolveMediaUrl(input: {
  rawUrl?: string | null
  bucket: 'part-images'
  storagePrefix: string
  cacheKey: string
  fallbackFileName: string
  context: MediaContext
}): Promise<string | null> {
  const candidates = buildUrlCandidates({
    rawUrl: input.rawUrl,
    baseUrls: input.context.baseUrls
  })

  if (candidates.length === 0) return null
  if (candidates.some((c) => c.includes('/storage/v1/object/public/'))) {
    return candidates[0]
  }

  const shouldUpload = shouldUploadToSupabase(
    candidates,
    input.context.allowedHosts
  )
  if (!shouldUpload) {
    return candidates[0]
  }

  const uploaded = await uploadFromUrlCandidates({
    bucket: input.bucket,
    storagePrefix: input.storagePrefix,
    urlCandidates: candidates,
    cacheKey: input.cacheKey,
    fallbackFileName: input.fallbackFileName,
    cache: input.context.imageCache
  })

  return uploaded || candidates[0]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = buildConfig()

  console.log('=== Fix Debug Images ===')
  console.log(`  dry-run: ${config.dryRun}`)
  console.log(`  limit: ${config.limit ?? 'ALL'}`)
  console.log(`  concurrency: ${config.concurrency}`)
  console.log(`  media-concurrency: ${config.mediaConcurrency}`)
  console.log()

  // 1. Ensure storage bucket exists
  if (!config.dryRun) {
    await ensureStorageBucket('part-images', true)
  }

  // 2. Find all part_images rows with debug links (cursor-based batching)
  console.log('Scanning for debug-link images (batched)…')
  const BATCH_SIZE = 500
  const rows: DebugImageRow[] = []
  let cursor: number | undefined = undefined

  while (true) {
    type QueryType = Parameters<typeof db.part_images.findMany>[0]

    const queryInfo: QueryType = {
      where: {
        image: { contains: '/_debug/tecdoc-images/' }
      },
      include: {
        parts: {
          select: {
            category_id: true,
            article_link_id: true,
            tecdoc_article_id: true,
            name: true
          }
        }
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE
    }

    if (cursor != null) {
      queryInfo.skip = 1
      queryInfo.cursor = { id: cursor }
    }

    const batch = (await db.part_images.findMany(
      queryInfo
    )) as unknown as Array<{
      id: number
      image: string | null
      thumb: string | null
      part_id: bigint
      parts: {
        category_id: number
        article_link_id: bigint
        tecdoc_article_id: bigint | null
        name: string
      } | null
    }>

    if (batch.length === 0) break

    for (const item of batch) {
      if (!item.parts) continue // safety check
      rows.push({
        id: item.id,
        image: item.image,
        thumb: item.thumb,
        part_id: item.part_id,
        category_id: item.parts.category_id,
        article_link_id: item.parts.article_link_id,
        tecdoc_article_id: item.parts.tecdoc_article_id,
        part_name: item.parts.name
      })
    }

    cursor = batch[batch.length - 1].id
    console.log(`  … fetched ${rows.length} rows so far (cursor=${cursor})`)

    if (config.limit && rows.length >= config.limit) {
      rows.length = config.limit // trim to exact limit
      break
    }
  }

  console.log(`Found ${rows.length} debug-link image rows.`)
  if (rows.length === 0) {
    console.log('Nothing to fix. Done.')
    return
  }

  // 3. Setup media context
  const baseUrls = getParts2WorldBaseUrls()
  const allowedHosts = getParts2WorldAllowedHosts()
  const mediaContext: MediaContext = {
    baseUrls,
    allowedHosts,
    imageCache: new Map()
  }

  // 4. Process each debug-image row
  let totalProcessed = 0
  let totalUpdated = 0
  let totalCleared = 0
  let totalSkipped = 0
  let totalFailed = 0

  // Cache: "vehicleTypeId:categoryId" -> ArticleItem[]
  const articlesCache = new Map<string, ArticleItem[] | null>()

  await runWithConcurrency(rows, config.concurrency, async (row) => {
    totalProcessed++
    const partId = row.part_id
    const categoryId = row.category_id
    const articleLinkId = Number(row.article_link_id)
    const tecdocArticleId = row.tecdoc_article_id
      ? Number(row.tecdoc_article_id)
      : null

    const handleSkip = async (reason: string) => {
      console.warn(`  [part_image=${row.id}] ${reason}`)
      if (config.dryRun) {
        console.log(
          `  [DRY-RUN] part_image=${row.id}: would clear image and thumb to null`
        )
        totalCleared++
        return
      }
      try {
        await db.part_images.update({
          where: { id: row.id },
          data: {
            image: null,
            thumb: null
          }
        })
        console.log(
          `  [CLEARED] part_image=${row.id}: image and thumb set to null`
        )
        totalCleared++
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(
          `  [ERROR] part_image=${row.id}: Failed to clear - ${msg}`
        )
        totalFailed++
      }
    }

    // 4a. Find a vehicle_type_id for this part from part_vehicle_types
    const pvt = await db.part_vehicle_types.findFirst({
      where: { part_id: partId },
      select: { vehicle_type_id: true }
    })

    if (!pvt) {
      await handleSkip(
        `No vehicle_type found for part_id=${partId} (${row.part_name})`
      )
      return
    }

    const vehicleTypeId = pvt.vehicle_type_id
    const cacheKey = `${vehicleTypeId}:${categoryId}`

    // 4b. Fetch articles from API (with cache)
    let articles: ArticleItem[] | null
    if (articlesCache.has(cacheKey)) {
      articles = articlesCache.get(cacheKey)!
    } else {
      try {
        console.log(
          `  [part_image=${row.id}] Fetching /articles/${vehicleTypeId}/${categoryId}/ …`
        )
        articles = await fetchArticles(baseUrls, vehicleTypeId, categoryId)
        articlesCache.set(cacheKey, articles)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(
          `  [part_image=${row.id}] API error for vt=${vehicleTypeId} cat=${categoryId}: ${msg}`
        )
        articlesCache.set(cacheKey, null)
        totalFailed++
        return
      }
    }

    if (!articles || articles.length === 0) {
      await handleSkip(
        `No articles returned for vt=${vehicleTypeId} cat=${categoryId}`
      )
      return
    }

    // 4c. Find the matching article:
    //     Match by parts.id (== tecdoc_article_id or articleLinkId in API)
    const partIdNum = Number(partId)
    const matchedArticle = articles.find(
      (a) =>
        a.id === partIdNum ||
        a.articleLinkId === partIdNum ||
        a.id === tecdocArticleId ||
        a.articleLinkId === articleLinkId
    )

    if (
      !matchedArticle ||
      !matchedArticle.partImages ||
      matchedArticle.partImages.length === 0
    ) {
      await handleSkip(
        `No API match for part_id=${partId} articleLinkId=${articleLinkId} (${row.part_name})`
      )
      return
    }

    // 4d. Determine which image index this row corresponds to
    const partImageIds = await db.part_images.findMany({
      where: { part_id: partId },
      select: { id: true },
      orderBy: { id: 'asc' }
    })

    const imageIndex = partImageIds.findIndex((pi) => pi.id === row.id)
    const apiImages = matchedArticle.partImages

    // If this row's index has a corresponding API image, use it.
    // Otherwise try all API images (the part might have fewer debug rows than API images).
    const apiImage = apiImages[imageIndex >= 0 ? imageIndex : 0]

    if (!apiImage) {
      await handleSkip(`No image at index ${imageIndex} in API response.`)
      return
    }

    // 4e. Resolve image URL (download + upload to Supabase)
    const newImage = await resolveMediaUrl({
      rawUrl: apiImage.image,
      bucket: 'part-images',
      storagePrefix: 'tecdoc/images',
      cacheKey: `fix-image:${normalizeText(apiImage.image) || ''}`,
      fallbackFileName: `image-${articleLinkId}-${imageIndex + 1}.jpg`,
      context: mediaContext
    })

    const newThumb =
      (await resolveMediaUrl({
        rawUrl: apiImage.thumb,
        bucket: 'part-images',
        storagePrefix: 'tecdoc/thumbs',
        cacheKey: `fix-thumb:${normalizeText(apiImage.thumb) || ''}`,
        fallbackFileName: `thumb-${articleLinkId}-${imageIndex + 1}.jpg`,
        context: mediaContext
      })) || newImage

    if (!newImage) {
      await handleSkip(`Could not resolve new image URL for: ${apiImage.image}`)
      return
    }

    // Check if the resolved URL is still a debug link (nothing changed)
    if (newImage.includes('/_debug/tecdoc-images/')) {
      await handleSkip(`Resolved URL still a debug link: ${newImage}`)
      return
    }

    if (config.dryRun) {
      console.log(
        `  [DRY-RUN] part_image=${row.id}: ${row.image} → ${newImage}`
      )
      totalUpdated++
      return
    }

    // 4f. Update the row
    try {
      await db.part_images.update({
        where: { id: row.id },
        data: {
          image: newImage,
          thumb: newThumb || newImage
        }
      })

      console.log(`  [UPDATED] part_image=${row.id}: → ${newImage}`)
      totalUpdated++
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`  [ERROR] part_image=${row.id}: ${msg}`)
      totalFailed++
    }
  })

  console.log()
  console.log('=== Summary ===')
  console.log(`  Total rows found:    ${rows.length}`)
  console.log(`  Processed:           ${totalProcessed}`)
  console.log(`  Updated:             ${totalUpdated}`)
  console.log(`  Cleared (null):      ${totalCleared}`)
  console.log(`  Skipped:             ${totalSkipped}`)
  console.log(`  Failed:              ${totalFailed}`)
  console.log(`  Cache hits (media):  ${mediaContext.imageCache.size}`)
  console.log(`  Cached API calls:    ${articlesCache.size}`)

  if (config.dryRun) {
    console.log('\n  ⚠️  DRY-RUN mode — no changes were made to the database.')
  }
}

main()
  .then(() => {
    console.log('\nDone.')
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
    process.exit(process.exitCode ?? 0)
  })
