import createMiddleware from 'next-intl/middleware'
import { routing } from './lib/navigation'
import { type NextRequest, NextResponse } from 'next/server'
import { loginPathWithRedirect } from '@/lib/auth/safe-redirect'
import { updateSession } from '@/lib/supabase/middleware'
import { logSupabaseError } from '@/lib/supabase/error-utils'

import { createServerClient } from '@supabase/ssr'

const intlMiddleware = createMiddleware(routing)

function isServerActionRequest(request: NextRequest): boolean {
  return (
    request.method === 'POST' &&
    (request.headers.has('next-action') || request.headers.has('x-action'))
  )
}

export default async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isLocalHost =
    request.nextUrl.hostname === 'localhost' ||
    request.nextUrl.hostname === '127.0.0.1'
  const localeMatch = pathname.match(/^\/(en|tr)(?:\/|$)/)
  const localeAwareHome = localeMatch ? `/${localeMatch[1]}` : '/'
  const isGetRequest = request.method === 'GET'
  const isHeadRequest = request.method === 'HEAD'
  const sessionRelevantPath = /^\/(en|tr)\/(account|checkout|orders)(?:\/|$)/.test(
    pathname
  )
  const hasSupabaseAuthCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('auth-token'))

  // Server Actions POST back to the page URL with `next-action`. Running i18n
  // redirects or other middleware rewrites on those requests returns HTML
  // instead of the RSC payload, which surfaces as "An unexpected response was
  // received from the server." in the login modal and other client callers.
  if (isServerActionRequest(request)) {
    let response = NextResponse.next({ request })
    if (hasSupabaseAuthCookie) {
      try {
        response = await updateSession(request, response)
      } catch (error) {
        logSupabaseError('proxy:updateSession', error)
      }
    }
    return response
  }

  // Skip middleware for API routes (they don't need locale prefix)
  // API routes handle their own authentication in route handlers
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Canonicalize accidental repeated locale prefixes: /tr/tr/... -> /tr/...
  const canonicalPathname = pathname.replace(
    /^\/(en|tr)(?:\/\1)+(\/|$)/,
    '/$1$2'
  )
  if (canonicalPathname !== pathname) {
    const url = request.nextUrl.clone()
    url.pathname = canonicalPathname
    return NextResponse.redirect(url)
  }

  // 1. Run Intl Middleware
  const response = intlMiddleware(request)

  // 2. Refresh session
  // updateSession returns a response with updated cookies
  let supabaseResponse: NextResponse = response
  const shouldRefreshSession =
    hasSupabaseAuthCookie || sessionRelevantPath || pathname.startsWith('/admin')
  if (shouldRefreshSession) {
    try {
      supabaseResponse = await updateSession(request, response)
    } catch (error) {
      logSupabaseError('proxy:updateSession', error)
    }
  }

  // 3. Admin Check
  // Check if it's an admin path
  const isAdminPath =
    pathname.match(/^\/(en|tr)\/admin/) || pathname.startsWith('/admin')

  if (isAdminPath) {
    try {
      const supabase = createServerClient(
        process.env['NEXT_PUBLIC_SUPABASE_URL']!,
        process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll()
            },
            setAll(_cookiesToSet) {
              // Already handled in updateSession
            }
          }
        }
      )

      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) {
        const url = request.nextUrl.clone()
        url.pathname = loginPathWithRedirect(
          localeMatch?.[1] ?? 'tr',
          request.nextUrl.pathname + request.nextUrl.search
        )
        return NextResponse.redirect(url)
      }

      // Edge middleware cannot use Prisma safely.
      // Use token metadata only for early deny when present.
      // Server-side admin routes still perform authoritative DB checks.
      const roleFromToken =
        (user.user_metadata?.role as string | undefined) ||
        (user.app_metadata?.role as string | undefined)
      const normalizedRole = roleFromToken?.toUpperCase()
      const isKnownAppRole =
        normalizedRole === 'ADMIN' || normalizedRole === 'CUSTOMER'

      if (isKnownAppRole && normalizedRole !== 'ADMIN') {
        const url = request.nextUrl.clone()
        url.pathname = localeAwareHome
        return NextResponse.redirect(url)
      }
    } catch (error) {
      logSupabaseError('proxy:admin-auth-check', error)
      if (!isLocalHost) {
        const url = request.nextUrl.clone()
        url.pathname = localeAwareHome
        return NextResponse.redirect(url)
      }
    }
  }

  if (!isLocalHost) {
    supabaseResponse.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    )
  }
  supabaseResponse.headers.set('X-Content-Type-Options', 'nosniff')
  supabaseResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  supabaseResponse.headers.set('X-Frame-Options', 'SAMEORIGIN')
  supabaseResponse.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), browsing-topics=()'
  )
  supabaseResponse.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; img-src 'self' data: blob: https:; font-src 'self' data: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; connect-src 'self' https: wss:; frame-src 'self' https:; upgrade-insecure-requests"
  )

  if ((isGetRequest || isHeadRequest) && !hasSupabaseAuthCookie && !isAdminPath) {
    supabaseResponse.headers.set(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=900'
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api routes are handled separately in middleware
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
}
