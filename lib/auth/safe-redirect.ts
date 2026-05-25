/** Allow only same-origin relative paths (prevents open redirects). */
export function safeRedirectPath(
  value: string | undefined | null,
  fallback: string
): string {
  if (!value) return fallback
  const path = value.trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return fallback
  }
  return path
}

export function loginPathWithRedirect(locale: string, returnPath: string): string {
  const fallback = `/${locale}`
  const safe = safeRedirectPath(returnPath, fallback)
  const params = new URLSearchParams({ redirect: safe })
  return `/${locale}/login?${params.toString()}`
}
