import { NextRequest, NextResponse } from 'next/server'
import { finalizeTamiPaymentFromCallback } from '@/lib/payments/service'

type CallbackPayload = {
  orderId: number | null
}

async function readCallbackPayload(request: NextRequest): Promise<CallbackPayload> {
  const contentType = request.headers.get('content-type') || ''

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const form = await request.formData()
    const rawOrderId = String(form.get('orderId') || form.get('merchantOrderId') || '')
    const orderId = Number(rawOrderId)
    return {
      orderId: Number.isInteger(orderId) && orderId > 0 ? orderId : null
    }
  }

  try {
    const json = (await request.json()) as Record<string, unknown>
    const orderId = Number(json.orderId || json.merchantOrderId || 0)
    return {
      orderId: Number.isInteger(orderId) && orderId > 0 ? orderId : null
    }
  } catch {
    return { orderId: null }
  }
}

async function handleRequest(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get('locale') || 'tr'
  const queryOrderId = Number(request.nextUrl.searchParams.get('orderId') || '0')
  const payload = request.method === 'POST' ? await readCallbackPayload(request) : { orderId: null }
  const orderId =
    Number.isInteger(queryOrderId) && queryOrderId > 0 ? queryOrderId : payload.orderId || 0

  if (!orderId) {
    const url = new URL(`/${locale}/checkout/result`, request.url)
    url.searchParams.set('state', 'failure')
    url.searchParams.set('error', 'Payment callback payload is incomplete.')
    return NextResponse.redirect(url, { status: 303 })
  }

  try {
    const result = await finalizeTamiPaymentFromCallback({
      orderId,
      locale,
      baseUrl: request.nextUrl.origin
    })

    return NextResponse.redirect(result.redirectUrl, { status: 303 })
  } catch (error) {
    const url = new URL(`/${locale}/checkout/result`, request.url)
    url.searchParams.set('orderId', String(orderId))
    url.searchParams.set('state', 'pending_verification')
    url.searchParams.set(
      'error',
      error instanceof Error ? error.message : 'Payment callback failed.'
    )
    return NextResponse.redirect(url, { status: 303 })
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request)
}

export async function POST(request: NextRequest) {
  return handleRequest(request)
}
