import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminAuth } from '@/lib/admin-auth'

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

/**
 * Prisma'nın "veritabanına ulaşamadım" hataları: sunucu kapalı (P1001/P1002),
 * bağlantı düştü (P1017) ya da havuz doldu (P2024).
 *
 * Bunları 500'den ayırmaya değer: local dev prod DB'ye SSH tüneliyle bağlanıyor
 * ve tünel düştüğünde tek görünen belirti "yüklenemedi" oluyordu. Ayrı bir kod +
 * mesaj, hatayı kodda aramak yerine tüneli kontrol etmeye yönlendirir.
 */
const DB_UNREACHABLE_CODES = new Set(['P1001', 'P1002', 'P1017', 'P2024'])

export function isDatabaseUnreachable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && DB_UNREACHABLE_CODES.has(code)
}

/**
 * Yakalanan hatayı standart JSON gövdesine çevirir. Handler'ın TAMAMI (auth
 * dahil) bunun kapsamında olmalı: try'ın dışında kalan bir throw Next'ten gövdesiz
 * bir 500 döndürür, istemcinin `res.json()`'ı da onda patlayıp gerçek sebebi
 * yutar.
 */
export function unexpectedErrorResponse(
  error: unknown,
  context: ApiContext,
  fallbackMessage: string
): NextResponse {
  if (isDatabaseUnreachable(error)) {
    return errorResponse({
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Veritabanına ulaşılamıyor. (Local dev: SSH tüneli kapalı olabilir.)',
      context
    })
  }

  return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: fallbackMessage, context })
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

/**
 * Combined rate-limit + admin auth + ADMIN role check.
 *
 * Replaces the 4-6 line boilerplate repeated across 25+ admin API routes:
 *   const auth = await getAdminAuth()
 *   const { context, limitedResponse } = withApiContext(request, {...})
 *   if (limitedResponse) return limitedResponse
 *   if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', ... })
 *   if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', ... })
 *
 * getAdminAuth de veritabanına gidiyor, yani atabilir. Elle yazılan biçimde bu
 * çağrı handler'ın try'ından önce durduğu için throw eden auth Next'ten GÖVDESİZ
 * bir 500 döndürüyordu; istemcinin `res.json()`'ı da onda patlayıp gerçek sebebi
 * yutuyordu (zenginleştirme sekmesindeki "Kapsama verisi yüklenemedi." buydu).
 * Burada auth kendi try'ı içinde: hata da standart JSON gövdesiyle dönüyor.
 *
 * Sıralama da elle yazılan biçimden farklı — hız sınırı auth'tan ÖNCE bakılıyor,
 * yani sınırı aşan istek için DB'ye hiç gidilmiyor.
 *
 * `context` her dalda dolu döner; handler'ın kendi catch'i onu kullanabilsin diye.
 *
 * Usage:
 *   const { response, context, auth } = await requireAdmin(request, {
 *     keyPrefix: 'admin:products', limit: 60, windowMs: 60_000
 *   })
 *   if (response) return response
 *   try { ... } catch (error) { return unexpectedErrorResponse(error, context, '...') }
 */
export async function requireAdmin(
  request: NextRequest,
  rateLimit: RateLimitOptions
): Promise<
  | { response: NextResponse; context: ApiContext; auth: null }
  | {
      response: null
      context: ApiContext
      auth: NonNullable<Awaited<ReturnType<typeof getAdminAuth>>>
    }
> {
  const { context, limitedResponse } = withApiContext(request, rateLimit)
  if (limitedResponse) return { response: limitedResponse, context, auth: null }

  let auth: Awaited<ReturnType<typeof getAdminAuth>>
  try {
    auth = await getAdminAuth()
  } catch (error) {
    console.error('[requireAdmin] Auth lookup failed:', error)
    return {
      response: unexpectedErrorResponse(error, context, 'Oturum doğrulanırken hata oluştu.'),
      context,
      auth: null
    }
  }

  if (!auth?.user) {
    return {
      response: errorResponse({
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
        context
      }),
      context,
      auth: null
    }
  }

  if (auth.user.role !== 'ADMIN') {
    return {
      response: errorResponse({
        status: 403,
        code: 'ADMIN_REQUIRED',
        message: 'Admin access required.',
        context
      }),
      context,
      auth: null
    }
  }

  return { response: null, context, auth }
}

/**
 * Validates the CRON_SECRET Bearer auth for internal/supplier endpoints.
 * Returns null on success, or a 401 NextResponse on failure.
 *
 * Replaces the inconsistent unauthorizedResponse definitions repeated across
 * 8+ internal/suppliers handler.ts files (some used success/message shape, others
 * error shape, some Response some NextResponse).
 */
export function requireCronAuth(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, message: 'Server misconfiguration: CRON_SECRET not set.' },
      { status: 500 }
    )
  }

  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token || token !== cronSecret) {
    return NextResponse.json(
      { success: false, message: 'Unauthorized.' },
      { status: 401 }
    )
  }

  return null
}

/**
 * Parses pagination query params (page, limit) with sane clamping.
 *
 * Replaces the repeated block across admin API routes:
 *   const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
 *   const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)), 200)
 *   const offset = (page - 1) * limit
 */
export function parsePagination(
  request: NextRequest,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): { page: number; limit: number; offset: number } {
  const defaultLimit = options.defaultLimit ?? 50
  const maxLimit = options.maxLimit ?? 200

  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10) || 1)
  const limit = Math.min(
    Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? String(defaultLimit), 10) || defaultLimit),
    maxLimit
  )
  const offset = (page - 1) * limit

  return { page, limit, offset }
}
