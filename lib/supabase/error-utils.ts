const warnedScopes = new Set<string>()

export function isSupabaseNetworkError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  return (
    message.includes('fetch failed') ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('eai_again') ||
    message.includes('getaddrinfo')
  )
}

export function logSupabaseError(scope: string, error: unknown) {
  if (process.env.NODE_ENV === 'development' && isSupabaseNetworkError(error)) {
    const showDevWarnings = process.env.SUPABASE_DEV_WARNINGS === 'true'
    if (showDevWarnings && !warnedScopes.has(scope)) {
      warnedScopes.add(scope)
      console.warn(
        `[${scope}] Supabase endpoint is unreachable in development. Continuing without session refresh.`
      )
    }
    return
  }

  console.error(`[${scope}]`, error)
}
