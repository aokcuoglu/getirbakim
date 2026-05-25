import { NextRequest } from 'next/server'
import { syncDproductsFromDbrands } from '@/lib/admin/dproducts-stock-sync'

function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  })
}

export async function handleDproductsSyncRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return new Response(
      JSON.stringify({ error: 'CRON_SECRET is not configured.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    return unauthorizedResponse()
  }

  const params = request.nextUrl.searchParams
  const brand = params.get('brand')?.trim() || undefined
  const apply = params.get('apply') === 'true'
  const limitBrandsRaw = parseInt(params.get('limitBrands') || '', 10)
  const limitBrands =
    Number.isFinite(limitBrandsRaw) && limitBrandsRaw > 0 ? limitBrandsRaw : undefined
  const fetchPrices = params.get('fetchPrices') !== 'false'

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'))
        } catch {
          // client disconnected
        }
      }

      try {
        emit({ phase: 'start', brand, apply, limitBrands, fetchPrices })
        const result = await syncDproductsFromDbrands({
          dryRun: !apply,
          brand,
          limitBrands,
          fetchPrices
        })
        emit({ phase: 'result', ...result })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        emit({ phase: 'fatal', error: msg })
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
