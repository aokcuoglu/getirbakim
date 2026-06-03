import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:me',
    limit: 180,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const start = performance.now()
    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      const res = successResponse({ user: null }, context)
      res.headers.set(
        'Server-Timing',
        `total;dur=${Number((performance.now() - start).toFixed(2))}`
      )
      return res
    }

    const dbUser = await db.users.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        image: true
      }
    })

    // If DB row doesn't exist yet (edge-case), still return Supabase identity.
    if (!dbUser) {
      const res = successResponse({
        user: {
          id: user.id,
          email: user.email,
          name:
            (user.user_metadata as any)?.full_name ||
            (user.user_metadata as any)?.name ||
            null,
          role: null,
          image: null
        }
      }, context)
      res.headers.set(
        'Server-Timing',
        `total;dur=${Number((performance.now() - start).toFixed(2))}`
      )
      return res
    }

    const res = successResponse({ user: dbUser }, context)
    res.headers.set(
      'Server-Timing',
      `total;dur=${Number((performance.now() - start).toFixed(2))}`
    )
    return res
  } catch (error) {
    console.error('Error in /api/me:', error)
    return errorResponse({
      status: 500,
      code: 'ME_ENDPOINT_FAILED',
      message: 'User lookup failed',
      context
    })
  }
}
