import { NextRequest, NextResponse } from 'next/server'
import { MeiliSearch } from 'meilisearch'
import { fetchAllV0MeiliDocuments } from '@/lib/v0/search/v0-search-document'
import { getV0CatalogIndexName } from '@/lib/v0/search/v0-meilisearch-client'
import { getMeiliHost } from '@/lib/search/meilisearch-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BATCH_SIZE = parseInt(process.env.MEILI_REINDEX_BATCH_SIZE || '500', 10)

async function waitForTask(
  client: MeiliSearch,
  taskUid: number,
  maxWaitMs = 120_000
): Promise<void> {
  let elapsed = 0
  const interval = 1000
  while (elapsed < maxWaitMs) {
    const result = await client.tasks.getTask(taskUid)
    if (result.status === 'succeeded') return
    if (result.status === 'failed') {
      throw new Error(result.error?.message || `Task ${taskUid} failed`)
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
    elapsed += interval
  }
  throw new Error(`Task ${taskUid} timed out`)
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { success: false, message: 'CRON_SECRET not configured.' },
      { status: 500 }
    )
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })
  }

  const masterKey = process.env.MEILI_MASTER_KEY?.trim()
  if (!masterKey) {
    return NextResponse.json(
      { success: false, message: 'MEILI_MASTER_KEY not configured.' },
      { status: 500 }
    )
  }

  const indexName = getV0CatalogIndexName()
  const client = new MeiliSearch({ host: getMeiliHost(), apiKey: masterKey })
  let indexed = 0

  try {
    await client.createIndex(indexName, { primaryKey: 'id' }).catch(() => {})
    const index = client.index(indexName)
    const documents = await fetchAllV0MeiliDocuments()

    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE)
      const task = await index.addDocuments(batch)
      await waitForTask(client, task.taskUid)
      indexed += batch.length
    }

    const stats = await index.getStats()
    return NextResponse.json({
      success: true,
      index: indexName,
      indexed,
      numberOfDocuments: stats.numberOfDocuments
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        indexed,
        message: error instanceof Error ? error.message : 'Indexing failed.'
      },
      { status: 500 }
    )
  }
}
