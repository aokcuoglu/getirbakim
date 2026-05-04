import { NextRequest, NextResponse } from 'next/server'
import { runSetaCatalogSeed } from '@/lib/suppliers/seta-catalog-seed'

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function handleSetaCatalogSeedRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured.' },
      { status: 500 }
    )
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    return unauthorizedResponse()
  }

  // Stream NDJSON progress so curl shows real-time output
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await runSetaCatalogSeed({
          onProgress: (p) => {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(p) + '\n'))
            } catch {
              // stream closed by client
            }
          }
        })
        controller.enqueue(
          encoder.encode(JSON.stringify({ phase: 'result', ...result }) + '\n')
        )
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        controller.enqueue(
          encoder.encode(JSON.stringify({ phase: 'fatal', error: msg }) + '\n')
        )
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no'
    }
  })
}
