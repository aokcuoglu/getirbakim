import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

type RateLimitOptions = {
  keyPrefix: string
  limit: number
  windowMs: number
}

type RateLimitBucket = {
  count: number
  resetAt: number
}

type RateLimitState = {
  limit: number
  remaining: number
  retryAfterSeconds: number
}

type ApiContext = {
  requestId: string
  rate: RateLimitState
}

type ErrorResponseInput = {
  status: number
  code: string
  message: string
  context: ApiContext
  details?: unknown
}

const RATE_LIMIT_STORE = new Map<string, RateLimitBucket>()

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    return xff.split(',')[0]?.trim() || 'unknown'
  }

  const realIp = request.headers.get('x-real-ip')
  return realIp || 'unknown'
}

export function attachStandardHeaders(
  response: NextResponse,
  context: ApiContext
): NextResponse {
  response.headers.set('X-Request-Id', context.requestId)
  response.headers.set('X-RateLimit-Limit', String(context.rate.limit))
  response.headers.set('X-RateLimit-Remaining', String(context.rate.remaining))
  response.headers.set('Retry-After', String(context.rate.retryAfterSeconds))
  return response
}

export function errorResponse(input: ErrorResponseInput): NextResponse {
  const body: Record<string, unknown> = {
    error: {
      code: input.code,
      message: input.message
    },
    requestId: input.context.requestId
  }

  if (input.details !== undefined) {
    body.details = input.details
  }

  return attachStandardHeaders(
    NextResponse.json(body, { status: input.status }),
    input.context
  )
}

export function successResponse<T>(
  body: T,
  context: ApiContext,
  init?: { status?: number }
): NextResponse {
  return attachStandardHeaders(
    NextResponse.json(body, init ? { status: init.status } : undefined),
    context
  )
}

export function withApiContext(
  request: NextRequest,
  options: RateLimitOptions
): { context: ApiContext; limitedResponse: NextResponse | null } {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID()
  const now = Date.now()
  const ip = getClientIp(request)
  const key = `${options.keyPrefix}:${ip}`
  const existing = RATE_LIMIT_STORE.get(key)

  if (!existing || existing.resetAt <= now) {
    const newBucket: RateLimitBucket = {
      count: 1,
      resetAt: now + options.windowMs
    }
    RATE_LIMIT_STORE.set(key, newBucket)
    return {
      context: {
        requestId,
        rate: {
          limit: options.limit,
          remaining: Math.max(options.limit - 1, 0),
          retryAfterSeconds: Math.ceil(options.windowMs / 1000)
        }
      },
      limitedResponse: null
    }
  }

  existing.count += 1

  const remaining = Math.max(options.limit - existing.count, 0)
  const retryAfterSeconds = Math.max(
    Math.ceil((existing.resetAt - now) / 1000),
    1
  )
  const context: ApiContext = {
    requestId,
    rate: {
      limit: options.limit,
      remaining,
      retryAfterSeconds
    }
  }

  if (existing.count > options.limit) {
    return {
      context,
      limitedResponse: errorResponse({
        status: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        context
      })
    }
  }

  return { context, limitedResponse: null }
}

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>,
  context: ApiContext
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return {
      success: false,
      response: errorResponse({
        status: 400,
        code: 'INVALID_JSON',
        message: 'Request body must be valid JSON.',
        context
      })
    }
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    return {
      success: false,
      response: errorResponse({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        context,
        details: result.error.flatten()
      })
    }
  }

  return { success: true, data: result.data }
}
