import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:notifications:mark-all-read',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user?.id) {
      return errorResponse({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
        context
      })
    }

    await db.notifications.updateMany({
      where: {
        user_id: user.id,
        read_at: null
      },
      data: {
        read_at: new Date()
      }
    })

    return successResponse({ success: true }, context)
  } catch (error) {
    return errorResponse({
      status: 500,
      code: 'NOTIFICATIONS_MARK_ALL_READ_FAILED',
      message:
        error instanceof Error ? error.message : 'Mark all notifications failed.',
      context
    })
  }
}
