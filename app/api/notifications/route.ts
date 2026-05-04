import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import type { NotificationRecord } from '@/lib/notifications/types'

const querySchema = z.object({
  cursor: z.coerce.bigint().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
})

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:notifications:list',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const parsedQuery = querySchema.safeParse({
      cursor: request.nextUrl.searchParams.get('cursor') || undefined,
      limit: request.nextUrl.searchParams.get('limit') || undefined
    })

    if (!parsedQuery.success) {
      return errorResponse({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid notifications query params.',
        details: parsedQuery.error.flatten(),
        context
      })
    }

    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user?.id) {
      return successResponse(
        {
          notifications: [] as NotificationRecord[],
          unreadCount: 0,
          nextCursor: null
        },
        context
      )
    }

    const { cursor, limit } = parsedQuery.data

    const rows = await db.notifications.findMany({
      where: {
        user_id: user.id,
        ...(cursor ? { id: { lt: cursor } } : {})
      },
      orderBy: [{ id: 'desc' }],
      take: limit + 1
    })

    const hasMore = rows.length > limit
    const sliced = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? String(sliced[sliced.length - 1]?.id ?? '') : null

    const notifications: NotificationRecord[] = sliced.map((row) => ({
      id: row.id.toString(),
      type: row.type as NotificationRecord['type'],
      title: row.title,
      message: row.message,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      readAt: row.read_at ? row.read_at.toISOString() : null,
      createdAt: row.created_at.toISOString()
    }))

    const unreadCount = await db.notifications.count({
      where: {
        user_id: user.id,
        read_at: null
      }
    })

    return successResponse(
      {
        notifications,
        unreadCount,
        nextCursor
      },
      context
    )
  } catch (error) {
    return errorResponse({
      status: 500,
      code: 'NOTIFICATIONS_LIST_FAILED',
      message:
        error instanceof Error ? error.message : 'Notifications could not be fetched.',
      context
    })
  }
}
