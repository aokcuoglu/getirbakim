import { NextRequest, NextResponse } from 'next/server'
import { getMeiliAdminClient } from '@/lib/search/meili-admin'
import { buildAllPartSearchDocumentsPaginated } from '@/lib/search/build-part-document'
import { PARTS_INDEX } from '@/lib/meilisearch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ success: false, message: 'CRON_SECRET not configured.' }, { status: 500 })
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })
  }

  const batchSize = 1000
  const client = getMeiliAdminClient()
  let indexed = 0

  try {
    const total = await buildAllPartSearchDocumentsPaginated(batchSize, async (docs) => {
      await client.index(PARTS_INDEX).addDocuments(docs)
      indexed += docs.length
      console.info(`[search/index-parts] indexed ${indexed} parts...`)
    })

    return NextResponse.json({ success: true, total, indexed })
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
