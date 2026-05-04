import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'
import {
  errorResponse,
  parseJsonBody,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

const bodySchema = z.object({
  ids: z.array(z.union([z.string(), z.number(), z.bigint()])).min(1).max(200)
})

function toBigIntIds(values: Array<string | number | bigint>): bigint[] {
  const parsed = values
    .map((value) => {
      try {
        return typeof value === 'bigint' ? value : BigInt(String(value))
      } catch {
        return null
      }
    })
    .filter((value): value is bigint => value != null && value > BigInt(0))
  return Array.from(new Set(parsed))
}

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:notifications:mark-read',
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

    const parsed = await parseJsonBody(request, bodySchema, context)
    if (!parsed.success) return parsed.response

    const ids = toBigIntIds(parsed.data.ids)
    if (ids.length === 0) {
      return errorResponse({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'No valid notification ids found.',
        context
      })
    }

    await db.notifications.updateMany({
      where: {
        user_id: user.id,
        id: { in: ids }
      },
      data: {
        read_at: new Date()
      }
    })

    return successResponse({ success: true }, context)
  } catch (error) {
    return errorResponse({
      status: 500,
      code: 'NOTIFICATIONS_MARK_READ_FAILED',
      message: error instanceof Error ? error.message : 'Notifications update failed.',
      context
    })
  }
}
