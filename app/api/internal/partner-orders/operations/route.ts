import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/route-utils'
import { expirePartnerOrders } from '@/lib/partner/order-service'
import { dispatchPartnerOrderWebhooks, getPartnerOrderOperationsStats } from '@/lib/partner/webhook-dispatcher'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized
  try {
    const expired = await expirePartnerOrders(100)
    const delivery = await dispatchPartnerOrderWebhooks()
    return NextResponse.json({ success: true, expired, delivery })
  } catch (error) {
    console.error('[partner-orders:operations]', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { success: false, message: 'Partner order operations failed.' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized
  try {
    return NextResponse.json({ success: true, stats: await getPartnerOrderOperationsStats() })
  } catch (error) {
    console.error('[partner-orders:operations:stats]', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { success: false, message: 'Partner order operations stats failed.' },
      { status: 500 }
    )
  }
}
