import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { getServerSession } from '@/lib/auth/server'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:me',
    limit: 180,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const start = performance.now()
    const session = await getServerSession()

    if (!session?.user?.id) {
      const res = successResponse({ user: null }, context)
      res.headers.set(
        'Server-Timing',
        `total;dur=${Number((performance.now() - start).toFixed(2))}`
      )
      return res
    }

    const dbUser = await db.users.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        image: true
      }
    })

    if (!dbUser) {
      const res = successResponse({
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name || null,
          role: session.user.role || null,
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
